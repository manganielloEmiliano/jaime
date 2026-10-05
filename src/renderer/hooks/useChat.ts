import { useRef, useState } from 'react'

export type AskStatus = 'idle' | 'asking'

export interface ChatState {
  messages: ChatMessage[]
  status: AskStatus
  error: string | null
  ask: (question: string) => Promise<void>
}

/**
 * Historial de chat, sacado de `QueryPanel` por la misma razón que
 * `useRecordingSession`: el popup de chat (modo "popup", ver App.tsx) y el
 * chat completo dentro de la app expandida son dos VISTAS de la misma
 * conversación, no cada una la suya — si el estado viviera adentro de
 * `QueryPanel` y ese componente se ocultara/mostrara para el popup, el
 * popup no tendría cómo leer/escribir el mismo historial.
 */
export function useChat(transcript: SttSegment[]): ChatState {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<AskStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  // Estable durante toda la vida de este hook — identifica esta conversación
  // puntual ante main (ver ClaudeCliEngine: lo usa para decidir sesión
  // nueva vs `--resume`; el resto de los proveedores lo ignora).
  const chatIdRef = useRef(crypto.randomUUID())

  async function ask(question: string) {
    const text = question.trim()
    if (!text || status === 'asking') return

    setError(null)
    setStatus('asking')
    setMessages((prev) => [...prev, { role: 'user', text, createdAt: new Date().toISOString() }])

    try {
      const answer = await window.jaime.askQuestion(text, transcript, chatIdRef.current)
      setMessages((prev) => [...prev, { role: 'assistant', text: answer, createdAt: new Date().toISOString() }])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStatus('idle')
    }
  }

  return { messages, status, error, ask }
}
