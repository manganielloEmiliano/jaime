import type { ChatState } from '../hooks/useChat'
import type { Citation } from '../citations'
import { QueryPanel } from '../QueryPanel'

interface ChatPopupProps {
  chat: ChatState
  transcriptLength: number
  usingRefined: boolean
  citationSegments: SttSegment[]
  /** Desde el popup no hay transcript a la vista — App expande la ventana y lleva ahí. */
  onCite: (citation: Citation) => void
  onExpand: () => void
  onMinimize: () => void
}

/**
 * Ventana chica que se abre pegada a la burbuja de chat (modo "popup", ver
 * App.tsx/main/index.ts) — muestra SOLO el chat, no toda la app. Reusa
 * `QueryPanel` (mismo `useChat`, mismo historial) con un header propio:
 * "⤢" para ir a la app completa, "▼" para volver a achicar a la burbuja.
 */
export function ChatPopup({
  chat,
  transcriptLength,
  usingRefined,
  citationSegments,
  onCite,
  onExpand,
  onMinimize
}: ChatPopupProps) {
  return (
    <div className="chat-popup">
      <div className="chat-popup__header">
        <span className="topbar__title">Jaime</span>
        <button className="mini-bar__icon" onClick={onExpand} title="Ver app completa">
          ⤢
        </button>
        <button className="mini-bar__icon" onClick={onMinimize} title="Minimizar">
          ▼
        </button>
      </div>
      <QueryPanel
        chat={chat}
        transcriptLength={transcriptLength}
        usingRefined={usingRefined}
        citationSegments={citationSegments}
        onCite={onCite}
      />
    </div>
  )
}
