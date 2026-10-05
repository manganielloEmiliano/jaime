import type { LlmEngine } from './LlmEngine'
import type { ConversationSegment } from '../../shared/types'

/**
 * Modo B/C — LLM vía API de Anthropic (Claude Haiku 4.5), con API key
 * propia del usuario (BYOK, cargada en el wizard de settings, Fase 4).
 * Costo estimado por consulta: ~$0.001-0.01 (transcript ~5k tokens +
 * pregunta + respuesta ~200 tokens). Mejor relación calidad-instrucción
 * para razonar en español sobre transcripciones largas.
 * TODO (Fase 3b): implementar cuando haya una API key real para probarlo
 * — se priorizó GeminiEngine/DeepSeekEngine porque son las que el usuario
 * tenía listas.
 */
export class AnthropicEngine implements LlmEngine {
  constructor(_apiKey: string) {}

  async ask(_question: string, _transcript: ConversationSegment[]): Promise<string> {
    throw new Error('TODO Fase 3b: implementar AnthropicEngine')
  }
}
