/**
 * Citas estilo NotebookLM: el LLM responde con `[S7: "frase textual"]`
 * (formato pedido en main/llm/transcriptPrompt.ts) y acá se convierte en
 * chips numerados que llevan al fragmento — el id ubica el fragmento
 * (robusto: el LLM solo copia un token corto) y la frase resalta el
 * pedazo exacto adentro (frágil: el LLM a veces "corrige" lo que copia,
 * por eso `findQuoteRange` normaliza y cae a prefijos más cortos).
 */

export interface Citation {
  segmentId: string
  quote?: string
}

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; citation: Citation; n: number }

// Acepta comillas rectas o tipográficas, y la frase opcional: `[S7]` solo
// también es una cita válida (resalta el fragmento entero).
const CITE_RE = /\[\s*([SL]\d+)\s*(?::\s*["“”«„]([^"“”«»\]]*)["“”»]?)?\s*\]/g

/** Parte la respuesta en texto + citas. `n` numera por orden de aparición, repitiendo número si se cita dos veces lo mismo. */
export function parseAnswer(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = []
  const numbers = new Map<string, number>()
  let last = 0

  for (const match of answer.matchAll(CITE_RE)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ kind: 'text', text: answer.slice(last, index) })

    const citation: Citation = { segmentId: match[1], quote: match[2]?.trim() || undefined }
    const key = `${citation.segmentId}|${citation.quote ?? ''}`
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1)
    parts.push({ kind: 'cite', citation, n: numbers.get(key)! })

    last = index + match[0].length
  }
  if (last < answer.length) parts.push({ kind: 'text', text: answer.slice(last) })
  return parts
}

/**
 * Minúsculas, sin tildes, y cualquier cosa que no sea letra/número colapsada
 * a un espacio — con `map[i]` = índice en el texto ORIGINAL del carácter
 * normalizado `i`, para poder volver al rango real a resaltar.
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const base = text[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (/^[\p{L}\p{N}]+$/u.test(base)) {
      for (const c of base) {
        norm += c
        map.push(i)
      }
    } else if (norm && !norm.endsWith(' ')) {
      norm += ' '
      map.push(i)
    }
  }
  return { norm, map }
}

/**
 * Rango `[start, end)` de `quote` dentro de `text`, o `null`. Si la frase
 * entera no aparece (el LLM cambió una palabra hacia el final), prueba con
 * prefijos cada vez más cortos hasta un mínimo de 3 palabras — resaltar
 * "casi" la frase sirve más que no resaltar nada.
 */
export function findQuoteRange(text: string, quote: string): { start: number; end: number } | null {
  const haystack = normalizeWithMap(text)
  const needleWords = normalizeWithMap(quote).norm.trim().split(' ').filter(Boolean)
  const minWords = Math.min(3, needleWords.length)

  for (let len = needleWords.length; len >= minWords && len > 0; len--) {
    const needle = needleWords.slice(0, len).join(' ')
    const idx = haystack.norm.indexOf(needle)
    if (idx >= 0) {
      return { start: haystack.map[idx], end: haystack.map[idx + needle.length - 1] + 1 }
    }
  }
  return null
}
