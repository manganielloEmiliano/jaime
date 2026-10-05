import { AssemblyAI } from 'assemblyai'
import type { StreamingSttEngine, StreamingSttSession } from './SttEngine'

/**
 * Modo C — STT cloud vía AssemblyAI Universal-Streaming (Multilingual).
 * Verificado contra la documentación oficial (sept 2026) antes de
 * implementar, ver plan: $0.15/hr, soporta español, es la opción más
 * barata de las comparadas (Deepgram, Azure, Google, OpenAI) — se deja la
 * puerta abierta a subir a `universal-3-5-pro` (mejor precisión, $0.45/hr)
 * si hiciera falta, solo cambiando `speechModel` acá abajo.
 *
 * Contrato real: WebSocket (`wss://streaming.assemblyai.com/v3/ws`) con
 * PCM16 mono a 16kHz — mismo formato que ya produce `wavWriter.ts` para el
 * .wav de disco, no hace falta reencodear nada. El SDK oficial (`assemblyai`
 * en npm) abstrae el WS: `client.streaming.transcriber(opts)` + `connect()`
 * + `sendAudio(buffer)`, y un evento `turn` con `{transcript, end_of_turn}`
 * — `end_of_turn: true` marca el texto final de ese turno. Esto reemplaza
 * el "refinar al cortar" que hace falta con whisper.cpp (acá el texto
 * final llega en vivo, sin tener que re-transcribir nada al Detener).
 */
export class AssemblyAiEngine implements StreamingSttEngine {
  constructor(private readonly apiKey: string) {}

  async createSession(): Promise<StreamingSttSession> {
    const client = new AssemblyAI({ apiKey: this.apiKey })
    const transcriber = client.streaming.transcriber({
      sampleRate: 16000,
      encoding: 'pcm_s16le',
      speechModel: 'universal-streaming-multilingual',
      languageCodes: ['es'],
      formatTurns: true
    })

    let onTranscriptCb: ((partial: boolean, text: string) => void) | null = null

    transcriber.on('turn', (turn: { transcript?: string; end_of_turn?: boolean }) => {
      if (turn.transcript) onTranscriptCb?.(!turn.end_of_turn, turn.transcript)
    })
    transcriber.on('error', (err: unknown) => {
      console.error('[AssemblyAiEngine] error de streaming:', err)
    })

    await transcriber.connect()

    return {
      sendAudio(pcm16: Buffer) {
        // El SDK espera un ArrayBuffer "puro", no un Buffer/Uint8Array de
        // Node — y usar `pcm16.buffer` directo sería un bug latente: los
        // Buffers de Node suelen compartir un ArrayBuffer "pool" más grande
        // que el propio buffer, así que copiamos el rango exacto.
        transcriber.sendAudio(new Uint8Array(pcm16).buffer)
      },
      onTranscript(cb) {
        onTranscriptCb = cb
      },
      async stop() {
        await transcriber.close()
      }
    }
  }

  /** Usado por el wizard de Settings ("Probar y guardar") — abre y cierra una sesión mínima para validar la key. */
  static async testApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const client = new AssemblyAI({ apiKey })
      const transcriber = client.streaming.transcriber({ sampleRate: 16000, encoding: 'pcm_s16le' })
      await transcriber.connect()
      await transcriber.close()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
