import { useCallback, useEffect, useState, type RefObject } from 'react'
import { findQuoteRange, type Citation } from '../citations'

/** Cita "activa" — `nonce` cambia en cada click, así volver a tocar la MISMA cita vuelve a hacer scroll. */
export interface CitationFocus extends Citation {
  nonce: number
}

/**
 * Estado de "a qué fragmento llevó la última cita tocada" — vive en el
 * dueño de la vista (App para la grabación en vivo, SessionDetail para una
 * sesión pasada), no en el chat, porque quien tiene que reaccionar es el
 * TRANSCRIPT (scroll + resaltado), y el chat solo avisa.
 */
export function useCitationFocus(): [CitationFocus | null, (citation: Citation) => void] {
  const [focus, setFocus] = useState<CitationFocus | null>(null)
  const cite = useCallback((citation: Citation) => setFocus({ ...citation, nonce: Date.now() }), [])
  return [focus, cite]
}

/**
 * Lleva la vista al fragmento citado dentro de `rootRef`: scroll hasta el
 * elemento con `data-segment-id`, y si es un `<textarea>` (el refinado
 * editable) selecciona la frase adentro — ahí no se puede pintar un
 * `<mark>`, la selección nativa hace de resaltado. Para texto de solo
 * lectura el resaltado lo hace `SegmentText`.
 */
export function useRevealCitation(rootRef: RefObject<HTMLElement | null>, focus: CitationFocus | null): void {
  useEffect(() => {
    if (!focus) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-segment-id="${focus.segmentId}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })

    if (el instanceof HTMLTextAreaElement) {
      const range = focus.quote ? findQuoteRange(el.value, focus.quote) : null
      el.focus({ preventScroll: true })
      el.setSelectionRange(range?.start ?? 0, range?.end ?? el.value.length)
    }
  }, [focus?.nonce])
}
