import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { getLoopbackAudioMediaStream } from 'electron-audio-loopback'
import { startPcmChunkCapture, startPcmRawCapture, type PcmChunkCapture } from './pcm'
import type { AudioSource, RecordMode, SttProvider, TranscriptSegment } from '../shared/types'

export type { RecordMode }

export interface SttSegment {
  /** Id citable del borrador en vivo (`L12`) — el mismo para los parciales y el final de un turno de AssemblyAI. */
  id: string
  speaker: AudioSource
  /** Offset dentro del .wav de ese hablante (ms). */
  startMs: number
  text: string
  /** `false` mientras el turno sigue abierto (streaming real) — el whisper local siempre manda `true`. */
  isFinal: boolean
}

export interface SttSession {
  /** Deja de rutear audio nuevo a main (whisper/AssemblyAI) — no corta los streams de mic/loopback, retomar es instantáneo. */
  pause(): void
  resume(): void
  /** Corta la captura y devuelve la transcripción final, fragmento por fragmento (citable). Con whisper-local es el resultado de refinar el .wav ya en disco; con AssemblyAI, los turnos finales recibidos en vivo. */
  stop(): Promise<TranscriptSegment[]>
}

const CHUNK_MS = 6000

type SessionSegmentEvent = SttSegment

/**
 * Arranca una sesión de grabación real: crea la carpeta de sesión del lado
 * de main (`session:start`), captura mic y/o loopback según `mode`, y manda
 * cada chunk de audio a main vía `session:audio-chunk` — main decide cómo
 * rutearlo (whisper por chunk de ~6s, o a un WebSocket de AssemblyAI) según
 * el `sttProvider` configurado en Ajustes, y devuelve el resultado ya no
 * como valor de retorno sino empujado por `session:segment` (asincrónico,
 * hace falta para poder representar resultados parciales de streaming).
 *
 * A diferencia de la versión anterior de este archivo, ya NO se guarda
 * nada en RAM más allá de lo que dura un frame/chunk en tránsito — el
 * audio real se persiste a disco del lado de main (`SessionManager` +
 * `WavWriter`) a medida que llega, corrigiendo el bug conocido de que una
 * sesión completa (30-60min) vivía solo en memoria y se perdía si la app
 * se cerraba antes de "cortar".
 *
 * `mode`:
 *  - "you-and-other" (default): mic + loopback de sistema, dos canales
 *    separados. Requiere auriculares para que "you" no se contamine con
 *    el audio de "other".
 *  - "you-only": solo mic. Pensado para dictado/notas de una sola persona.
 *  - "other-only": solo loopback de sistema, ni siquiera pide el mic.
 */
export async function startSttSession(
  onSegment: (segment: SttSegment) => void,
  mode: RecordMode = 'you-and-other'
): Promise<SttSession> {
  const captureYou = mode === 'you-only' || mode === 'you-and-other'
  const captureOther = mode === 'other-only' || mode === 'you-and-other'

  const { sttProvider }: { sttProvider: SttProvider } = await ipcRenderer.invoke('session:start', { mode })

  const onSegmentEvent = (_event: IpcRendererEvent, payload: SessionSegmentEvent): void => {
    if (payload.text.trim()) {
      onSegment({ ...payload, text: payload.text.trim() })
    }
  }
  ipcRenderer.on('session:segment', onSegmentEvent)

  const [youStream, otherStream] = await Promise.all([
    captureYou ? navigator.mediaDevices.getUserMedia({ audio: true }) : Promise.resolve(null),
    captureOther ? getLoopbackAudioMediaStream() : Promise.resolve(null)
  ])

  const sendChunk = (speaker: AudioSource) => (samples: Float32Array): void => {
    void ipcRenderer.invoke('session:audio-chunk', { speaker, samples })
  }

  const startCapture = (stream: MediaStream, speaker: AudioSource): PcmChunkCapture =>
    sttProvider === 'assemblyai'
      ? startPcmRawCapture(stream, sendChunk(speaker))
      : startPcmChunkCapture(stream, CHUNK_MS, sendChunk(speaker))

  const captures: PcmChunkCapture[] = []
  if (youStream) captures.push(startCapture(youStream, 'you'))
  if (otherStream) captures.push(startCapture(otherStream, 'other'))

  return {
    pause() {
      void ipcRenderer.invoke('session:pause')
    },
    resume() {
      void ipcRenderer.invoke('session:resume')
    },
    async stop() {
      captures.forEach((c) => c.stop())
      youStream?.getTracks().forEach((t) => t.stop())
      otherStream?.getTracks().forEach((t) => t.stop())
      ipcRenderer.off('session:segment', onSegmentEvent)

      const { segments }: { segments: TranscriptSegment[] } = await ipcRenderer.invoke('session:stop')
      return segments
    }
  }
}
