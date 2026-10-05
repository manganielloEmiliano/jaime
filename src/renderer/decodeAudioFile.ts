/**
 * Decodifica un archivo de audio arbitrario (mp3, wav, m4a, lo que soporte
 * el motor de media de Chromium) y lo resamplea a mono 16kHz — el formato
 * que espera whisper.cpp. Corre 100% con Web Audio API, no necesita nada
 * de Node/Electron — por eso vive en el renderer y no en preload (a
 * diferencia de la captura en vivo, acá no hace falta ipcRenderer al
 * mismo tiempo que el DOM).
 */
export async function decodeAudioFileTo16kHzMono(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer()
  const decodeCtx = new AudioContext()
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer)
  await decodeCtx.close()

  const targetSampleRate = 16000
  const targetLength = Math.ceil(decoded.duration * targetSampleRate)
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate)
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start()

  const rendered = await offlineCtx.startRendering()
  return rendered.getChannelData(0)
}
