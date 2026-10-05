export {}

declare global {
  type AudioSourceLabel = 'you' | 'other'
  type RecordMode = 'you-only' | 'other-only' | 'you-and-other'
  type LlmProvider = 'gemini' | 'deepseek' | 'claude-cli'
  type ClaudeModelTier = 'sonnet' | 'opus' | 'haiku'
  type SttProvider = 'whisper-local' | 'assemblyai'

  interface SttSegment {
    /** Id citable (`L12` en vivo, `S7` pasada completa) — ausente solo en sesiones viejas sin `segments.json`. */
    id?: string
    speaker: AudioSourceLabel
    /** Offset dentro del .wav de ese hablante (ms). */
    startMs?: number
    text: string
    isFinal: boolean
  }

  /** Fragmento de una pasada completa — ver shared/types.ts. */
  interface TranscriptSegment {
    id: string
    speaker: AudioSourceLabel
    startMs: number
    text: string
  }

  type TranscribeJob = 'import' | 'stop' | 'refine'

  interface TranscribeProgress {
    job: TranscribeJob
    done: number
    total: number
  }

  interface SttSession {
    pause: () => void
    resume: () => void
    /** Transcripción final, fragmento por fragmento — es lo que se muestra como "Refinado" editable. */
    stop: () => Promise<TranscriptSegment[]>
  }

  interface AppSettings {
    llmProvider: LlmProvider
    apiKeys: Partial<Record<LlmProvider | 'assemblyai', string>>
    claudeModel?: ClaudeModelTier
    sttProvider: SttProvider
    audioBaseDir: string
    transcriptBaseDir: string
  }

  type WindowMode = 'expanded' | 'compact' | 'popup'

  interface SessionMetadata {
    sessionId: string
    title: string
    startedAt: string
    endedAt: string
    durationMs: number
    recordMode: RecordMode
    sttProvider: SttProvider
    audioFiles: Partial<Record<AudioSourceLabel, string>>
    transcriptFile: string
  }

  interface ChatMessage {
    role: 'user' | 'assistant'
    text: string
    createdAt: string
  }

  type TestKeyResult = { ok: true } | { ok: false; error: string }

  interface Window {
    jaime: {
      startSttSession: (onSegment: (segment: SttSegment) => void, mode?: RecordMode) => Promise<SttSession>
      transcribeAudioBuffer: (pcmf32: Float32Array) => Promise<string>
      importAudioSession: (pcmf32: Float32Array, title: string) => Promise<{ metadata: SessionMetadata; text: string }>
      onTranscribeProgress: (cb: (progress: TranscribeProgress) => void) => () => void
      askQuestion: (question: string, transcript: SttSegment[], chatId: string) => Promise<string>
      getSettings: () => Promise<AppSettings>
      setSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
      testLlmKey: (provider: LlmProvider, apiKey: string) => Promise<TestKeyResult>
      testSttKey: (apiKey: string) => Promise<TestKeyResult>
      chooseFolder: () => Promise<string | null>
      showItemInFolder: (filePath: string) => Promise<void>
      openPath: (dirPath: string) => Promise<void>
      listSessions: () => Promise<SessionMetadata[]>
      readSessionTranscript: (filePath: string) => Promise<string>
      readSessionAudio: (filePath: string) => Promise<Uint8Array>
      renameSession: (sessionId: string, title: string) => Promise<SessionMetadata>
      deleteSession: (sessionId: string) => Promise<void>
      refineSession: (
        sessionId: string
      ) => Promise<{ metadata: SessionMetadata; transcriptText: string; segments: TranscriptSegment[] }>
      readSessionSegments: (sessionId: string) => Promise<TranscriptSegment[]>
      onWindowModeChange: (cb: (mode: WindowMode) => void) => () => void
      getWindowMode: () => Promise<WindowMode>
      expandWindow: () => Promise<void>
      openChatPopup: () => Promise<void>
      minimizeToBubble: () => Promise<void>
      closeWindow: () => Promise<void>
    }
  }
}
