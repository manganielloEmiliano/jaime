import type { LlmEngine } from './LlmEngine'
import type { ConversationSegment } from '../../shared/types'
import { citationInstructions, renderTranscriptForPrompt } from './transcriptPrompt'

const SYSTEM_PROMPT =
  'Sos un asistente que responde preguntas sobre una conversación en curso, usando ' +
  'solo la transcripción provista. Respondé en español, corto y directo. Si la ' +
  'transcripción no tiene la información para responder, decilo en vez de inventar.'

/**
 * Modo B/C — LLM vía API de DeepSeek. No estaba entre las 3 alternativas
 * originales del plan (Anthropic/Gemini/OpenAI) — se agregó porque el
 * usuario ya la tenía lista con crédito real. La API es compatible con el
 * formato de OpenAI (mismo `/chat/completions`), por eso el request se
 * arma igual que se armaría para OpenAiEngine.
 *
 * IMPORTANTE: DeepSeek retiró los alias `deepseek-chat`/`deepseek-reasoner`
 * a fines de jul-2026 — hay que usar `deepseek-v4-flash` (barato, alcanza
 * para Q&A sobre un transcript corto) o `deepseek-v4-pro` (más capaz, más caro).
 */
export class DeepSeekEngine implements LlmEngine {
  constructor(
    private apiKey: string,
    private model: string = 'deepseek-v4-flash'
  ) {}

  async ask(question: string, transcript: ConversationSegment[]): Promise<string> {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT} ${citationInstructions(transcript)}` },
          {
            role: 'user',
            content: `Transcripción hasta ahora:\n${renderTranscriptForPrompt(transcript)}\n\nPregunta: ${question}`
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`DeepSeek API error ${response.status}: ${await response.text()}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content ?? ''
  }
}
