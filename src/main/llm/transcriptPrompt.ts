import type { ConversationSegment } from '../../shared/types'

/**
 * Armado del transcript para el prompt — antes cada engine (Gemini,
 * DeepSeek, Claude CLI) tenía su propia copia de `Vos: texto`. Ahora que
 * cada fragmento puede llevar una dirección citable, conviene que los tres
 * la rendericen igual: el renderer parsea UN solo formato de cita
 * (`[S7: "frase"]`, ver renderer/citations.ts), venga del proveedor que venga.
 */

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

function speakerLabel(segment: ConversationSegment): string {
  return segment.speaker === 'you' ? 'Vos' : 'Otros'
}

export function renderTranscriptForPrompt(transcript: ConversationSegment[]): string {
  if (transcript.length === 0) return '(todavía no hay transcripción)'
  return transcript
    .map((seg) =>
      seg.id
        ? `[${seg.id} | ${formatTimestamp(seg.startMs ?? 0)} | ${speakerLabel(seg)}] ${seg.text}`
        : `${speakerLabel(seg)}: ${seg.text}`
    )
    .join('\n')
}

/**
 * Instrucciones de cita — solo si hay fragmentos con id (sesiones viejas
 * sin `segments.json` no tienen a qué apuntar). La frase textual es la que
 * permite resaltar el pedazo exacto dentro de un fragmento de 30s; se pide
 * corta y SIN corregir porque se busca contra el texto de whisper tal cual
 * (con sus errores de ortografía incluidos).
 */
export function citationInstructions(transcript: ConversationSegment[]): string {
  if (!transcript.some((seg) => seg.id)) return ''
  return (
    'Cada fragmento de la transcripción empieza con su id entre corchetes, por ejemplo [S7 | 03:30 | Vos]. ' +
    'Cuando una afirmación de tu respuesta salga de un fragmento, citalo justo después con el formato ' +
    '[S7: "frase"], donde "frase" es un pedazo COPIADO TEXTUAL de ese fragmento (de 3 a 10 palabras, sin ' +
    'corregir ortografía ni cambiar nada) que respalde lo que decís. Una sola cita por corchete; si usás ' +
    'varios fragmentos, poné varias citas seguidas. Usá solo ids que existan en la transcripción.'
  )
}
