import { useEffect, useRef, useState } from 'react'

export type LiveStatus = 'idle' | 'listening' | 'paused' | 'stopping'

export interface RecordingSession {
  status: LiveStatus
  mode: RecordMode
  setMode: (mode: RecordMode) => void
  elapsedMs: number
  error: string | null
  start: () => Promise<void>
  pauseResume: () => void
  stop: () => Promise<void>
}

interface UseRecordingSessionArgs {
  onSegment: (segment: SttSegment) => void
  onSessionStart: () => void
  onRefined: (refined: TranscriptSegment[] | null) => void
}

/**
 * Estado de la sesión de grabación, sacado de `RecordControls` para que
 * pueda compartirse con `MiniBar` (modo compacto) — las dos son
 * representaciones distintas de la MISMA sesión, no cada una la suya. Si
 * el estado viviera adentro de `RecordControls`, ocultarlo/mostrarlo con
 * CSS estaría bien (no se pierde nada), pero `MiniBar` no tendría forma de
 * leerlo/controlarlo sin este nivel compartido.
 */
export function useRecordingSession({ onSegment, onSessionStart, onRefined }: UseRecordingSessionArgs): RecordingSession {
  const [status, setStatus] = useState<LiveStatus>('idle')
  const [mode, setMode] = useState<RecordMode>('you-and-other')
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const sessionRef = useRef<SttSession | null>(null)
  const startedAtRef = useRef(0)

  useEffect(() => {
    if (status !== 'listening') return
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 500)
    return () => clearInterval(id)
  }, [status])

  async function start() {
    setError(null)
    onSessionStart()
    try {
      sessionRef.current = await window.jaime.startSttSession(onSegment, mode)
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      setStatus('listening')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function pauseResume() {
    if (!sessionRef.current) return
    if (status === 'listening') {
      sessionRef.current.pause()
      setStatus('paused')
    } else if (status === 'paused') {
      sessionRef.current.resume()
      setStatus('listening')
    }
  }

  async function stop() {
    if (!sessionRef.current) return
    setStatus('stopping')
    try {
      const result = await sessionRef.current.stop()
      sessionRef.current = null
      onRefined(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStatus('idle')
    }
  }

  return { status, mode, setMode, elapsedMs, error, start, pauseResume, stop }
}
