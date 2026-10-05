import type { TranscriptSegment } from './stt/SttEngine'

/**
 * Transcript de la llamada en curso, en memoria. Se persiste a disco
 * (JSON) al cerrar la llamada (Fase 5).
 */
export class TranscriptStore {
  private segments: TranscriptSegment[] = []

  append(segment: TranscriptSegment): void {
    this.segments.push(segment)
  }

  getAll(): TranscriptSegment[] {
    return this.segments
  }

  clear(): void {
    this.segments = []
  }

  // TODO (Fase 5): persistToDisk(path: string) — volcar getAll() a JSON.
}
