// Tipos compartidos entre main y renderer/preload (solo tipos — se borran
// al compilar, así que no importa que sean bundles separados).
export type AudioSource = 'you' | 'other'

/**
 * Modo de captura de una sesión — vivía solo en `preload/sttSession.ts`,
 * se movió acá porque main (`SessionManager`) también necesita conocerlo
 * para saber qué canales de audio esperar.
 */
export type RecordMode = 'you-only' | 'other-only' | 'you-and-other'

/** Motor de STT activo — local (whisper.cpp) o streaming real por API. */
export type SttProvider = 'whisper-local' | 'assemblyai'

/** Un turno de la conversación reconocido — lo que se le manda al LLM como contexto (Fase 3). */
export interface ConversationSegment {
  speaker: AudioSource
  text: string
  /**
   * Dirección citable del fragmento (`L12` borrador en vivo, `S7` pasada
   * completa) — el LLM la usa para citar `[S7: "frase"]` y la UI para
   * saltar a ese fragmento. Opcional: sesiones viejas sin `segments.json`
   * no tienen cómo direccionar nada, y se mandan sin citas.
   */
  id?: string
  /** Offset dentro del .wav de ese hablante (ms) — para mostrar `03:30` y adelantar el audio. */
  startMs?: number
}

/** Fragmento de una pasada completa (ventana de 30s de whisper, o turno final de AssemblyAI) — lo que se guarda en `segments.json`. */
export interface TranscriptSegment {
  id: string
  speaker: AudioSource
  startMs: number
  text: string
}

/**
 * Metadata persistida como `metadata.json` junto al `transcript.md` de cada
 * sesión — pensada para que cualquier agente (Claude u otro) con acceso al
 * filesystem entienda de un vistazo qué es la carpeta sin tener que
 * parsear el audio ni adivinar nada.
 */
export interface SessionMetadata {
  sessionId: string
  /** Nombre editable por el usuario — arranca igual al `sessionId`, pero se puede renombrar desde el tab "Sesiones". */
  title: string
  startedAt: string
  endedAt: string
  durationMs: number
  recordMode: RecordMode
  sttProvider: SttProvider
  audioFiles: Partial<Record<AudioSource, string>>
  transcriptFile: string
  /** `segments.json` con los fragmentos citables — ausente en sesiones grabadas antes de las citas (se genera al "Refinar"). */
  segmentsFile?: string
}

/** Un mensaje del chat de preguntas (Q&A) — historial completo, nunca se pisa. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

/**
 * Qué pasada completa de whisper está reportando avance — las tres
 * comparten el canal IPC `transcribe:progress`, cada vista filtra la suya.
 */
export type TranscribeJob = 'import' | 'stop' | 'refine'

/** Avance de una pasada completa: ventanas de 30s transcriptas / total (sumando todos los canales). */
export interface TranscribeProgress {
  job: TranscribeJob
  done: number
  total: number
}
