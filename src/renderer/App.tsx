import { useEffect, useMemo, useState } from 'react'
import { RecordControls } from './components/RecordControls'
import { MiniBar } from './components/MiniBar'
import { ChatPopup } from './components/ChatPopup'
import { SessionsPanel } from './components/SessionsPanel'
import { useRecordingSession } from './hooks/useRecordingSession'
import { useChat } from './hooks/useChat'
import { useCitationFocus } from './hooks/useCitationFocus'
import type { Citation } from './citations'
import { TranscriptPanel } from './TranscriptPanel'
import { QueryPanel } from './QueryPanel'
import { SettingsPanel } from './SettingsPanel'

type Tab = 'transcript' | 'sessions' | 'settings'

/**
 * Ventana principal. Tres modos de ventana (ver `main/index.ts`):
 *  - "expanded": la app completa, tal cual antes.
 *  - "compact": al perder foco, un clúster de círculos chicos (`MiniBar`)
 *    — grabar/pausar, detener, y una burbuja de chat.
 *  - "popup": al tocar la burbuja, una ventana chica SOLO con el chat
 *    (`ChatPopup`), sin restaurar toda la app.
 * Ninguna de las tres desmonta a las otras — se ocultan con CSS — para no
 * perder ni la sesión de grabación (`useRecordingSession`) ni el
 * historial del chat (`useChat`), que por eso viven acá y no adentro de
 * cada componente visual.
 */
export function App() {
  const [tab, setTab] = useState<Tab>('transcript')
  const [segments, setSegments] = useState<SttSegment[]>([])
  const [refined, setRefined] = useState<TranscriptSegment[] | null>(null)
  const [liveCaption, setLiveCaption] = useState<{ speaker: AudioSourceLabel; text: string } | null>(null)
  const [windowMode, setWindowMode] = useState<WindowMode>('expanded')
  // Mientras se ve el detalle de una sesión pasada, la barra de grabar no
  // tiene sentido ahí (no es la grabación en curso) y quedaba apilada
  // justo arriba del header propio de esa vista — dos barras pegadas.
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false)

  useEffect(() => {
    // No alcanza con solo escuchar `window:mode` — en dev, abrir las
    // DevTools le saca el foco a esta ventana casi al instante y ese primer
    // evento puede dispararse ANTES de que este efecto llegue a suscribirse
    // (se pierde). Por eso también se consulta el modo actual al montar.
    window.jaime.getWindowMode().then(setWindowMode)
    return window.jaime.onWindowModeChange(setWindowMode)
  }, [])

  useEffect(() => {
    // Si se navega a otro tab sin pasar por "← Volver" (ej. tocando
    // "Transcripción" directo), `SessionsPanel` se desmonta y nunca llega
    // a avisar que cerró el detalle — sin esto, la barra de grabar
    // quedaría escondida para siempre en otros tabs.
    if (tab !== 'sessions') setSessionDetailOpen(false)
  }, [tab])

  function handleSegment(segment: SttSegment) {
    if (segment.isFinal) {
      setSegments((prev) => [...prev, segment])
      setLiveCaption(null)
    } else {
      setLiveCaption({ speaker: segment.speaker, text: segment.text })
    }
  }

  function handleSessionStart() {
    setSegments([])
    setRefined(null)
    setLiveCaption(null)
  }

  const recording = useRecordingSession({
    onSegment: handleSegment,
    onSessionStart: handleSessionStart,
    onRefined: setRefined
  })

  // Una vez que hay versión refinada, el Q&A usa ESA (con las correcciones
  // manuales que se le hayan hecho), no el borrador en vivo sin editar.
  const refinedSegments: SttSegment[] = useMemo(
    () => (refined ?? []).filter((s) => s.text.trim()).map((s) => ({ ...s, isFinal: true })),
    [refined]
  )
  const transcriptForQuery: SttSegment[] = refined ? refinedSegments : segments

  const chat = useChat(transcriptForQuery)

  // Las citas pueden apuntar al borrador (`L..`, preguntas hechas mientras
  // se grababa) o al refinado (`S..`) — el borrador se sigue mostrando
  // arriba del refinado, así que una cita vieja sigue llevando a su lugar.
  const citationSegments = useMemo(() => [...segments, ...refinedSegments], [segments, refinedSegments])
  const [citeFocus, cite] = useCitationFocus()

  // Desde el popup el transcript está oculto (CSS) — un scroll ahí no hace
  // nada. La cita queda pendiente y se aplica recién cuando main confirma
  // que la ventana ya está expandida (`window:mode`).
  const [pendingCite, setPendingCite] = useState<Citation | null>(null)

  function handleCiteFromPopup(citation: Citation) {
    setTab('transcript')
    setPendingCite(citation)
    void window.jaime.expandWindow()
  }

  useEffect(() => {
    if (windowMode !== 'expanded' || !pendingCite) return
    cite(pendingCite)
    setPendingCite(null)
  }, [windowMode, pendingCite, cite])

  function handleOpenChatPopup() {
    void window.jaime.openChatPopup()
  }

  function handleExpandFromBubble() {
    void window.jaime.expandWindow()
  }

  function handleExpandFromPopup() {
    setTab('transcript')
    void window.jaime.expandWindow()
  }

  function handleMinimizeFromPopup() {
    void window.jaime.minimizeToBubble()
  }

  return (
    <div className="app">
      {windowMode === 'compact' && (
        <MiniBar recording={recording} onOpenChat={handleOpenChatPopup} onExpand={handleExpandFromBubble} />
      )}

      {windowMode === 'popup' && (
        <ChatPopup
          chat={chat}
          transcriptLength={transcriptForQuery.length}
          usingRefined={refined !== null}
          citationSegments={citationSegments}
          onCite={handleCiteFromPopup}
          onExpand={handleExpandFromPopup}
          onMinimize={handleMinimizeFromPopup}
        />
      )}

      <div className={windowMode === 'expanded' ? 'app__shell' : 'app__shell app__shell--hidden'}>
        <nav className="topbar">
          <span className="topbar__title">Jaime</span>
          <button
            className={`tab-button ${tab === 'transcript' ? 'tab-button--active' : ''}`}
            onClick={() => setTab('transcript')}
          >
            Transcripción
          </button>
          <button
            className={`tab-button ${tab === 'sessions' ? 'tab-button--active' : ''}`}
            onClick={() => setTab('sessions')}
          >
            Sesiones
          </button>
          <button
            className={`tab-button ${tab === 'settings' ? 'tab-button--active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Ajustes
          </button>
          <button className="topbar__close" onClick={() => window.jaime.closeWindow()} title="Cerrar">
            ✕
          </button>
        </nav>

        {!sessionDetailOpen && <RecordControls recording={recording} />}

        {tab === 'transcript' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <TranscriptPanel
              segments={segments}
              refined={refined}
              setRefined={setRefined}
              liveCaption={liveCaption}
              citeFocus={citeFocus}
            />
            <QueryPanel
              chat={chat}
              transcriptLength={transcriptForQuery.length}
              usingRefined={refined !== null}
              citationSegments={citationSegments}
              onCite={cite}
            />
          </div>
        )}

        {tab === 'sessions' && <SessionsPanel onDetailOpenChange={setSessionDetailOpen} />}

        {tab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  )
}
