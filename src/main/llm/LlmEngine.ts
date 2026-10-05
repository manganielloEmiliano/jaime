import type { ConversationSegment } from '../../shared/types'

/**
 * Contrato común para los 3 modos de Q&A (ver plan, sección "Los 3 modos").
 * Recibe el transcript acumulado hasta el momento + la pregunta del
 * usuario, devuelve una respuesta grounded en lo hablado. Sin RAG/vector
 * DB para v1: el transcript completo entra cómodo en el context window de
 * cualquiera de estos modelos.
 *
 *  - LocalLlamaEngine -> Modo A (100% local, llama.cpp) — no implementado
 *  - AnthropicEngine  -> Modo B/C (BYOK, API key paga por token) — no implementado
 *  - ClaudeCliEngine  -> usa la suscripción de Claude Code ya logueada en la
 *    máquina (sin API key, sin costo por token) — spawnea el CLI `claude`
 *    en modo headless
 *  - GeminiEngine     -> Modo B/C (BYOK, Gemini 2.5 Flash)
 *  - OpenAiEngine     -> Modo B/C (BYOK, GPT-5.4 mini) — no implementado
 *  - DeepSeekEngine   -> Modo B/C (BYOK, deepseek-v4-flash) — no estaba en
 *    las 3 alternativas originales del plan, se agregó porque es la que
 *    el usuario ya tenía lista con crédito real.
 */
export interface LlmEngine {
  /**
   * `chatId` identifica de qué conversación viene la pregunta (una por
   * cada `useChat()` del renderer) — los engines stateless (Gemini,
   * DeepSeek) lo ignoran; `ClaudeCliEngine` lo usa para saber si tiene que
   * abrir sesión nueva o hacer `--resume` de una existente.
   */
  ask(question: string, transcript: ConversationSegment[], chatId?: string): Promise<string>
}
