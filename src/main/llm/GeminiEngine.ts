import type { LlmEngine } from './LlmEngine'
import type { ConversationSegment } from '../../shared/types'
import { citationInstructions, renderTranscriptForPrompt } from './transcriptPrompt'

const SYSTEM_PROMPT =
  'Sos un asistente que responde preguntas sobre una conversación en curso, usando ' +
  'solo la transcripción provista. Respondé en español, corto y directo. Si la ' +
  'transcripción no tiene la información para responder, decilo en vez de inventar.'

/**
 * Modo B/C — LLM vía API de Gemini (Google AI Studio), BYOK.
 *
 * OJO — bug conocido, no confirmado si sigue vigente: las API keys nuevas
 * generadas por AI Studio desde 2026 tienen prefijo "AQ." (el viejo
 * formato era "AIzaSy..."), y hay reportes (jun-jul 2026, foro oficial de
 * Google AI Developers) de que esas keys nuevas fallan con "API key not
 * valid" contra este mismo endpoint REST. Si esto explota con ese error
 * puntual, es ese bug conocido de Google, no algo mal armado acá — probar
 * con DeepSeekEngine como alternativa en ese caso.
 */
export class GeminiEngine implements LlmEngine {
  constructor(
    private apiKey: string,
    private model: string = 'gemini-2.5-flash'
  ) {}

  async ask(question: string, transcript: ConversationSegment[]): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${SYSTEM_PROMPT} ${citationInstructions(transcript)}\n\nTranscripción hasta ahora:\n${renderTranscriptForPrompt(transcript)}\n\nPregunta: ${question}`
              }
            ]
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`Gemini API error ${response.status}: ${await response.text()}`)
    }

    const data = await response.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }
}
