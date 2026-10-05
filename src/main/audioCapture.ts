/**
 * CORRECCIÓN post-Fase 0: esto originalmente asumía que la captura de audio
 * pasaba por el proceso main. Al revisar la API real de
 * `electron-audio-loopback` (node_modules/electron-audio-loopback/dist),
 * resultó que:
 *
 *  - `initMain()` corre en MAIN — solo registra los handlers de IPC que
 *    habilitan/deshabilitan el `setDisplayMediaRequestHandler` de la sesión.
 *    Se llama una vez en `main.ts`. Ver ahí.
 *  - `getLoopbackAudioMediaStream()` corre en RENDERER — usa
 *    `navigator.mediaDevices.getDisplayMedia`, una API de browser que no
 *    existe en el proceso main. La captura real (loopback + mic) vive en
 *    `src/renderer/testRecording.ts` (Fase 1, POC) y se va a mover a un
 *    módulo definitivo en la Fase 2 cuando se conecte al SttEngine.
 *
 * Este archivo queda solo para el tipo compartido, re-exportado por
 * compatibilidad con lo que ya importa `SttEngine.ts`.
 */
export type { AudioSource } from '../shared/types'
