import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { startSttSession } from './sttSession'
import type { ConversationSegment, SessionMetadata, TranscribeProgress, TranscriptSegment } from '../shared/types'
import type { AppSettings, LlmProvider } from '../main/settingsStore'

// Puente entre main y renderer.
contextBridge.exposeInMainWorld('jaime', {
  // Sesión de grabación en vivo: transcripción por chunks (whisper local)
  // o streaming real (AssemblyAI) según Ajustes, con el audio real
  // persistiéndose a disco del lado de main a medida que se graba (ver
  // sttSession.ts / sessionManager.ts). Soporta pausar/reanudar.
  startSttSession,

  // Transcribir un buffer de audio ya decodificado a PCM float32 16kHz sin
  // crear ninguna sesión — queda por compatibilidad, pero "subir un audio
  // externo" (TranscriptPanel) usa `importAudioSession` de abajo, que sí
  // guarda la sesión completa.
  transcribeAudioBuffer: (pcmf32: Float32Array): Promise<string> =>
    ipcRenderer.invoke('stt:transcribe', pcmf32),
  importAudioSession: (pcmf32: Float32Array, title: string): Promise<{ metadata: SessionMetadata; text: string }> =>
    ipcRenderer.invoke('session:import-audio', pcmf32, title),
  // Avance de las pasadas completas de whisper (importar, detener, refinar)
  // — ventanas de 30s transcriptas / total. Ver `useTranscribeProgress`.
  onTranscribeProgress: (cb: (progress: TranscribeProgress) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, progress: TranscribeProgress) => cb(progress)
    ipcRenderer.on('transcribe:progress', listener)
    return () => ipcRenderer.off('transcribe:progress', listener)
  },

  // Preguntar algo sobre la conversación en curso. El transcript que se
  // manda es el que tenga armado el renderer (borrador en vivo o refinado
  // con correcciones, según App.tsx). `chatId` identifica de qué chat viene
  // la pregunta — lo usa `ClaudeCliEngine` para saber si abrir sesión
  // nueva o hacer `--resume`; los demás proveedores lo ignoran.
  askQuestion: (question: string, transcript: ConversationSegment[], chatId: string): Promise<string> =>
    ipcRenderer.invoke('llm:ask', question, transcript, chatId),

  // Proveedor de LLM/STT + API keys + rutas de guardado, persistidos en main (settingsStore.ts).
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', partial),
  testLlmKey: (provider: LlmProvider, apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('settings:test-key', provider, apiKey),
  testSttKey: (apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke('settings:test-stt-key', apiKey),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-folder'),
  showItemInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('shell:show-item', filePath),
  openPath: (dirPath: string): Promise<void> => ipcRenderer.invoke('shell:open-path', dirPath),

  // Sesiones pasadas (tab "Sesiones"): listado, lectura de transcript/audio, renombrar y borrar.
  listSessions: (): Promise<SessionMetadata[]> => ipcRenderer.invoke('sessions:list'),
  readSessionTranscript: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('sessions:read-transcript', filePath),
  readSessionAudio: (filePath: string): Promise<Uint8Array> => ipcRenderer.invoke('sessions:read-audio', filePath),
  renameSession: (sessionId: string, title: string): Promise<SessionMetadata> =>
    ipcRenderer.invoke('sessions:rename', sessionId, title),
  deleteSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:delete', sessionId),
  refineSession: (
    sessionId: string
  ): Promise<{ metadata: SessionMetadata; transcriptText: string; segments: TranscriptSegment[] }> =>
    ipcRenderer.invoke('sessions:refine', sessionId),
  readSessionSegments: (sessionId: string): Promise<TranscriptSegment[]> =>
    ipcRenderer.invoke('sessions:read-segments', sessionId),

  // Modo compacto: la ventana se achica sola al perder foco (ver
  // main/index.ts) — esto solo avisa al renderer para que cambie de UI
  // (barra completa <-> burbuja), y permite pedir volver a expandir.
  onWindowModeChange: (cb: (mode: 'expanded' | 'compact' | 'popup') => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, mode: 'expanded' | 'compact' | 'popup') => cb(mode)
    ipcRenderer.on('window:mode', listener)
    return () => ipcRenderer.off('window:mode', listener)
  },
  getWindowMode: (): Promise<'expanded' | 'compact' | 'popup'> => ipcRenderer.invoke('window:get-mode'),
  expandWindow: (): Promise<void> => ipcRenderer.invoke('window:expand'),
  openChatPopup: (): Promise<void> => ipcRenderer.invoke('window:open-chat'),
  minimizeToBubble: (): Promise<void> => ipcRenderer.invoke('window:minimize-to-bubble'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close')
})
