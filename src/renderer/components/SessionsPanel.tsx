import { useEffect, useRef, useState } from 'react'
import { SessionDetail } from './SessionDetail'

// No se usa el evento nativo `dblclick` (ver MiniBar.tsx para el motivo
// real de fondo — ahí sí importa, acá se mantiene igual por consistencia):
// se mide el tiempo entre dos `click` simples a mano. Un timer/timestamp
// por sesión (no un solo hook), porque son N filas.
const DOUBLE_CLICK_WINDOW_MS = 350

/**
 * Tab "Sesiones": lista las grabaciones pasadas (carpetas bajo
 * `transcriptBaseDir`, una por `metadata.json`), permite reproducir el
 * audio de cada canal (`<audio controls>` nativo), renombrar el título y
 * borrar una sesión completa (audio + transcript) — con confirmación
 * INLINE, no `window.confirm()`: un diálogo nativo le saca el foco a la
 * ventana (dispara `blur`), lo que activaba sin querer el achicado
 * automático a modo compacto (mismo bug de fondo que las DevTools en dev).
 */
interface SessionsPanelProps {
  /** Avisa cuando se abre/cierra el detalle de una sesión — App.tsx lo usa para esconder la barra de grabar ahí (no tiene sentido mientras se mira una sesión pasada). */
  onDetailOpenChange?: (open: boolean) => void
}

export function SessionsPanel({ onDetailOpenChange }: SessionsPanelProps) {
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<SessionMetadata | null>(null)
  const [transcripts, setTranscripts] = useState<Record<string, string>>({})
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const clickTimers = useRef<Record<string, number>>({})
  const lastClickAt = useRef<Record<string, number>>({})

  useEffect(() => {
    window.jaime.listSessions().then((list) => {
      setSessions(list)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    onDetailOpenChange?.(detailSession !== null)
  }, [detailSession, onDetailOpenChange])

  async function toggleExpand(session: SessionMetadata) {
    if (expandedId === session.sessionId) {
      setExpandedId(null)
      return
    }
    setExpandedId(session.sessionId)

    if (!transcripts[session.sessionId]) {
      const text = await window.jaime.readSessionTranscript(session.transcriptFile)
      setTranscripts((prev) => ({ ...prev, [session.sessionId]: text }))
    }

    for (const [speaker, filePath] of Object.entries(session.audioFiles)) {
      const key = `${session.sessionId}:${speaker}`
      if (!filePath || audioUrls[key]) continue
      const bytes = await window.jaime.readSessionAudio(filePath)
      // `bytes` cruza por IPC con un tipo de buffer que TS no puede
      // garantizar respaldado por un ArrayBuffer "puro" (podría ser
      // SharedArrayBuffer) — Blob exige justo eso, así que se copia.
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }))
      setAudioUrls((prev) => ({ ...prev, [key]: url }))
    }
  }

  function startEditing(session: SessionMetadata) {
    setEditingId(session.sessionId)
    setTitleDraft(session.title)
  }

  async function saveTitle(session: SessionMetadata) {
    const title = titleDraft.trim()
    setEditingId(null)
    if (!title || title === session.title) return
    const updated = await window.jaime.renameSession(session.sessionId, title)
    setSessions((prev) => prev.map((s) => (s.sessionId === session.sessionId ? updated : s)))
    setTranscripts((prev) => {
      if (!prev[session.sessionId]) return prev
      const lines = prev[session.sessionId].split('\n')
      lines[0] = lines[0].replace(/^# .*(\(.*\))$/, `# ${title} $1`)
      return { ...prev, [session.sessionId]: lines.join('\n') }
    })
  }

  function handleRowClick(session: SessionMetadata) {
    const now = Date.now()
    const isDoubleClick = now - (lastClickAt.current[session.sessionId] ?? 0) < DOUBLE_CLICK_WINDOW_MS
    lastClickAt.current[session.sessionId] = now

    if (isDoubleClick) {
      const timer = clickTimers.current[session.sessionId]
      if (timer) {
        clearTimeout(timer)
        delete clickTimers.current[session.sessionId]
      }
      setDetailSession(session)
      return
    }

    clickTimers.current[session.sessionId] = window.setTimeout(() => {
      delete clickTimers.current[session.sessionId]
      toggleExpand(session)
    }, DOUBLE_CLICK_WINDOW_MS)
  }

  async function confirmDelete(session: SessionMetadata) {
    setConfirmingDeleteId(null)
    await window.jaime.deleteSession(session.sessionId)
    setSessions((prev) => prev.filter((s) => s.sessionId !== session.sessionId))
    if (expandedId === session.sessionId) setExpandedId(null)
  }

  if (detailSession) {
    return <SessionDetail session={detailSession} onBack={() => setDetailSession(null)} />
  }

  if (loading) {
    return (
      <div className="panel-padding">
        <p className="muted">Cargando sesiones...</p>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="panel-padding">
        <p className="muted">Todavía no grabaste ninguna sesión.</p>
      </div>
    )
  }

  return (
    <div className="sessions">
      {sessions.map((session) => (
        <div key={session.sessionId} className="sessions__item">
          <div className="sessions__row">
            <button
              className="sessions__row-main"
              onClick={() => handleRowClick(session)}
              title="Doble click para abrir la vista completa"
            >
              {editingId === session.sessionId ? (
                <input
                  className="sessions__title-input"
                  autoFocus
                  value={titleDraft}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveTitle(session)}
                  onBlur={() => saveTitle(session)}
                />
              ) : (
                <strong>{session.title}</strong>
              )}
              <span className="muted">
                {' '}
                · {Math.round(session.durationMs / 60000)} min · {session.recordMode} · {session.sttProvider}
              </span>
            </button>
            <button
              className="sessions__icon-btn"
              title="Abrir carpeta (para usarla con Claude Code u otro agente)"
              onClick={(e) => {
                e.stopPropagation()
                window.jaime.showItemInFolder(session.transcriptFile)
              }}
            >
              📂
            </button>
            <button
              className="sessions__icon-btn"
              title="Renombrar"
              onClick={(e) => {
                e.stopPropagation()
                startEditing(session)
              }}
            >
              ✎
            </button>
            {confirmingDeleteId === session.sessionId ? (
              <span className="sessions__confirm">
                <button className="sessions__confirm-btn sessions__confirm-btn--danger" onClick={() => confirmDelete(session)}>
                  Borrar
                </button>
                <button className="sessions__confirm-btn" onClick={() => setConfirmingDeleteId(null)}>
                  Cancelar
                </button>
              </span>
            ) : (
              <button
                className="sessions__icon-btn sessions__icon-btn--danger"
                title="Borrar"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmingDeleteId(session.sessionId)
                }}
              >
                🗑
              </button>
            )}
          </div>
          {expandedId === session.sessionId && (
            <div className="sessions__detail">
              <pre className="sessions__transcript">{transcripts[session.sessionId] ?? 'Cargando...'}</pre>
              {Object.entries(session.audioFiles).map(([speaker, filePath]) => {
                if (!filePath) return null
                const url = audioUrls[`${session.sessionId}:${speaker}`]
                return (
                  <div key={speaker} className="sessions__audio">
                    <span>{speaker === 'you' ? 'Vos:' : 'Otros:'}</span>
                    {url ? <audio controls src={url} /> : <span className="muted">cargando audio...</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
