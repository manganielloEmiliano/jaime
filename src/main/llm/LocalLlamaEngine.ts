import type { LlmEngine } from './LlmEngine'
import type { ConversationSegment } from '../../shared/types'

/**
 * Modo A — LLM 100% local vía llama.cpp (Llama 3.1 8B Instruct o
 * Qwen2.5 7B Instruct, GGUF Q4_K_M).
 *
 * Verificado en el plan: en un laptop sin GPU, esperar ~15-30s por
 * respuesta y calidad de razonamiento en español menor que un modelo
 * grande. Requiere ~4.3GB de RAM solo para el modelo + 1-2GB de contexto.
 * Por eso Fase 4 detecta RAM y desaconseja este modo con <16GB totales.
 *
 * TODO (Fase 3): levantar el server de llama.cpp (o su binding node) con
 * el modelo GGUF, armar el prompt (system + transcript + pregunta) y
 * parsear la respuesta.
 */
export class LocalLlamaEngine implements LlmEngine {
  async ask(_question: string, _transcript: ConversationSegment[]): Promise<string> {
    throw new Error('TODO Fase 3: implementar LocalLlamaEngine')
  }
}
