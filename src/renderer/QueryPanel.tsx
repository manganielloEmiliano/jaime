import { useEffect, useRef, useState } from 'react'
import type { ChatState } from './hooks/useChat'
import type { Citation } from './citations'
import { CitedText } from './components/CitedText'

interface QueryPanelProps {
  chat: ChatState
  transcriptLength: number
  usingRefined: boolean
  /** Fragmentos a los que pueden apuntar las citas de las respuestas — puede incluir más que el transcript actual (p.ej. el borrador en vivo después de refinar, para que citas viejas sigan andando). */
  citationSegments?: SttSegment[]
  /** Click en un chip de cita — sin esto las citas se muestran pero no llevan a ningún lado. */
  onCite?: (citation: Citation) => void
}

/**
 * Chat de consulta sobre la conversación en curso — historial completo con
 * burbujas usuario/asistente, como cualquier chat de IA (sin streaming de
 * tokens). El estado en sí vive en `useChat` (ver ese hook), no acá, para
 * que el popup de chat (modo compacto → burbuja) pueda mostrar la MISMA
 * conversación sin duplicarla.
 */
export function QueryPanel({ chat, transcriptLength, usingRefined, citationSegments = [], onCite }: QueryPanelProps) {
  const { messages, status, error, ask } = chat
  const [question, setQuestion] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, status])

  function handleAsk() {
    if (!question.trim()) return
    void ask(question)
    setQuestion('')
  }

  return (
    <div className="chat">
      <div className="chat__messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat__hint">
            {transcriptLength === 0
              ? 'Todavía no hay transcripción — arrancá a grabar arriba antes de preguntar.'
              : `Preguntá lo que quieras sobre la conversación (usando ${usingRefined ? 'la versión refinada' : 'el borrador en vivo'}).`}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble--${m.role}`}>
            {m.role === 'assistant' ? <CitedText text={m.text} segments={citationSegments} onCite={onCite} /> : m.text}
          </div>
        ))}
        {status === 'asking' && <div className="bubble bubble--assistant bubble--pending">Pensando...</div>}
      </div>
      {error && (
        <p className="error-text" style={{ padding: '0 12px' }}>
          Error: {error}
        </p>
      )}
      <div className="chat__input-row">
        <input
          className="chat__input"
          placeholder="Escribí tu pregunta..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          disabled={status === 'asking'}
        />
        <button className="btn btn--primary" onClick={handleAsk} disabled={status === 'asking' || !question.trim()}>
          Enviar
        </button>
      </div>
    </div>
  )
}
