function mergeFloat32(chunks: Float32Array[], totalLength: number): Float32Array {
  const result = new Float32Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

export interface PcmChunkCapture {
  stop(): void
}

/**
 * Arma el grafo de Web Audio compartido por los dos modos de captura de
 * abajo: `MediaStreamSource -> ScriptProcessorNode -> GainNode en silencio`.
 * El `AudioContext` se crea con `sampleRate: 16000` directamente — Chromium
 * hace el resample internamente al conectar el `MediaStreamSource`, así que
 * no hace falta escribir un resampler a mano. Usa `ScriptProcessorNode`
 * (deprecado pero todavía funcional en Chromium) en vez de
 * `AudioWorkletNode` para no necesitar un archivo de worklet aparte.
 * ScriptProcessorNode solo dispara `onaudioprocess` si está conectado a un
 * destino — se manda a un `GainNode` en silencio para no generar feedback
 * audible (sería especialmente malo con el stream del mic).
 */
function createProcessorGraph(
  stream: MediaStream,
  onFrame: (samples: Float32Array) => void
): PcmChunkCapture {
  const sampleRate = 16000
  const ctx = new AudioContext({ sampleRate })
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const silentGain = ctx.createGain()
  silentGain.gain.value = 0

  processor.onaudioprocess = (event) => {
    onFrame(new Float32Array(event.inputBuffer.getChannelData(0)))
  }

  source.connect(processor)
  processor.connect(silentGain)
  silentGain.connect(ctx.destination)

  return {
    stop() {
      processor.disconnect()
      source.disconnect()
      silentGain.disconnect()
      void ctx.close()
    }
  }
}

/**
 * Captura PCM mono a 16kHz en chunks de `chunkMs` milisegundos — pensado
 * para whisper.cpp local, que necesita varios segundos de audio por
 * llamada para transcribir bien (a diferencia de un proveedor de streaming
 * real, ver `startPcmRawCapture` abajo).
 */
export function startPcmChunkCapture(
  stream: MediaStream,
  chunkMs: number,
  onChunk: (samples: Float32Array) => void
): PcmChunkCapture {
  const sampleRate = 16000
  const chunkSamples = Math.floor((chunkMs / 1000) * sampleRate)
  let buffer: Float32Array[] = []
  let bufferedSamples = 0

  return createProcessorGraph(stream, (frame) => {
    buffer.push(frame)
    bufferedSamples += frame.length
    if (bufferedSamples >= chunkSamples) {
      onChunk(mergeFloat32(buffer, bufferedSamples))
      buffer = []
      bufferedSamples = 0
    }
  })
}

/**
 * Captura PCM mono a 16kHz emitiendo cada frame del `ScriptProcessorNode`
 * (~256ms a 4096 samples) sin bufferear — a diferencia de
 * `startPcmChunkCapture`, acá SÍ importa la baja latencia: es lo que usa
 * el modo `assemblyai` para que el streaming real tenga sentido (mandar
 * audio en chunks de 6s como whisper anularía el beneficio de tener
 * resultados parciales en vivo).
 */
export function startPcmRawCapture(
  stream: MediaStream,
  onFrame: (samples: Float32Array) => void
): PcmChunkCapture {
  return createProcessorGraph(stream, onFrame)
}
