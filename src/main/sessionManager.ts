import path from 'node:path'
import fs from 'node:fs/promises'
import type { WebContents } from 'electron'
import type {
  AudioSource,
  RecordMode,
  SessionMetadata,
  SttProvider,
  TranscribeProgress,
  TranscriptSegment
} from '../shared/types'
import type { WhisperCppEngine } from './stt/WhisperCppEngine'
import { AssemblyAiEngine } from './stt/AssemblyAiEngine'
import type { StreamingSttSession } from './stt/SttEngine'
import { WavWriter, float32ToPcm16, readWavAsFloat32, wavSampleCount } from './wavWriter'

// Umbral de energía (RMS) por debajo del cual se considera "silencio" y no
// se manda a transcribir con whisper (SÍ se sigue guardando a disco, para
// no perder continuidad del .wav) — sin esto, whisper alucina subtítulos
// típicos de su entrenamiento ("[Música]", "Gracias por ver el video")
// cuando le llega un chunk sin voz real. No aplica al modo `assemblyai`:
// un proveedor de streaming real ya hace su propio VAD como parte del
// turn-detection, aplicar esto ahí solo generaría huecos sin necesidad.
const SILENCE_RMS_THRESHOLD = 0.01

function computeRms(samples: Float32Array): number {
  let sumSquares = 0
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i]
  return Math.sqrt(sumSquares / samples.length)
}

const CHANNELS_BY_MODE: Record<RecordMode, AudioSource[]> = {
  'you-only': ['you'],
  'other-only': ['other'],
  'you-and-other': ['you', 'other']
}

// Ventana de 30s para transcribir audio largo de una sola pasada (refinar
// al cortar, refinar una sesión pasada, subir un audio externo) — bug real
// visto: pasarle a `@kutalia/whisper-node-addon` un buffer de varios
// minutos de una sola vez devolvía solo un fragmento corto con basura
// repetida ("we we we...", ">> >> >>"), no la transcripción completa. El
// addon está pensado ante todo para uso en tiempo real con chunks cortos
// (ver su propio README) — partir el audio en ventanas evita depender de
// que maneje bien buffers largos, sea cual sea la causa exacta interna.
// 30s en vez de los 6s del borrador en vivo: menos cortes de frase en el
// borde de cada ventana, sin volver a exponerse al bug de buffers largos.
const REFINE_CHUNK_SECONDS = 30
const SAMPLE_RATE = 16000

function splitIntoChunks(samples: Float32Array, chunkSeconds: number): Float32Array[] {
  const chunkSize = chunkSeconds * SAMPLE_RATE
  const chunks: Float32Array[] = []
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    chunks.push(samples.subarray(offset, offset + chunkSize))
  }
  return chunks
}

/** Se llama después de cada ventana transcripta — `done` de `total` ventanas de `REFINE_CHUNK_SECONDS`. */
export type OnTranscribeProgress = (progress: Omit<TranscribeProgress, 'job'>) => void

function countChunks(sampleCount: number): number {
  return Math.ceil(sampleCount / (REFINE_CHUNK_SECONDS * SAMPLE_RATE))
}

/**
 * Una ventana por fragmento, en vez de concatenar todo en un solo texto —
 * cada ventana de `REFINE_CHUNK_SECONDS` es la unidad citable (ver
 * `TranscriptSegment`): su índice ya da el timestamp (ventana 7 = 03:30)
 * sin depender de los timestamps de whisper, que con `no_timestamps`
 * vienen rotos (ver WhisperCppEngine.ts). Las ventanas sin voz no generan
 * fragmento.
 */
async function transcribeFullBuffer(
  whisperEngine: WhisperCppEngine,
  speaker: AudioSource,
  samples: Float32Array,
  onChunkDone?: () => void
): Promise<Omit<TranscriptSegment, 'id'>[]> {
  const windows: Omit<TranscriptSegment, 'id'>[] = []
  for (const [i, chunk] of splitIntoChunks(samples, REFINE_CHUNK_SECONDS).entries()) {
    const text = (await whisperEngine.transcribeChunk(chunk)).trim()
    if (text) windows.push({ speaker, startMs: i * REFINE_CHUNK_SECONDS * 1000, text })
    onChunkDone?.()
  }
  return windows
}

/**
 * Ordena cronológicamente (intercalando hablantes, así el LLM lee la
 * conversación en el orden en que pasó y no "todo Vos, después todo
 * Otros") y asigna ids `S1..Sn` estables para ese orden.
 */
function assignSegmentIds(windows: Omit<TranscriptSegment, 'id'>[]): TranscriptSegment[] {
  return [...windows]
    .sort((a, b) => a.startMs - b.startMs || (a.speaker === b.speaker ? 0 : a.speaker === 'you' ? -1 : 1))
    .map((w, i) => ({ id: `S${i + 1}`, ...w }))
}

/** El texto corrido por hablante que sigue yendo a `transcript.md` (formato legible para humanos/agentes, sin cambios). */
function joinBySpeaker(segments: TranscriptSegment[]): Partial<Record<AudioSource, string>> {
  const bySpeaker: Partial<Record<AudioSource, string[]>> = {}
  for (const s of segments) (bySpeaker[s.speaker] ??= []).push(s.text)
  return Object.fromEntries(Object.entries(bySpeaker).map(([speaker, texts]) => [speaker, texts.join(' ')]))
}

async function writeSegments(transcriptDir: string, segments: TranscriptSegment[]): Promise<string> {
  const segmentsFile = path.join(transcriptDir, 'segments.json')
  await fs.writeFile(segmentsFile, JSON.stringify(segments, null, 2), 'utf-8')
  return segmentsFile
}

/**
 * Pasada completa sobre uno o más .wav (un canal por hablante) con avance
 * GLOBAL — el total se calcula de antemano con el tamaño de cada archivo
 * (`wavSampleCount`) en vez de cargarlos todos juntos en RAM: una sesión
 * larga de dos canales serían cientos de MB de float32 al mismo tiempo.
 */
async function transcribeWavChannels(
  whisperEngine: WhisperCppEngine,
  files: [AudioSource, string][],
  onProgress?: OnTranscribeProgress
): Promise<TranscriptSegment[]> {
  const total = files.reduce((sum, [, filePath]) => sum + countChunks(wavSampleCount(filePath)), 0)
  let done = 0
  onProgress?.({ done, total })

  const windows: Omit<TranscriptSegment, 'id'>[] = []
  for (const [speaker, filePath] of files) {
    windows.push(
      ...(await transcribeFullBuffer(whisperEngine, speaker, readWavAsFloat32(filePath), () =>
        onProgress?.({ done: ++done, total })
      ))
    )
  }
  return assignSegmentIds(windows)
}

function makeSessionId(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function renderTranscriptMd(metadata: SessionMetadata, refined: Partial<Record<AudioSource, string>>): string {
  const minutes = Math.round(metadata.durationMs / 60000)
  const lines = [`# ${metadata.title} (${minutes} min, modo: ${metadata.recordMode}, motor: ${metadata.sttProvider})`, '']
  if (metadata.recordMode !== 'other-only') {
    lines.push('## Vos', '', refined.you?.trim() || '(sin voz reconocible)', '')
  }
  if (metadata.recordMode !== 'you-only') {
    lines.push('## Otros', '', refined.other?.trim() || '(sin voz reconocible)', '')
  }
  return lines.join('\n')
}

export interface StartSessionOptions {
  mode: RecordMode
  sttProvider: SttProvider
  audioBaseDir: string
  transcriptBaseDir: string
  /** Instancia compartida a nivel app — no se crea una por sesión para no recargar el modelo cada vez (ver index.ts). Modelo rápido ("small"), para el borrador chunk a chunk. */
  whisperEngine: WhisperCppEngine
  /** Instancia separada con un modelo más grande y preciso ("large-v3-turbo") — solo se usa para la pasada completa al cortar (`stop()`), donde la latencia no importa tanto. */
  whisperRefineEngine: WhisperCppEngine
  assemblyAiApiKey?: string
}

export interface StopSessionResult {
  metadata: SessionMetadata
  /** Fragmentos citables de la pasada final — el renderer los muestra como refinado editable, uno por fragmento. */
  segments: TranscriptSegment[]
}

export interface ImportAudioOptions {
  pcmf32: Float32Array
  title: string
  audioBaseDir: string
  transcriptBaseDir: string
  /** El modelo preciso ("large-v3-turbo") — subir un archivo es siempre una pasada completa, no live, así que conviene la mejor calidad. */
  whisperRefineEngine: WhisperCppEngine
  /** Avance por ventana — un audio largo con large-v3-turbo tarda minutos, sin esto la UI queda muda en "Procesando...". */
  onProgress?: OnTranscribeProgress
}

/**
 * "Subir un audio externo" (TranscriptPanel) pasaba solo por
 * `stt:transcribe` — transcribía pero nunca quedaba nada guardado (ni
 * carpeta de audio, ni transcript.md/metadata.json), así que no aparecía
 * en el tab "Sesiones". Esto arma una sesión completa de una sola pasada
 * a partir de un buffer ya decodificado, reusando las mismas piezas que
 * una grabación en vivo (`WavWriter`, whisper, `renderTranscriptMd`) — se
 * modela como una sesión `you-only` de un solo canal, transcripta siempre
 * con whisper local (no tiene sentido "streaming en vivo" para un archivo
 * que ya está completo de entrada).
 */
export async function importAudioFile(opts: ImportAudioOptions): Promise<{ metadata: SessionMetadata; text: string }> {
  const sessionId = makeSessionId(new Date())
  const audioDir = path.join(opts.audioBaseDir, sessionId)
  const transcriptDir = path.join(opts.transcriptBaseDir, sessionId)
  const audioFile = path.join(audioDir, 'you.wav')

  const writer = new WavWriter(audioFile)
  writer.writeFloat32(opts.pcmf32)
  writer.close()

  const total = countChunks(opts.pcmf32.length)
  let done = 0
  opts.onProgress?.({ done, total })
  const segments = assignSegmentIds(
    await transcribeFullBuffer(opts.whisperRefineEngine, 'you', opts.pcmf32, () =>
      opts.onProgress?.({ done: ++done, total })
    )
  )
  const text = joinBySpeaker(segments).you ?? ''

  await fs.mkdir(transcriptDir, { recursive: true })
  const segmentsFile = await writeSegments(transcriptDir, segments)
  const now = new Date().toISOString()

  const metadata: SessionMetadata = {
    sessionId,
    title: opts.title,
    startedAt: now,
    endedAt: now,
    durationMs: Math.round((opts.pcmf32.length / 16000) * 1000), // el buffer ya viene a 16kHz mono
    recordMode: 'you-only',
    sttProvider: 'whisper-local',
    audioFiles: { you: audioFile },
    transcriptFile: path.join(transcriptDir, 'transcript.md'),
    segmentsFile
  }

  await fs.writeFile(metadata.transcriptFile, renderTranscriptMd(metadata, { you: text }), 'utf-8')
  await fs.writeFile(path.join(transcriptDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')

  return { metadata, text }
}

export interface RefineSessionOptions {
  sessionId: string
  transcriptBaseDir: string
  /** El modelo preciso ("large-v3-turbo") — "Refinar" es siempre a pedido, no en vivo, así que conviene la mejor calidad. */
  whisperRefineEngine: WhisperCppEngine
  onProgress?: OnTranscribeProgress
}

/**
 * Re-transcribe con whisper local el audio YA guardado de una sesión
 * pasada (tab "Sesiones") — el .wav de cada canal se guarda siempre, sea
 * cual sea el proveedor de STT usado al grabar (`SessionManager.onAudioChunk`
 * escribe a disco antes de rutear al motor), así que esto sirve para
 * cualquier sesión. Pensado sobre todo para mejorar sesiones grabadas con
 * AssemblyAI: ese modo solo concatena resultados en vivo, sin una pasada
 * completa de una sola vez como sí hace whisper — acá se consigue esa
 * pasada completa después, a pedido.
 */
export async function refineSession(
  opts: RefineSessionOptions
): Promise<{ metadata: SessionMetadata; transcriptText: string; segments: TranscriptSegment[] }> {
  const sessionDir = path.join(opts.transcriptBaseDir, opts.sessionId)
  const metadataFile = path.join(sessionDir, 'metadata.json')
  const metadata: SessionMetadata = JSON.parse(await fs.readFile(metadataFile, 'utf-8'))

  const files = (Object.entries(metadata.audioFiles) as [AudioSource, string | undefined][]).filter(
    (entry): entry is [AudioSource, string] => Boolean(entry[1])
  )
  const segments = await transcribeWavChannels(opts.whisperRefineEngine, files, opts.onProgress)

  const transcriptText = renderTranscriptMd(metadata, joinBySpeaker(segments))
  await fs.writeFile(metadata.transcriptFile, transcriptText, 'utf-8')

  // Sesiones grabadas antes de las citas no tienen `segments.json` —
  // refinar es justamente el camino para "habilitarles" las referencias.
  metadata.segmentsFile = await writeSegments(sessionDir, segments)
  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8')

  return { metadata, transcriptText, segments }
}

/** `[]` si la sesión es anterior a las citas (no tiene `segments.json`) — la UI cae al transcript.md plano, sin referencias. */
export async function readSessionSegments(transcriptBaseDir: string, sessionId: string): Promise<TranscriptSegment[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(transcriptBaseDir, sessionId, 'segments.json'), 'utf-8'))
  } catch {
    return []
  }
}

/**
 * Dueño de una grabación en curso. Antes de esto no existía ningún objeto
 * que supiera "hay una sesión activa" — todo era stateless por chunk. Se
 * encarga de:
 *  - crear las carpetas `audioBaseDir/<sessionId>/` y `transcriptBaseDir/<sessionId>/`
 *  - escribir el audio real a disco (WAV) canal por canal a medida que llega
 *    (corrige el bug conocido de `sttSession.ts`: antes vivía solo en RAM)
 *  - rutear cada chunk al motor STT activo: whisper local por chunk de
 *    ~6s (comportamiento de siempre), o una `StreamingSttSession` por
 *    canal si el proveedor es AssemblyAI (streaming real)
 *  - empujar los resultados (parciales o finales) al renderer vía
 *    `session:segment`, no como valor de retorno de la llamada que manda
 *    el audio — con AssemblyAI el resultado llega asincrónico, no como
 *    respuesta directa a haber mandado ese chunk puntual
 */
export class SessionManager {
  readonly sessionId: string
  private readonly mode: RecordMode
  private readonly sttProvider: SttProvider
  private readonly channels: AudioSource[]
  private readonly startedAt: Date
  private readonly audioDir: string
  private readonly transcriptDir: string
  private readonly wavWriters: Partial<Record<AudioSource, WavWriter>> = {}
  private readonly streamingSessions: Partial<Record<AudioSource, StreamingSttSession>> = {}
  /** Turnos finales de AssemblyAI con su id/tiempo en vivo — son la transcripción final en ese modo (no hay pasada de whisper al cortar). */
  private readonly finalSegments: Omit<TranscriptSegment, 'id'>[] = []
  /**
   * Muestras ya escritas a cada .wav — es el "reloj" de ese canal: el
   * offset de un chunk ACÁ es exactamente dónde cae en el audio guardado
   * (lo que pausa no se escribe, así que no hay que descontar pausas).
   */
  private readonly samplesWritten: Record<AudioSource, number> = { you: 0, other: 0 }
  /** Turno de AssemblyAI abierto por canal — mismo id para sus parciales y su final. */
  private readonly openTurns: Partial<Record<AudioSource, { id: string; startMs: number }>> = {}
  private liveSegmentCount = 0
  private paused = false
  private stopped = false

  private constructor(
    private readonly webContents: WebContents,
    private readonly opts: StartSessionOptions
  ) {
    this.startedAt = new Date()
    this.sessionId = makeSessionId(this.startedAt)
    this.mode = opts.mode
    this.sttProvider = opts.sttProvider
    this.channels = CHANNELS_BY_MODE[opts.mode]
    this.audioDir = path.join(opts.audioBaseDir, this.sessionId)
    this.transcriptDir = path.join(opts.transcriptBaseDir, this.sessionId)
  }

  static async start(webContents: WebContents, opts: StartSessionOptions): Promise<SessionManager> {
    const manager = new SessionManager(webContents, opts)

    for (const speaker of manager.channels) {
      manager.wavWriters[speaker] = new WavWriter(path.join(manager.audioDir, `${speaker}.wav`))
    }

    if (opts.sttProvider === 'assemblyai') {
      if (!opts.assemblyAiApiKey) {
        throw new Error('Falta configurar la API key de AssemblyAI en Ajustes.')
      }
      const engine = new AssemblyAiEngine(opts.assemblyAiApiKey)
      for (const speaker of manager.channels) {
        const session = await engine.createSession()
        session.onTranscript((partial, text) => {
          // El turno "empieza" cuando llega su primer parcial — un poco
          // después de que se empezó a hablar (latencia del streaming),
          // aceptable para saltar al audio.
          const turn = (manager.openTurns[speaker] ??= {
            id: manager.nextLiveId(),
            startMs: manager.channelTimeMs(speaker)
          })
          if (!partial) {
            manager.finalSegments.push({ speaker, startMs: turn.startMs, text })
            delete manager.openTurns[speaker]
          }
          manager.emitSegment({ id: turn.id, speaker, startMs: turn.startMs, text, isFinal: !partial })
        })
        manager.streamingSessions[speaker] = session
      }
    }

    return manager
  }

  /** Ids del borrador en vivo con prefijo `L` — distintos de los `S` de la pasada final, así una cita vieja del chat nunca apunta al fragmento equivocado. */
  private nextLiveId(): string {
    return `L${++this.liveSegmentCount}`
  }

  private channelTimeMs(speaker: AudioSource): number {
    return Math.round((this.samplesWritten[speaker] / SAMPLE_RATE) * 1000)
  }

  private emitSegment(segment: TranscriptSegment & { isFinal: boolean }): void {
    if (this.webContents.isDestroyed()) return
    this.webContents.send('session:segment', segment)
  }

  onAudioChunk(speaker: AudioSource, samples: Float32Array): void {
    if (this.stopped || this.paused) return
    const startMs = this.channelTimeMs(speaker)
    this.wavWriters[speaker]?.writeFloat32(samples)
    this.samplesWritten[speaker] += samples.length

    if (this.sttProvider === 'whisper-local') {
      if (computeRms(samples) < SILENCE_RMS_THRESHOLD) return
      this.opts.whisperEngine
        .transcribeChunk(samples)
        .then((text) => {
          // El id se asigna al tener texto (no al llegar el chunk): la cola
          // nativa es FIFO, así que el orden de ids sigue igual al del audio.
          if (text.trim()) this.emitSegment({ id: this.nextLiveId(), speaker, startMs, text: text.trim(), isFinal: true })
        })
        .catch((err) => console.error('[SessionManager] error transcribiendo con whisper:', err))
    } else {
      this.streamingSessions[speaker]?.sendAudio(float32ToPcm16(samples))
    }
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  async stop(onProgress?: OnTranscribeProgress): Promise<StopSessionResult> {
    this.stopped = true

    for (const writer of Object.values(this.wavWriters)) writer?.close()
    for (const session of Object.values(this.streamingSessions)) await session?.stop()

    let segments: TranscriptSegment[]
    if (this.sttProvider === 'whisper-local') {
      // Ya no hay buffers en RAM (Fase 5 vieja) — el .wav recién cerrado en
      // disco es la fuente de verdad. Se re-transcribe cada canal completo
      // de una sola pasada leyendo el archivo, igual de bien que antes pero
      // sin haber tenido que retener nada en memoria durante la grabación.
      const files = this.channels.map((speaker): [AudioSource, string] => [
        speaker,
        path.join(this.audioDir, `${speaker}.wav`)
      ])
      segments = await transcribeWavChannels(this.opts.whisperRefineEngine, files, onProgress)
    } else {
      segments = assignSegmentIds(this.finalSegments)
    }

    await fs.mkdir(this.transcriptDir, { recursive: true })
    const segmentsFile = await writeSegments(this.transcriptDir, segments)
    const endedAt = new Date()

    const audioFiles: Partial<Record<AudioSource, string>> = {}
    for (const speaker of this.channels) {
      audioFiles[speaker] = path.join(this.audioDir, `${speaker}.wav`)
    }

    const metadata: SessionMetadata = {
      sessionId: this.sessionId,
      title: this.sessionId,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - this.startedAt.getTime(),
      recordMode: this.mode,
      sttProvider: this.sttProvider,
      audioFiles,
      transcriptFile: path.join(this.transcriptDir, 'transcript.md'),
      segmentsFile
    }

    await fs.writeFile(metadata.transcriptFile, renderTranscriptMd(metadata, joinBySpeaker(segments)), 'utf-8')
    await fs.writeFile(path.join(this.transcriptDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')

    return { metadata, segments }
  }
}
