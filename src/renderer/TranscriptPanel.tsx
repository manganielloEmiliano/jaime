import { useRef, useState } from 'react'
import { decodeAudioFileTo16kHzMono } from './decodeAudioFile'
import { formatTranscribeProgress, useTranscribeProgress } from './hooks/useTranscribeProgress'
import { useRevealCitation, type CitationFocus } from './hooks/useCitationFocus'
import { SegmentText } from './components/SegmentText'
import { formatTimestamp } from './format'

type UploadStatus = 'idle' | 'processing' | 'error'

interface TranscriptPanelProps {
  segments: SttSegment[]
  refined: TranscriptSegment[] | null
  setRefined: React.Dispatch<React.SetStateAction<TranscriptSegment[] | null>>
  liveCaption: { speaker: AudioSourceLabel; text: string } | null
  /** Última cita tocada en el chat — scroll + resaltado del fragmento al que apunta. */
  citeFocus: CitationFocus | null
}

/**
 * Panel de transcripción en vivo, con rótulo de hablante (you/other). Los
 * controles de grabación en sí (empezar/pausar/detener) viven ahora en
 * `RecordControls`, arriba de todo — acá solo se muestra el resultado:
 * borrador final por chunk/turno, el texto parcial del turno en curso
 * (streaming real) y, al cortar, el refinado editable.
 *
 * `segments` y `refined` viven en App.tsx porque QueryPanel también los
 * necesita como contexto para el Q&A — y en particular, tiene que ver las
 * correcciones manuales que se le hagan a `refined`.
 *
 * El refinado se edita fragmento por fragmento (no como un solo texto por
 * hablante): así cada corrección manual queda en SU fragmento y las citas
 * del chat siguen apuntando al lugar correcto.
 */
export function TranscriptPanel({ segments, refined, setRefined, liveCaption, citeFocus }: TranscriptPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useRevealCitation(rootRef, citeFocus)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadResult, setUploadResult] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // null mientras se decodifica el archivo (todavía no hay ventanas que contar).
  const uploadProgress = useTranscribeProgress('import', uploadStatus === 'processing')

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo después
    if (!file) return

    setUploadStatus('processing')
    setUploadError(null)
    setUploadResult(null)
    try {
      const pcmf32 = await decodeAudioFileTo16kHzMono(file)
      // A diferencia de `transcribeAudioBuffer` (solo transcribe, no queda
      // nada guardado), esto arma una sesión completa — audio + transcript
      // + metadata — para que el archivo importado aparezca en el tab
      // "Sesiones" igual que una grabación en vivo.
      const title = file.name.replace(/\.[^.]+$/, '') || file.name
      const { text } = await window.jaime.importAudioSession(pcmf32, title)
      setUploadResult(text || '(sin voz reconocible)')
      setUploadStatus('idle')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
      setUploadStatus('error')
    }
  }

  function updateRefinedSegment(id: string, text: string) {
    setRefined((prev) => prev?.map((s) => (s.id === id ? { ...s, text } : s)) ?? prev)
  }

  const isCited = (id: string | undefined) => id !== undefined && citeFocus?.segmentId === id

  return (
    <div className="transcript" ref={rootRef}>
      {segments.length === 0 && !liveCaption && <p className="muted">Todavía no hay texto reconocido.</p>}
      {segments.map((s, i) => (
        <p
          key={s.id ?? i}
          data-segment-id={s.id}
          className={`transcript__line ${isCited(s.id) ? 'segment--cited' : ''}`}
        >
          <strong>{s.speaker === 'you' ? 'Vos' : 'Otros'}:</strong>{' '}
          <SegmentText segmentId={s.id} text={s.text} focus={citeFocus} />
        </p>
      ))}
      {liveCaption && (
        <p className="transcript__live-caption">
          {liveCaption.speaker === 'you' ? 'Vos' : 'Otros'}: {liveCaption.text}...
        </p>
      )}

      {refined && (
        <div className="transcript__refined">
          <strong>Refinado</strong>
          <p className="muted">Editable — corregí a mano cosas que la transcripción entendió mal.</p>
          {refined.length === 0 && <p className="muted">(sin voz reconocible)</p>}
          {refined.map((s) => (
            <label key={s.id} className="segment-edit">
              <span className="segment__meta">
                {formatTimestamp(s.startMs)} · {s.speaker === 'you' ? 'Vos' : 'Otros'}
              </span>
              <textarea
                data-segment-id={s.id}
                className={isCited(s.id) ? 'segment--cited' : ''}
                value={s.text}
                onChange={(e) => updateRefinedSegment(s.id, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}

      <div className="transcript__upload">
        <p className="muted">
          Subir un audio externo: lo transcribe entero de una sola pasada y lo guarda como sesión (aparece en el tab
          "Sesiones").
        </p>
        <input type="file" accept="audio/*,.mpeg,.mpg,.opus,.ogg" onChange={handleFileUpload} disabled={uploadStatus === 'processing'} />
        {uploadStatus === 'processing' && (
          <p className="muted">
            {uploadProgress ? `Transcribiendo... ${formatTranscribeProgress(uploadProgress)}` : 'Decodificando audio...'}
          </p>
        )}
        {uploadResult !== null && (
          <>
            <textarea
              style={{ width: '100%', minHeight: 60, marginTop: 4 }}
              value={uploadResult}
              onChange={(e) => setUploadResult(e.target.value)}
            />
            <p className="muted">Guardado — buscalo en el tab "Sesiones" para renombrarlo o preguntar sobre él.</p>
          </>
        )}
        {uploadError && <p className="error-text">Error: {uploadError}</p>}
      </div>
    </div>
  )
}
