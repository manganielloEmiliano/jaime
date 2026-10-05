import fs from 'node:fs'
import path from 'node:path'

// Mismo formato que ya produce `preload/pcm.ts` para whisper.cpp — mono,
// 16kHz, no hace falta reencodear nada entre captura/disco/AssemblyAI.
const SAMPLE_RATE = 16000
const NUM_CHANNELS = 1
const BITS_PER_SAMPLE = 16
const WAV_HEADER_SIZE = 44

function writeWavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_SIZE)
  const byteRate = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8)
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // tamaño del chunk fmt (PCM)
  header.writeUInt16LE(1, 20) // audio format = PCM entero
  header.writeUInt16LE(NUM_CHANNELS, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)
  return header
}

/** PCM float32 en [-1, 1] -> PCM16 little-endian (lo que espera un .wav y también AssemblyAI). */
export function float32ToPcm16(samples: Float32Array): Buffer {
  const buffer = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2)
  }
  return buffer
}

/** Camino inverso — lee un .wav escrito por `WavWriter` y lo devuelve como PCM float32 (lo que espera whisper.cpp). */
/** Cantidad de muestras de un .wav de este mismo formato fijo, sin leerlo entero — para calcular el total de ventanas antes de transcribir. */
export function wavSampleCount(filePath: string): number {
  return Math.max(0, (fs.statSync(filePath).size - WAV_HEADER_SIZE) / (BITS_PER_SAMPLE / 8))
}

export function readWavAsFloat32(filePath: string): Float32Array {
  const buffer = fs.readFileSync(filePath)
  const data = buffer.subarray(WAV_HEADER_SIZE) // el header es siempre de 44 bytes con el formato fijo de arriba
  const samples = new Float32Array(data.length / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = data.readInt16LE(i * 2) / 0x8000
  }
  return samples
}

/**
 * Escritor incremental de WAV: reserva un header de 44 bytes con tamaños en
 * 0 al abrir, va apendeando PCM16 a medida que llegan chunks de audio real,
 * y al cerrar reescribe el header con los tamaños definitivos. Esto es lo
 * que corrige el bug conocido de `sttSession.ts` (todo el audio de una
 * sesión vivía solo en RAM y se perdía si la app se cerraba antes del
 * "refinar" final) — ahora el audio queda en disco a medida que se graba.
 */
export class WavWriter {
  private readonly fd: number
  private bytesWritten = 0

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.fd = fs.openSync(filePath, 'w')
    fs.writeSync(this.fd, writeWavHeader(0))
  }

  writeFloat32(samples: Float32Array): void {
    this.writePcm16(float32ToPcm16(samples))
  }

  writePcm16(buffer: Buffer): void {
    fs.writeSync(this.fd, buffer)
    this.bytesWritten += buffer.length
  }

  close(): void {
    const header = writeWavHeader(this.bytesWritten)
    fs.writeSync(this.fd, header, 0, header.length, 0)
    fs.closeSync(this.fd)
  }
}
