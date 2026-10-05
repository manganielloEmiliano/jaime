import type { LlmEngine } from './LlmEngine'
import type { ConversationSegment } from '../../shared/types'

/**
 * Modo B/C — LLM vía API de OpenAI (GPT-5.4 mini), BYOK.
 * Cache de prompt muy barato ($0.075/1M tokens cacheado) — útil si se
 * reenvía el mismo transcript en preguntas sucesivas dentro de la misma
 * llamada.
 * TODO (Fase 3b): implementar cuando haya una API key real para probarlo.
 * El request se arma prácticamente igual que en DeepSeekEngine (mismo
 * formato `/chat/completions`), solo cambia base URL/modelo/auth header.
 */
export class OpenAiEngine implements LlmEngine {
  constructor(_apiKey: string) {}

  async ask(_question: string, _transcript: ConversationSegment[]): Promise<string> {
    throw new Error('TODO Fase 3b: implementar OpenAiEngine')
  }
}
