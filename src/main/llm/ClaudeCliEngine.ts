import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ConversationSegment } from '../../shared/types'
import type { LlmEngine } from './LlmEngine'
import { citationInstructions, renderTranscriptForPrompt } from './transcriptPrompt'

interface ChatSession {
  claudeSessionId: string
}

/**
 * Usa el CLI de Claude Code como subproceso en modo headless (`-p`), con
 * `--session-id`/`--resume` para mantener el HISTORIAL DE PREGUNTAS Y
 * RESPUESTAS entre turnos — mismo patrón ya probado en otro proyecto propio
 * (test-plan/web-ui/lib/chatRunner.ts). No hace falta ninguna API key: usa
 * la sesión de Claude Code ya logueada en esta máquina (la misma que usa
 * la terminal) — sin costo de API adicional, corre contra la suscripción
 * ya paga, y suele responder más rápido que armar una llamada nueva a la
 * API por cada pregunta.
 *
 * La transcripción en sí se manda ACTUALIZADA en cada pregunta (igual que
 * Gemini/DeepSeek), no solo la primera vez — bug real ya visto: la
 * transcripción de una grabación en curso sigue creciendo mientras se
 * habla, y `--resume` por sí solo NO le hace llegar a Claude nada dicho
 * después de la primera pregunta (solo mantiene el historial de charla,
 * no la fuente que cambia). Para una sesión ya cerrada (SessionDetail) el
 * transcript es estático, así que resendearlo no cambia nada — pero para
 * la grabación en vivo es imprescindible. Por eso esta instancia se
 * comparte a nivel app (no se crea una por pregunta como Gemini/DeepSeek)
 * — necesita recordar qué `claudeSessionId` le corresponde a cada `chatId`.
 */
export class ClaudeCliEngine implements LlmEngine {
  private readonly sessions = new Map<string, ChatSession>()
  private model: string | undefined

  /** Alias de tier ('sonnet'/'opus'/'haiku') que entiende `claude --model` — `undefined` deja el default del CLI. Se llama antes de cada `ask()` porque esta instancia es compartida (ver index.ts) y el modelo puede cambiar en Ajustes sin reiniciar la app. */
  setModel(model: string | undefined): void {
    this.model = model
  }

  async ask(question: string, transcript: ConversationSegment[], chatId = 'default'): Promise<string> {
    let session = this.sessions.get(chatId)
    const isFirstTurn = !session
    if (!session) {
      session = { claudeSessionId: randomUUID() }
      this.sessions.set(chatId, session)
    }

    const prompt = `Estas son las transcripciones de una conversación grabada, actualizadas hasta este momento. Respondé la pregunta con la info que tengas disponible. ${citationInstructions(transcript)}\n\n${renderTranscriptForPrompt(transcript)}\n\nPregunta: ${question}`

    const sessionFlags = isFirstTurn ? ['--session-id', session.claudeSessionId] : ['--resume', session.claudeSessionId]
    const modelFlags = this.model ? ['--model', this.model] : []

    return new Promise((resolve, reject) => {
      const child = spawn(
        'claude',
        [
          '-p',
          prompt,
          ...sessionFlags,
          ...modelFlags,
          '--output-format',
          'stream-json',
          '--verbose',
          '--permission-mode',
          'bypassPermissions'
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      )

      let buffer = ''
      let resultText: string | null = null
      let stderrText = ''

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.trim()) continue
          try {
            const msg = JSON.parse(part)
            if (msg.type === 'result' && typeof msg.result === 'string') resultText = msg.result
          } catch {
            // línea no-JSON del stream — se ignora, no es un error
          }
        }
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf8')
      })

      child.on('error', (err) => {
        reject(new Error(`No se pudo arrancar el CLI de Claude ("claude"): ${err.message}. ¿Está instalado y en el PATH?`))
      })

      child.on('exit', (code) => {
        if (resultText !== null) {
          resolve(resultText)
        } else {
          reject(new Error(`El CLI de Claude terminó sin respuesta (code ${code}): ${stderrText.trim() || '(sin stderr)'}`))
        }
      })
    })
  }

  /** Usado por el wizard de Settings ("Probar conexión") — no hay ninguna key que validar, solo confirma que el CLI está instalado y accesible. */
  static async checkAvailable(): Promise<{ ok: true } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
      let stderrText = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderrText += chunk.toString('utf8')
      })
      child.on('error', (err) => resolve({ ok: false, error: `No se encontró el CLI "claude" en el PATH: ${err.message}` }))
      child.on('exit', (code) => {
        if (code === 0) resolve({ ok: true })
        else resolve({ ok: false, error: stderrText.trim() || `El CLI "claude" devolvió código ${code}` })
      })
    })
  }
}
