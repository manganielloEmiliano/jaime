/**
 * Camino inverso de `renderTranscriptMd` (main/sessionManager.ts) — separa
 * un `transcript.md` ya escrito en sus secciones "Vos"/"Otros". Simple a
 * propósito: como el mismo proyecto controla el formato de escritura Y de
 * lectura, no hace falta un parser de Markdown real, alcanza con partir
 * por los encabezados fijos que ya sabemos que están ahí.
 */
export function parseTranscriptMd(markdown: string): { you: string; other: string } {
  const you = markdown.split('## Vos')[1]?.split('## Otros')[0]?.trim() ?? ''
  const other = markdown.split('## Otros')[1]?.trim() ?? ''
  return { you, other }
}
