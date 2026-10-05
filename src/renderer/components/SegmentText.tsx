import { findQuoteRange } from '../citations'
import type { CitationFocus } from '../hooks/useCitationFocus'

interface SegmentTextProps {
  segmentId: string | undefined
  text: string
  focus: CitationFocus | null
}

/**
 * Texto de un fragmento de solo lectura, con la frase citada resaltada
 * (`<mark>`) si la última cita tocada apunta acá. Si la frase no aparece
 * (el LLM la parafraseó), el resaltado queda en el fragmento entero — eso
 * lo pinta el contenedor con `segment--cited`, no este componente.
 */
export function SegmentText({ segmentId, text, focus }: SegmentTextProps) {
  const range = focus && segmentId && focus.segmentId === segmentId && focus.quote ? findQuoteRange(text, focus.quote) : null
  if (!range) return <>{text}</>

  return (
    <>
      {text.slice(0, range.start)}
      <mark className="cite-mark">{text.slice(range.start, range.end)}</mark>
      {text.slice(range.end)}
    </>
  )
}
