import type { AudioSource } from '../../shared/types'

export interface TranscriptSegment {
  speaker: AudioSource
  text: string
  isFinal: boolean
  timestamp: number
}

/**
 * CORRECCIÓN post-Fase 1: esto originalmente asumía que el SttEngine
 * manejaba la captura continua (`start()/stop()`), pensado para vivir en
 * main. La Fase 1 mostró que la captura real (mic + loopback) tiene que
 * vivir en preload (necesita DOM + ipcRenderer real a la vez). Entonces el
 * contrato que realmente tiene sentido en main es más chico: dado un chunk
 * de audio ya capturado, transcribirlo. La orquestación de la captura
 * continua (cuándo cortar cada chunk, a qué canal pertenece) vive en
 * `src/preload/sttSession.ts`, que llama a esto una vez por chunk vía IPC.
 *
 *  - WhisperCppEngine  -> Modo A/B (100% local, CPU, vía whisper.cpp)
 *  - AssemblyAiEngine  -> Modo C (cloud, streaming real) — implementa
 *    `StreamingSttEngine` de abajo, no esta interfaz (ver esa nota)
 *  - AzureSpeechEngine -> Modo C (cloud, alternativa) — TODO: sigue sin implementar
 */
export interface SttEngine {
  /** PCM mono float32 a 16kHz (lo que espera whisper.cpp). Devuelve texto vacío si no hubo voz reconocible. */
  transcribeChunk(pcmf32: Float32Array): Promise<string>
}

/**
 * Contrato para proveedores de STT que son streaming real por WebSocket
 * (AssemblyAI, Azure Speech, etc.) — resuelve el TODO de arriba: no
 * encajan en `SttEngine.transcribeChunk` (batch, request/response) porque
 * necesitan una conexión persistente que recibe audio continuo y empuja
 * resultados parciales/finales de forma asincrónica, no como respuesta a
 * una llamada puntual. `SessionManager` abre una `StreamingSttSession` por
 * canal activo (una para "vos", otra para "otros" si aplica).
 */
export interface StreamingSttSession {
  /** Manda un frame de audio PCM16 mono (sample rate acordado al abrir la sesión — 16kHz acá). */
  sendAudio(pcm16: Buffer): void
  /** Se dispara con cada resultado — `partial: false` marca un turno cerrado (texto final de ese turno). */
  onTranscript(cb: (partial: boolean, text: string) => void): void
  /** Cierra la sesión prolijamente (manda el mensaje de terminación que espera el proveedor). */
  stop(): Promise<void>
}

export interface StreamingSttEngine {
  createSession(): Promise<StreamingSttSession>
}
