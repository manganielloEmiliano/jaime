import 'dotenv/config'
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell, type Rectangle, type WebContents } from 'electron'
import { initMain } from 'electron-audio-loopback'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { AudioSource, ConversationSegment, RecordMode, TranscribeJob, TranscribeProgress } from '../shared/types'
import { WhisperCppEngine } from './stt/WhisperCppEngine'
import { AssemblyAiEngine } from './stt/AssemblyAiEngine'
import type { LlmEngine } from './llm/LlmEngine'
import { GeminiEngine } from './llm/GeminiEngine'
import { DeepSeekEngine } from './llm/DeepSeekEngine'
import { ClaudeCliEngine } from './llm/ClaudeCliEngine'
import { SettingsStore, type AppSettings, type LlmProvider } from './settingsStore'
import {
  importAudioFile,
  readSessionSegments,
  refineSession,
  SessionManager,
  type OnTranscribeProgress
} from './sessionManager'

// Registra los handlers de enable/disable-loopback-audio contra la sesión
// default. Tiene que llamarse antes de que el renderer pida
// getLoopbackAudioMediaStream() — se hace acá, al levantar el proceso main.
initMain()

let mainWebContents: WebContents | null = null
let mainWindow: BrowserWindow | null = null

// --- Tres modos de ventana:
//  - "expanded": la app completa (transcripción, sesiones, ajustes).
//  - "compact": al perder foco, se achica a un clúster de círculos chicos
//    (grabar/pausar, detener si hay sesión activa, burbuja de chat) anclado
//    abajo a la derecha — un widget flotante, no una ventana con contenido.
//  - "popup": al tocar la burbuja de chat, se agranda un poco (pegado al
//    mismo lugar) para mostrar SOLO el chat, sin restaurar toda la app.
// En los tres casos es la MISMA ventana/proceso — nunca se recarga la
// página, solo se le cambian bounds y se le avisa al renderer por
// `window:mode` qué UI mostrar. Así ni la sesión de grabación ni el
// historial del chat se pierden al cambiar de modo (ver App.tsx).
type WindowMode = 'expanded' | 'compact' | 'popup'
const EXPANDED_SIZE = { width: 480, height: 760 }
const COMPACT_SIZE = { width: 170, height: 56 }
const POPUP_SIZE = { width: 320, height: 440 }
const COMPACT_MARGIN = 16

let windowMode: WindowMode = 'expanded'
let expandedBounds: Rectangle | null = null

// Cambiar de modo a propósito (abrir el popup, expandir, minimizar) implica
// `setBounds`/`focus()` — en una ventana sin marco eso puede disparar un
// `blur` espurio de rebote (viste esto como un bug real: doble click en la
// burbuja mandaba `click` y `dblclick` seguidos, cada uno resizeaba la
// ventana, y el resize intermedio generaba un blur que pisaba el modo final
// con bounds gigantes). Mientras dure este margen, `blur` se ignora — no es
// "el usuario clickeó afuera", es ruido de la propia ventana moviéndose.
const BLUR_SUPPRESS_MS = 400
let suppressBlurUntil = 0

function markDeliberateModeChange(): void {
  suppressBlurUntil = Date.now() + BLUR_SUPPRESS_MS
}

function anchoredBottomRight(win: BrowserWindow, size: { width: number; height: number }): Rectangle {
  const { workArea } = screen.getDisplayMatching(win.getBounds())
  return {
    x: workArea.x + workArea.width - size.width - COMPACT_MARGIN,
    y: workArea.y + workArea.height - size.height - COMPACT_MARGIN,
    ...size
  }
}

// Fallback de `window:expand` cuando nunca se guardó un `expandedBounds`
// real — reusar la posición ACTUAL (compacta/popup, pegada a una esquina)
// con el tamaño grande hubiera dejado la ventana mal ubicada (la típica
// esquina de una burbuja no tiene lugar para 480x760 al lado).
function centeredDefaultBounds(win: BrowserWindow): Rectangle {
  const { workArea } = screen.getDisplayMatching(win.getBounds())
  return {
    x: workArea.x + Math.round((workArea.width - EXPANDED_SIZE.width) / 2),
    y: workArea.y + Math.round((workArea.height - EXPANDED_SIZE.height) / 2),
    ...EXPANDED_SIZE
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...EXPANDED_SIZE,
    resizable: true,
    alwaysOnTop: true,
    // Sin esto, Windows trata un doble click sobre cualquier zona
    // `-webkit-app-region: drag` (topbar, mini-bar, header del popup) como
    // el gesto nativo de "maximizar" de una barra de título — es lo que
    // infló la ventana a pantalla completa al doble-clickear la burbuja.
    // Esta app no tiene ningún concepto de "maximizado", así que se
    // deshabilita del todo en vez de manejarlo.
    maximizable: false,
    // Sin marco nativo: la ventana en modo compacto tiene que verse como
    // una burbuja flotante, no una ventanita chica con título + botones de
    // sistema. El costo es que hay que armar a mano la zona de arrastre
    // (CSS `-webkit-app-region: drag` en topbar/mini-bar) y un botón de
    // cerrar propio (ver `window:close` más abajo y el botón ✕ en App.tsx)
    // — sin esto la ventana quedaría inamovible y sin forma de cerrarla.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron sandboxea el preload por default desde la v20: en modo
      // sandbox, require() dentro del preload solo resuelve un puñado de
      // módulos internos, no paquetes de node_modules como
      // electron-audio-loopback (por eso el "module not found" de recién).
      // Se desactiva para este preload puntual — la página en sí sigue
      // aislada por contextIsolation, que es la barrera que importa acá.
      sandbox: false
    }
  })

  mainWebContents = win.webContents
  mainWindow = win

  win.on('blur', () => {
    if (Date.now() < suppressBlurUntil) return // blur de rebote de un cambio de modo deliberado, no un click afuera real
    if (windowMode === 'compact') return // ya achicada — no reescribir expandedBounds con los bounds compactos/popup
    if (windowMode === 'expanded') expandedBounds = win.getBounds()
    windowMode = 'compact'
    win.setBounds(anchoredBottomRight(win, COMPACT_SIZE))
    win.webContents.send('window:mode', 'compact' satisfies WindowMode)
  })

  // Debug temporal (POC): forwardear los console.log/error del renderer a
  // la terminal de main, así no hay que pedir screenshots para ver errores
  // de React. Sacar cuando esto deje de ser un prototipo.
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.log(`[did-fail-load] ${errorCode} ${errorDescription}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('window:close', () => mainWindow?.close())

// En dev, `openDevTools({mode:'detach'})` le saca el foco a esta ventana
// casi al instante (dispara `blur` antes de que el renderer llegue a
// suscribirse a `window:mode`) — el push queda "perdido" y el renderer se
// desincroniza (bounds ya achicados, pero mostrando la UI completa). Este
// endpoint deja que el renderer se sincronice ACTIVAMENTE al montar, en
// vez de depender solo de haber escuchado el evento a tiempo.
ipcMain.handle('window:get-mode', (): WindowMode => windowMode)

// Burbuja de chat tocada en modo compacto: NO restaura la app completa —
// agranda un poco la ventana, pegada al mismo lugar, para mostrar solo el chat.
ipcMain.handle('window:open-chat', () => {
  if (!mainWindow) return
  markDeliberateModeChange()
  windowMode = 'popup'
  mainWindow.setBounds(anchoredBottomRight(mainWindow, POPUP_SIZE))
  mainWindow.focus()
  mainWindow.webContents.send('window:mode', 'popup' satisfies WindowMode)
})

// Botón "▼ Minimizar" del popup de chat: volver al clúster de círculos sin
// depender de perder foco (el click en ese botón no dispara `blur`, ya que
// pasa adentro de la misma ventana).
ipcMain.handle('window:minimize-to-bubble', () => {
  if (!mainWindow) return
  markDeliberateModeChange()
  windowMode = 'compact'
  mainWindow.setBounds(anchoredBottomRight(mainWindow, COMPACT_SIZE))
  mainWindow.webContents.send('window:mode', 'compact' satisfies WindowMode)
})

ipcMain.handle('window:expand', () => {
  if (!mainWindow) return
  markDeliberateModeChange()
  windowMode = 'expanded'
  // Si nunca hubo un tamaño "expandido" real que recordar (ej.: se pidió
  // expandir directo desde la burbuja sin haber pasado antes por la app
  // completa), no reusar la posición actual (podría ser la esquina donde
  // vive la burbuja/popup) — se centra en la pantalla con el tamaño default.
  const bounds = expandedBounds ?? centeredDefaultBounds(mainWindow)
  mainWindow.setBounds(bounds)
  mainWindow.focus()
  mainWindow.webContents.send('window:mode', 'expanded' satisfies WindowMode)
})

// Instancia compartida a nivel app, reusada entre chunks y entre sesiones —
// no se sabe si `@kutalia/whisper-node-addon` cachea el modelo cargado
// entre llamadas o lo recarga de disco cada vez (la lib no expone una API
// separada de "cargar modelo una vez"), así que se evita crear más de una
// instancia para no arriesgar esa latencia.
const whisperEngine = new WhisperCppEngine()
// Modelo separado, más grande y preciso ("large-v3-turbo", 1.62GB) — solo
// para pasadas completas a pedido (refinar al cortar, refinar una sesión
// pasada, subir un audio externo), donde la latencia no importa tanto.
const whisperRefineEngine = new WhisperCppEngine('ggml-large-v3-turbo.bin')

ipcMain.handle('stt:transcribe', async (_event, pcmf32: Float32Array) => {
  return whisperEngine.transcribeChunk(pcmf32)
})

const settingsStore = new SettingsStore()
settingsStore.seedFromEnvIfEmpty()

// Instancia compartida a nivel app (no una por pregunta como Gemini/
// DeepSeek): necesita recordar la sesión de `claude --resume` abierta por
// cada chat entre una pregunta y la siguiente (ver ClaudeCliEngine).
const claudeCliEngine = new ClaudeCliEngine()

function createLlmEngine(settings: AppSettings): LlmEngine {
  if (settings.llmProvider === 'claude-cli') {
    claudeCliEngine.setModel(settings.claudeModel)
    return claudeCliEngine
  }

  const apiKey = settings.apiKeys[settings.llmProvider]
  if (!apiKey) {
    throw new Error(`Falta configurar la API key de ${settings.llmProvider} en Ajustes.`)
  }
  if (settings.llmProvider === 'deepseek') return new DeepSeekEngine(apiKey)
  return new GeminiEngine(apiKey)
}

// Se crea una instancia nueva por pregunta para Gemini/DeepSeek (no es
// costoso, a diferencia del WhisperCppEngine que sí carga un modelo
// pesado) — así un cambio de proveedor/key en Ajustes se aplica en la
// siguiente pregunta sin tener que reiniciar la app. `claude-cli` es la
// excepción (instancia compartida, ver arriba). `chatId` identifica de
// qué conversación viene la pregunta — lo usa `ClaudeCliEngine` para
// decidir sesión nueva vs `--resume`; los demás engines lo ignoran.
ipcMain.handle('llm:ask', async (_event, question: string, transcript: ConversationSegment[], chatId?: string) => {
  const engine = createLlmEngine(settingsStore.get())
  return engine.ask(question, transcript, chatId)
})

ipcMain.handle('settings:get', () => settingsStore.get())

ipcMain.handle('settings:set', (_event, partial: Partial<AppSettings>) => {
  settingsStore.update(partial)
  return settingsStore.get()
})

// Wizard de validación (Fase 4): prueba la key con una llamada mínima real
// antes de confirmar que quedó bien configurada, en vez de descubrir el
// error recién cuando el usuario pregunta algo en medio de una llamada.
ipcMain.handle('settings:test-key', async (_event, provider: LlmProvider, apiKey: string) => {
  // `claude-cli` no tiene key que probar — solo confirma que el CLI está instalado y accesible.
  if (provider === 'claude-cli') return ClaudeCliEngine.checkAvailable()

  try {
    const engine = provider === 'deepseek' ? new DeepSeekEngine(apiKey) : new GeminiEngine(apiKey)
    await engine.ask('Respondé simplemente "ok".', [])
    return { ok: true as const }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})

// Mismo wizard pero para la key de AssemblyAI (streaming) — separado del de
// arriba porque valida un proveedor de otra categoría (STT, no LLM).
ipcMain.handle('settings:test-stt-key', async (_event, apiKey: string) => {
  return AssemblyAiEngine.testApiKey(apiKey)
})

ipcMain.handle('settings:choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// Para señalarle la carpeta de una sesión a Claude Code (u otro agente) o
// simplemente revisarla a mano — abre el explorador de archivos nativo.
ipcMain.handle('shell:show-item', (_event, filePath: string) => {
  shell.showItemInFolder(filePath) // abre la carpeta contenedora con el archivo ya seleccionado
})

ipcMain.handle('shell:open-path', (_event, dirPath: string) => {
  return shell.openPath(dirPath) // abre la carpeta directo (usado para las rutas base de Ajustes)
})

// --- Sesiones: una grabación = una carpeta de audio + una carpeta de
// transcript, ambas creadas al arrancar y cerradas/persistidas al parar.
// Reemplaza el pipeline stateless por chunk que usaba directo `stt:transcribe`.
let activeSession: SessionManager | null = null

ipcMain.handle('session:start', async (_event, args: { mode: RecordMode }) => {
  if (!mainWebContents) throw new Error('La ventana principal no está lista.')
  const settings = settingsStore.get()

  activeSession = await SessionManager.start(mainWebContents, {
    mode: args.mode,
    sttProvider: settings.sttProvider,
    audioBaseDir: settings.audioBaseDir,
    transcriptBaseDir: settings.transcriptBaseDir,
    whisperEngine,
    whisperRefineEngine,
    assemblyAiApiKey: settings.apiKeys.assemblyai
  })

  return { sessionId: activeSession.sessionId, sttProvider: settings.sttProvider }
})

// Las tres pasadas completas de whisper (importar, detener, refinar) avisan
// su avance por el mismo canal — el `job` le dice a cada vista cuál es la suya.
function progressSender(sender: WebContents, job: TranscribeJob): OnTranscribeProgress {
  return ({ done, total }) => {
    if (!sender.isDestroyed()) sender.send('transcribe:progress', { job, done, total } satisfies TranscribeProgress)
  }
}

// "Subir un audio externo" (TranscriptPanel): antes solo transcribía vía
// `stt:transcribe` sin guardar nada — ahora arma una sesión completa
// (carpeta de audio + transcript.md + metadata.json), así aparece en el
// tab "Sesiones" igual que una grabación en vivo.
ipcMain.handle('session:import-audio', async (event, pcmf32: Float32Array, title: string) => {
  const settings = settingsStore.get()
  return importAudioFile({
    pcmf32,
    title,
    audioBaseDir: settings.audioBaseDir,
    transcriptBaseDir: settings.transcriptBaseDir,
    whisperRefineEngine,
    onProgress: progressSender(event.sender, 'import')
  })
})

ipcMain.handle('session:audio-chunk', (_event, args: { speaker: AudioSource; samples: Float32Array }) => {
  activeSession?.onAudioChunk(args.speaker, args.samples)
})

ipcMain.handle('session:pause', () => activeSession?.pause())
ipcMain.handle('session:resume', () => activeSession?.resume())

ipcMain.handle('session:stop', async (event) => {
  if (!activeSession) throw new Error('No hay ninguna sesión activa.')
  const result = await activeSession.stop(progressSender(event.sender, 'stop'))
  activeSession = null
  return result
})

// --- Sesiones pasadas: listado + lectura de transcript/audio para el tab "Sesiones" ---
ipcMain.handle('sessions:list', async () => {
  const { transcriptBaseDir } = settingsStore.get()
  try {
    const entries = await fs.readdir(transcriptBaseDir, { withFileTypes: true })
    const sessions = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          try {
            const raw = await fs.readFile(path.join(transcriptBaseDir, e.name, 'metadata.json'), 'utf-8')
            return JSON.parse(raw)
          } catch {
            return null
          }
        })
    )
    return sessions.filter((s) => s !== null).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  } catch {
    return []
  }
})

ipcMain.handle('sessions:read-transcript', async (_event, filePath: string) => {
  return fs.readFile(filePath, 'utf-8')
})

ipcMain.handle('sessions:read-audio', async (_event, filePath: string) => {
  return fs.readFile(filePath)
})

// Fragmentos citables (`segments.json`) — `[]` en sesiones anteriores a las citas.
ipcMain.handle('sessions:read-segments', async (_event, sessionId: string) => {
  return readSessionSegments(settingsStore.get().transcriptBaseDir, sessionId)
})

// Renombrar: pisa `title` en metadata.json Y el título en el encabezado de
// transcript.md (primera línea) — así la carpeta sigue siendo consistente
// para quien la abra directo (un agente, u otra persona), no solo la UI.
ipcMain.handle('sessions:rename', async (_event, sessionId: string, title: string) => {
  const { transcriptBaseDir } = settingsStore.get()
  const sessionDir = path.join(transcriptBaseDir, sessionId)
  const metadataFile = path.join(sessionDir, 'metadata.json')

  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf-8'))
  metadata.title = title
  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8')

  const transcriptLines = (await fs.readFile(metadata.transcriptFile, 'utf-8')).split('\n')
  transcriptLines[0] = transcriptLines[0].replace(/^# .*(\(.*\))$/, `# ${title} $1`)
  await fs.writeFile(metadata.transcriptFile, transcriptLines.join('\n'), 'utf-8')

  return metadata
})

// Re-transcribe con whisper local el audio ya guardado — sirve para
// cualquier sesión (el .wav se guarda sea cual sea el proveedor usado al
// grabar), pensado sobre todo para mejorar sesiones grabadas con
// AssemblyAI (que no hace una pasada completa como sí hace whisper).
ipcMain.handle('sessions:refine', async (event, sessionId: string) => {
  const { transcriptBaseDir } = settingsStore.get()
  return refineSession({
    sessionId,
    transcriptBaseDir,
    whisperRefineEngine,
    onProgress: progressSender(event.sender, 'refine')
  })
})

// Borrado real: saca tanto la carpeta de transcript como la de audio (si
// existe) — son dos carpetas separadas porque el usuario puede configurar
// rutas base distintas para cada una (ver Ajustes).
ipcMain.handle('sessions:delete', async (_event, sessionId: string) => {
  const { transcriptBaseDir } = settingsStore.get()
  const sessionDir = path.join(transcriptBaseDir, sessionId)

  let audioDir: string | null = null
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(sessionDir, 'metadata.json'), 'utf-8'))
    const firstAudioFile = Object.values(metadata.audioFiles ?? {})[0] as string | undefined
    if (firstAudioFile) audioDir = path.dirname(firstAudioFile)
  } catch {
    // sin metadata.json legible no hay forma de ubicar la carpeta de audio — se borra igual el transcript
  }

  await fs.rm(sessionDir, { recursive: true, force: true })
  if (audioDir) await fs.rm(audioDir, { recursive: true, force: true })
})

app.whenReady().then(() => {
  // `session.defaultSession` solo existe una vez que la app está ready —
  // por eso esto no puede ir a nivel de módulo (rompía con "Session can
  // only be received when app is ready"). Electron NO auto-otorga permisos
  // de mic/pantalla por default; como esta app es 100% first-party (el
  // mismo desarrollador controla todo el contenido que corre en la
  // ventana), se auto-otorgan acá en vez de mostrar un prompt del sistema
  // por cada llamada.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })

  // Sin esto, Electron pone el menú default (File/Edit/View/Window) — sin
  // sentido para esta app (no hay nada que esos items hagan acá) y, en
  // modo compacto, esos ~30px de menú + los del título nativo se comían
  // TODA la ventana de 64px de alto, dejando la barrita sin espacio visible
  // para renderizar nada (el bug real detrás de la ventana "vacía").
  Menu.setApplicationMenu(null)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
