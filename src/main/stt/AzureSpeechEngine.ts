import type { SttEngine } from './SttEngine'

/**
 * Modo C (alternativa) — STT cloud vía Azure Speech-to-Text, streaming nativo.
 * Mismo ecosistema que Teams — relevante si más adelante se explora el
 * camino de bot con Graph API / Bot Framework en vez de captura local.
 * TODO (Fase 2b): misma observación que AssemblyAiEngine sobre encajar
 * streaming real en `transcribeChunk`. Implementar con el SDK de Azure
 * Cognitive Services Speech, usando la key que carga el usuario en el
 * wizard de settings (Fase 4).
 */
export class AzureSpeechEngine implements SttEngine {
  constructor(_apiKey: string, _region: string) {}

  async transcribeChunk(_pcmf32: Float32Array): Promise<string> {
    throw new Error('TODO Fase 2b: implementar AzureSpeechEngine')
  }
}
