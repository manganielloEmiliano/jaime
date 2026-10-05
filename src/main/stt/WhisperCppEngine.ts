// El paquete solo exporta `transcribe` como named export (sin `default`) —
// el import default que muestra su propio README depende del interop
// exacto del bundler, así que se usa el named import para no arriesgarse.
import { transcribe, type WhisperParams } from '@kutalia/whisper-node-addon'
import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import type { SttEngine } from './SttEngine'

// `prompt` no está en el tipo `WhisperOptions` documentado (`transcribe()`
// lo tipa así), pero SÍ lo lee el binding nativo — lo confirmé leyendo
// examples/addon.node/addon.cpp del fork de whisper.cpp que usa este
// addon: `params.prompt` mapea directo a `whisper_full_params.initial_prompt`.
// Sirve para sesgar el reconocimiento hacia grafías específicas (nombres
// propios, jerga técnica) en vez de que whisper las transcriba fonéticamente
// mal (el caso real que motivó esto: "OpenAI" saliendo como "OpenEye").
// TODO (Fase 4): hacerlo configurable por el usuario en vez de hardcodeado.
const INITIAL_PROMPT = 'OpenAI, GPT, Claude, Anthropic, Microsoft Teams, whisper.cpp'

// En dev, los modelos viven en `<repo>/models`. En un build empaquetado,
// `app.getAppPath()` apunta ADENTRO del .asar (solo lectura, y los .bin de
// varios cientos de MB no se bundlean ahí) — hay que leerlos de
// `process.resourcesPath`, que es donde electron-builder copia los
// `extraResources` (ver electron-builder config en package.json). Esto
// resuelve el TODO viejo que quedó pendiente hasta empaquetar la app.
function resolveModelsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(app.getAppPath(), 'models')
}

// Confirmado en pruebas reales: "small" (488MB) da mejor calidad que
// "base" (148MB) para el borrador en vivo — se mantiene como default acá,
// donde la latencia por chunk importa. Para el refinamiento (una sola
// pasada completa, no tan sensible a latencia) `index.ts` instancia este
// engine con "ggml-large-v3-turbo.bin" (1.62GB) — bastante más preciso,
// ~4x más lento, aceptable porque solo corre una vez al final.
const DEFAULT_MODEL_FILE = 'ggml-small.bin'

// Sin `n_threads`, whisper.cpp usa como mucho 4 hilos — en una máquina de
// 16 núcleos, importar un audio de ~20 min con large-v3-turbo quedaba
// minutos en "Procesando..." usando una fracción de la CPU. Se dejan 2
// núcleos libres para que la UI y el resto del sistema no se traben.
const N_THREADS = Math.max(1, os.cpus().length - 2)

/**
 * Modo A/B — STT 100% local vía whisper.cpp (@kutalia/whisper-node-addon,
 * binario prebuilt para win/mac/linux, sin compilar nada).
 *
 * `use_gpu: false` a propósito: no hay Vulkan SDK confirmado en esta
 * máquina, se prueba primero en CPU puro antes de arriesgar un crash de
 * driver. `no_timestamps: true` porque acá no los necesitamos (el
 * timestamp lo pone el que arma el TranscriptSegment, no whisper).
 *
 * IMPORTANTE: el default de la librería es `translate: true` (lo vi leyendo
 * su código fuente, no está en el README) — sin pisarlo, traduce el
 * español reconocido a inglés en vez de transcribirlo tal cual. Se fuerza
 * `translate: false` explícitamente por eso.
 *
 * IMPORTANTE #2: el addon nativo no soporta llamadas concurrentes — ni
 * siquiera entre dos instancias distintas de este engine (p.ej. el engine
 * "en vivo" con el modelo small y el engine de refinamiento con
 * large-v3-turbo que usa `sessionManager.ts` al cortar). El binding es un
 * singleton a nivel de módulo (`whisperAsync` en
 * `@kutalia/whisper-node-addon`), así que dos `transcribe()` en paralelo
 * pisan el mismo contexto nativo sin importar de qué instancia salgan: se
 * vio tanto como segfault (chunks de "you" y "other" casi simultáneos
 * sobre el mismo engine) como como `Error: no state` (el chunk en vivo
 * todavía en vuelo cuando arranca el refinamiento al apretar "Detener",
 * cada uno desde su propia instancia). Por eso la cola que serializa las
 * llamadas es compartida a nivel de módulo (`nativeQueue`, no un campo de
 * instancia) — nunca hay dos transcribe() nativos corriendo a la vez, sea
 * cual sea el engine o el canal.
 */

// Compartida por TODAS las instancias de WhisperCppEngine a propósito (ver
// comentario de la clase) — el addon nativo es un singleton de proceso, no
// algo que cada instancia pueda serializar por su cuenta.
let nativeQueue: Promise<unknown> = Promise.resolve()

export class WhisperCppEngine implements SttEngine {
  private readonly modelPath: string

  constructor(modelFile: string = DEFAULT_MODEL_FILE) {
    this.modelPath = path.join(resolveModelsDir(), modelFile)
  }

  async transcribeChunk(pcmf32: Float32Array): Promise<string> {
    const run = nativeQueue.then(() => this.runTranscribe(pcmf32))
    // Si un chunk falla, no dejar la cola trabada para el que sigue.
    nativeQueue = run.catch(() => undefined)
    return run
  }

  private async runTranscribe(pcmf32: Float32Array): Promise<string> {
    const options: WhisperParams = {
      pcmf32,
      model: this.modelPath,
      language: 'es',
      translate: false,
      use_gpu: false,
      no_timestamps: true,
      no_prints: true,
      n_threads: N_THREADS,
      prompt: INITIAL_PROMPT
    }
    const result = await transcribe(options)

    return extractText(result.transcription).trim()
  }
}

/**
 * `result.transcription` puede venir como `string[]` (un texto por
 * segmento) o `string[][]` (cada segmento como `[inicio, fin, texto]`,
 * pase lo que pase con `no_timestamps` — se vio en pruebas reales que
 * igual devuelve timestamps, y encima rotos con chunks de audio sueltos
 * sin offset absoluto, tipo "00:-16:-47.-280"). Hacer `.flat().join(' ')`
 * directo mezclaba esos timestamps con el texto real. Acá nos quedamos
 * solo con el último elemento de cada segmento (el texto), descartando
 * timestamps venga como venga la forma.
 */
function extractText(transcription: string[][] | string[]): string {
  if (!Array.isArray(transcription)) return ''
  return transcription
    .map((segment) => (Array.isArray(segment) ? segment[segment.length - 1] : segment))
    .join(' ')
}
