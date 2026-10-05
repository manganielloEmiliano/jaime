import type { RecordingSession } from '../hooks/useRecordingSession'
import { formatElapsed } from '../format'
import { formatTranscribeProgress, useTranscribeProgress } from '../hooks/useTranscribeProgress'

interface RecordControlsProps {
  recording: RecordingSession
}

const MODE_OPTIONS: { value: RecordMode; label: string }[] = [
  { value: 'you-and-other', label: 'Vos y otros' },
  { value: 'you-only', label: 'Solo vos' },
  { value: 'other-only', label: 'Solo el sistema' }
]

/**
 * Barra de grabación (vista "completa"): controles tipo reproductor —
 * Pausar/Reanudar + Detener — que aparecen en cuanto se arranca a grabar.
 * El estado en sí vive en `useRecordingSession` (ver ese hook) y no acá,
 * porque `MiniBar` (modo compacto) necesita mostrar/controlar la MISMA
 * sesión, no una copia separada.
 */
export function RecordControls({ recording }: RecordControlsProps) {
  const { status, mode, setMode, elapsedMs, error, start, pauseResume, stop } = recording
  // Al detener con whisper local se re-transcribe todo el audio — puede tardar minutos.
  const stopProgress = useTranscribeProgress('stop', status === 'stopping')

  return (
    <div className="record-bar">
      {status === 'idle' ? (
        <>
          <select className="record-bar__mode" value={mode} onChange={(e) => setMode(e.target.value as RecordMode)}>
            {MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button className="btn btn--record" onClick={start}>
            ● Grabar
          </button>
        </>
      ) : (
        <>
          <span className="record-bar__indicator">
            <span className={`record-dot ${status === 'paused' ? 'record-dot--paused' : ''}`} />
            {status === 'stopping'
              ? `Guardando...${stopProgress ? ` ${formatTranscribeProgress(stopProgress)}` : ''}`
              : status === 'paused' ? 'En pausa' : 'Grabando'} {formatElapsed(elapsedMs)}
          </span>
          <button className="btn" onClick={pauseResume} disabled={status === 'stopping'}>
            {status === 'paused' ? '▶ Reanudar' : '⏸ Pausar'}
          </button>
          <button className="btn btn--stop" onClick={stop} disabled={status === 'stopping'}>
            ⏹ Detener
          </button>
        </>
      )}
      {error && <p className="error-text">Error: {error}</p>}
    </div>
  )
}
