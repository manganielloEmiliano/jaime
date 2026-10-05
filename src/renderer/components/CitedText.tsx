import { useMemo } from 'react'
import { parseAnswer, type Citation } from '../citations'
import { formatTimestamp } from '../format'

interface CitedTextProps {
  text: string
  /** Fragmentos que las citas pueden referenciar — para el tooltip y para saber si el id existe. */
  segments: SttSegment[]
  onCite?: (citation: Citation) => void
}

/**
 * Respuesta del asistente con las citas `[S7: "frase"]` convertidas en
 * chips numerados (estilo NotebookLM). Un id que no existe en el
 * transcript (el LLM lo inventó) se muestra tachado y sin acción, en vez
 * de esconderlo: que se vea que esa afirmación NO tiene respaldo.
 */
export function CitedText({ text, segments, onCite }: CitedTextProps) {
  const parts = useMemo(() => parseAnswer(text), [text])
  const byId = useMemo(() => new Map(segments.filter((s) => s.id).map((s) => [s.id!, s])), [segments])

  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'text') return <span key={i}>{part.text}</span>

        const segment = byId.get(part.citation.segmentId)
        if (!segment || !onCite) {
          return (
            <span key={i} className="cite-chip cite-chip--missing" title="Referencia no encontrada en la transcripción">
              {part.n}
            </span>
          )
        }

        const who = segment.speaker === 'you' ? 'Vos' : 'Otros'
        const when = segment.startMs !== undefined ? ` · ${formatTimestamp(segment.startMs)}` : ''
        const quote = part.citation.quote ? `\n"${part.citation.quote}"` : ''
        return (
          <button key={i} className="cite-chip" title={`${who}${when}${quote}`} onClick={() => onCite(part.citation)}>
            {part.n}
          </button>
        )
      })}
    </>
  )
}
