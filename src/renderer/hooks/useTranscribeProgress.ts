import { useEffect, useState } from 'react'

/**
 * Avance de una pasada completa de whisper (importar un audio, detener una
 * grabación, refinar una sesión pasada) — con large-v3-turbo en CPU un
 * audio largo tarda minutos, y sin esto la UI quedaba muda. Solo escucha
 * mientras `active` es true y vuelve a `null` al terminar, así la próxima
 * corrida no arranca mostrando el avance de la anterior.
 *
 * `null` = todavía no llegó ningún aviso (p.ej. decodificando el archivo).
 */
export function useTranscribeProgress(job: TranscribeJob, active: boolean): TranscribeProgress | null {
  const [progress, setProgress] = useState<TranscribeProgress | null>(null)

  useEffect(() => {
    if (!active) {
      setProgress(null)
      return
    }
    return window.jaime.onTranscribeProgress((p) => {
      if (p.job === job) setProgress(p)
    })
  }, [job, active])

  return progress
}

/** `12/44 (27%)` */
export function formatTranscribeProgress({ done, total }: TranscribeProgress): string {
  return `${done}/${total} (${Math.round((done / Math.max(1, total)) * 100)}%)`
}
