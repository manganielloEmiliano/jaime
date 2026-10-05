import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SttProvider } from '../shared/types'

/**
 * Proveedor de LLM activo + API keys, y ahora también proveedor de STT +
 * rutas de guardado, todo persistido a `userData/settings.json` (no más
 * `.env`/hardcodeado). Gemini, DeepSeek y `claude-cli` son los únicos
 * `LlmEngine` implementados de verdad; Anthropic (API key paga por token)
 * y OpenAI siguen siendo stubs, no tiene sentido ofrecerlos en la UI
 * todavía.
 *
 * `claude-cli` no usa API key — corre contra la sesión de Claude Code ya
 * logueada en la máquina (spawnea el CLI `claude`), aprovechando la
 * suscripción ya paga en vez de facturar por token (ver `ClaudeCliEngine`).
 *
 * Modo A (LLM 100% local) del plan original sigue sin código real detrás.
 * Modo C (STT cloud) sí tiene una implementación real ahora: AssemblyAI
 * (streaming real, ver `stt/AssemblyAiEngine.ts`) — Azure Speech sigue
 * siendo stub, no se ofrece en Settings.
 */
export type LlmProvider = 'gemini' | 'deepseek' | 'claude-cli'

/** Alias de tier que entiende el CLI `claude --model` — no IDs con fecha a propósito, para no quedar obsoleto. */
export type ClaudeModelTier = 'sonnet' | 'opus' | 'haiku'

export interface AppSettings {
  llmProvider: LlmProvider
  apiKeys: Partial<Record<LlmProvider | 'assemblyai', string>>
  /** Solo aplica al proveedor `claude-cli` — `undefined` deja que el CLI use su propio default. */
  claudeModel?: ClaudeModelTier
  sttProvider: SttProvider
  /** Carpeta base donde se crea una subcarpeta `<sessionId>/` por cada grabación (audio .wav). */
  audioBaseDir: string
  /** Carpeta base donde se crea una subcarpeta `<sessionId>/` por cada grabación (transcript.md + metadata.json). */
  transcriptBaseDir: string
}

function defaultSettings(): AppSettings {
  return {
    llmProvider: 'gemini',
    apiKeys: {},
    sttProvider: 'whisper-local',
    audioBaseDir: path.join(app.getPath('documents'), 'Jaime', 'Audios'),
    transcriptBaseDir: path.join(app.getPath('documents'), 'Jaime', 'Transcripciones')
  }
}

export class SettingsStore {
  private settings: AppSettings
  private readonly filePath: string
  private readonly defaults: AppSettings

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'settings.json')
    this.defaults = defaultSettings()
    this.settings = this.load()
  }

  private load(): AppSettings {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return { ...this.defaults, ...parsed, apiKeys: { ...this.defaults.apiKeys, ...parsed.apiKeys } }
    } catch {
      return { ...this.defaults }
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2))
  }

  get(): AppSettings {
    return this.settings
  }

  update(partial: Partial<AppSettings>): void {
    this.settings = {
      ...this.settings,
      ...partial,
      apiKeys: { ...this.settings.apiKeys, ...partial.apiKeys }
    }
    this.persist()
  }

  /**
   * Migración de una sola vez desde el `.env` que se usaba antes de esta
   * fase — si `settings.json` no tiene todavía una key para un proveedor
   * dado pero el `.env` sí, se copia. Solo toca las API keys (guardado
   * detrás de un `if (!ya la tiene)`, así que es inofensivo repetirlo en
   * cada arranque).
   *
   * BUG REAL que hubo acá: el `llmProvider` (`LLM_PROVIDER` del `.env`)
   * se pisaba SIN ninguna guarda, en cada arranque de la app — no "una
   * sola vez" como decía este comentario, sino siempre. Resultado: elegías
   * `claude-cli` en Ajustes, quedaba bien guardado en `settings.json`, pero
   * al reabrir la app esto lo pisaba de vuelta a `gemini` (lo que hubiera
   * en el `.env`). Se saca esa parte — el proveedor de LLM ahora es
   * responsabilidad exclusiva de Ajustes/settings.json, el `.env` ya
   * cumplió su propósito de migración hace tiempo.
   */
  seedFromEnvIfEmpty(): void {
    let changed = false

    if (!this.settings.apiKeys.gemini && process.env.GEMINI_API_KEY) {
      this.settings.apiKeys.gemini = process.env.GEMINI_API_KEY
      changed = true
    }
    if (!this.settings.apiKeys.deepseek && process.env.DEEPSEEK_API_KEY) {
      this.settings.apiKeys.deepseek = process.env.DEEPSEEK_API_KEY
      changed = true
    }

    if (changed) this.persist()
  }
}
