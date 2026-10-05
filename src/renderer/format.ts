/** `HH:MM:SS` a partir de milisegundos transcurridos — usado por el timer de grabación (barra completa y modo compacto). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

/** `MM:SS` — posición de un fragmento dentro del audio (citas, transcript segmentado). Mismo formato que ve el LLM en el prompt. */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${m}:${s}`
}
