import { useRef, type MouseEvent } from 'react'
import type { RecordingSession } from '../hooks/useRecordingSession'

interface MiniBarProps {
  recording: RecordingSession
  onOpenChat: () => void
  onExpand: () => void
}

// No se usa el evento nativo `dblclick`: confirmado con logs que, con el
// contenedor marcado `-webkit-app-region: drag` (ya sacado, ver
// styles.css), Electron/Chromium se comían el segundo `click` de un doble
// click real — nunca llegaba a React. En cambio, se mide a mano el tiempo
// entre dos `click` simples (esos sí llegan bien).
const DOUBLE_CLICK_WINDOW_MS = 350

/**
 * Clúster flotante — lo único visible cuando la ventana se achica al
 * perder foco (ver `main/index.ts`, evento `blur`): 2 o 3 círculos chicos,
 * no una barra con texto:
 *  - grabar (idle) / pausar-reanudar (una vez arrancada la sesión)
 *  - detener (solo aparece con sesión activa)
 *  - burbuja de chat — abre el popup de chat (click simple) o expande a
 *    la app completa (doble click) — el mismo gesto funciona tanto sobre
 *    la burbuja 💬 como sobre cualquier parte vacía de la barrita.
 * Comparte el mismo estado de `useRecordingSession` que `RecordControls`
 * (la vista completa) — no es una sesión de grabación aparte.
 */
export function MiniBar({ recording, onOpenChat, onExpand }: MiniBarProps) {
  const { status, start, pauseResume, stop } = recording
  const isActive = status !== 'idle'
  const clickTimer = useRef<number | null>(null)
  const lastClickAt = useRef(0)

  function handleAskClick() {
    const now = Date.now()
    const isDoubleClick = now - lastClickAt.current < DOUBLE_CLICK_WINDOW_MS
    lastClickAt.current = now

    if (isDoubleClick) {
      if (clickTimer.current !== null) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
      onExpand()
      return
    }

    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null
      onOpenChat()
    }, DOUBLE_CLICK_WINDOW_MS)
  }

  // El click en un botón hijo (grabar/pausar/detener/burbuja) también
  // burbujea hasta acá — se ignora ese caso (`target !== currentTarget`)
  // para que el fondo vacío de la barrita dispare `handleAskClick` sin
  // duplicar la acción cuando el click vino de un botón.
  function handleContainerClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    handleAskClick()
  }

  return (
    <div className="mini-bar" onClick={handleContainerClick}>
      {isActive ? (
        <button
          className={`mini-bar__circle mini-bar__circle--record ${status === 'listening' ? 'mini-bar__circle--live' : ''}`}
          onClick={pauseResume}
          disabled={status === 'stopping'}
          title={status === 'paused' ? 'Reanudar' : 'Pausar'}
        >
          {status === 'paused' ? '▶' : '⏸'}
        </button>
      ) : (
        <button className="mini-bar__circle mini-bar__circle--record" onClick={start} title="Grabar">
          ●
        </button>
      )}

      {isActive && (
        <button className="mini-bar__circle" onClick={stop} disabled={status === 'stopping'} title="Detener">
          ⏹
        </button>
      )}

      <button
        className="mini-bar__circle mini-bar__circle--bubble"
        onClick={handleAskClick}
        title="Preguntar (doble click: app completa)"
      >
        💬
      </button>
    </div>
  )
}
