import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '../hooks/useChat'
import { useCitationFocus, useRevealCitation } from '../hooks/useCitationFocus'
import type { Citation } from '../citations'
import { formatTimestamp } from '../format'
import { SegmentText } from './SegmentText'
import { formatTranscribeProgress, useTranscribeProgress } from '../hooks/useTranscribeProgress'
import { QueryPanel } from '../QueryPanel'
import { parseTranscriptMd } from '../transcriptMd'

interface SessionDetailProps {
  session: SessionMetadata
  onBack: () => void
}

/**
 * Vista completa de una sesión pasada (doble click en la lista, ver
 * SessionsPanel.tsx): transcript entero + audio, y su PROPIO chat para
 * preguntar sobre esa conversación puntual — no el de la grabación en
 * vivo. Por eso tiene su propia instancia de `useChat`, con el transcript
 * de ESTA sesión (parseado del .md guardado) como contexto.
 */
export function SessionDetail({ session, onBack }: SessionDetailProps) {
  const [transcriptText, setTranscriptText] = useState<string | null>(null)
  // `[]` = sesión anterior a las citas (sin segments.json) → se muestra el .md plano y el chat va sin referencias.
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const transcriptRef = useRef<HTMLDivElement>(null)
  const audioRefs = useRef<Partial<Record<string, HTMLAudioElement | null>>>({})
  const [citeFocus, cite] = useCitationFocus()
  useRevealCitation(transcriptRef, citeFocus)
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const [refining, setRefining] = useState(false)
  const [refineError, setRefineError] = useState<string | null>(null)
  const refineProgress = useTranscribeProgress('refine', refining)

  useEffect(() => {
    setTranscriptText(null)
    setSegments([])
    setAudioUrls({})

    window.jaime.readSessionTranscript(session.transcriptFile).then(setTranscriptText)
    window.jaime.readSessionSegments(session.sessionId).then(setSegments)

    for (const [speaker, filePath] of Object.entries(session.audioFiles)) {
      if (!filePath) continue
      window.jaime.readSessionAudio(filePath).then((bytes) => {
        const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }))
        setAudioUrls((prev) => ({ ...prev, [speaker]: url }))
      })
    }
  }, [session.sessionId])

  const transcriptSegments: SttSegment[] = useMemo(() => {
    if (segments.length > 0) return segments.map((s) => ({ ...s, isFinal: true }))
    if (!transcriptText) return []
    const { you, other } = parseTranscriptMd(transcriptText)
    const fromMd: SttSegment[] = []
    if (you.trim()) fromMd.push({ speaker: 'you', text: you, isFinal: true })
    if (other.trim()) fromMd.push({ speaker: 'other', text: other, isFinal: true })
    return fromMd
  }, [transcriptText, segments])

  const chat = useChat(transcriptSegments)

  /** Adelanta el audio de ese hablante al fragmento — sin darle play, que el usuario decida si escucharlo. */
  function seekTo(segment: TranscriptSegment) {
    const audio = audioRefs.current[segment.speaker]
    if (audio) audio.currentTime = segment.startMs / 1000
  }

  function handleCite(citation: Citation) {
    cite(citation)
    const segment = segments.find((s) => s.id === citation.segmentId)
    if (segment) seekTo(segment)
  }

  async function handleRefine() {
    setRefining(true)
    setRefineError(null)
    try {
      const { transcriptText: refreshed, segments: refreshedSegments } = await window.jaime.refineSession(session.sessionId)
      setTranscriptText(refreshed)
      setSegments(refreshedSegments)
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefining(false)
    }
  }

  return (
    <div className="session-detail">
      <div className="session-detail__header">
        <button className="btn" onClick={onBack}>
          ← Volver
        </button>
        <strong>{session.title}</strong>
        <span className="muted">
          {' '}
          · {Math.round(session.durationMs / 60000)} min · {session.recordMode} · {session.sttProvider}
        </span>
        <button
          className="btn"
          style={{ marginLeft: 'auto' }}
          title="Re-transcribe con whisper local desde el audio guardado — sirve para mejorar sesiones grabadas con AssemblyAI, o volver a intentar si el resultado no convenció"
          onClick={handleRefine}
          disabled={refining}
        >
          {refining ? `Refinando...${refineProgress ? ` ${formatTranscribeProgress(refineProgress)}` : ''}` : '🔄 Refinar'}
        </button>
        <button
          className="sessions__icon-btn"
          title="Abrir carpeta (para usarla con Claude Code u otro agente)"
          onClick={() => window.jaime.showItemInFolder(session.transcriptFile)}
        >
          📂
        </button>
      </div>
      {refineError && (
        <p className="error-text" style={{ padding: '0 12px' }}>
          Error al refinar: {refineError}
        </p>
      )}

      {/* Fuera del contenedor con scroll: al saltar a una cita, el reproductor ya adelantado tiene que quedar a la vista. */}
      <div className="session-detail__audio">
        {Object.entries(audioUrls).map(([speaker, url]) => (
          <div key={speaker} className="sessions__audio">
            <span>{speaker === 'you' ? 'Vos:' : 'Otros:'}</span>
            <audio
              controls
              src={url}
              ref={(el) => {
                audioRefs.current[speaker] = el
              }}
            />
          </div>
        ))}
      </div>

      <div className="session-detail__transcript" ref={transcriptRef}>
        {segments.length > 0 ? (
          segments.map((s) => (
            <p
              key={s.id}
              data-segment-id={s.id}
              className={`transcript__line ${citeFocus?.segmentId === s.id ? 'segment--cited' : ''}`}
            >
              <button className="segment__time" title="Ir a este momento del audio" onClick={() => seekTo(s)}>
                {formatTimestamp(s.startMs)}
              </button>{' '}
              <strong>{s.speaker === 'you' ? 'Vos' : 'Otros'}:</strong>{' '}
              <SegmentText segmentId={s.id} text={s.text} focus={citeFocus} />
            </p>
          ))
        ) : (
          <>
            {transcriptText !== null && (
              <p className="muted">Esta sesión es anterior a las referencias — tocá "Refinar" para poder citar fragmentos.</p>
            )}
            <pre className="session-detail__transcript-text">{transcriptText ?? 'Cargando...'}</pre>
          </>
        )}
      </div>

      <QueryPanel
        chat={chat}
        transcriptLength={transcriptSegments.length}
        usingRefined
        citationSegments={transcriptSegments}
        onCite={handleCite}
      />
    </div>
  )
}
