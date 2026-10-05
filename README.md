# Jaime

Notas y Q&A en vivo durante llamadas de Microsoft Teams.

Jaime es una app de escritorio para Windows (Electron + React) que graba tu micrófono y el audio del sistema, los transcribe en vivo y te deja hacerle preguntas a la conversación mientras sucede. La transcripción corre **100% local por default** con whisper.cpp: no hace falta cuenta ni internet para arrancar.

## Funcionalidades

- **Captura en dos canales**: micrófono ("Vos") y audio del sistema por loopback ("Otros"), o solo uno de los dos.
- **Transcripción en vivo** con whisper.cpp local (`ggml-small`) o streaming en la nube con AssemblyAI.
- **Refinado al detener**: re-transcribe el `.wav` completo con `large-v3-turbo` para un resultado más preciso.
- **Q&A sobre la conversación** con Gemini, DeepSeek o Claude (vía Claude Code CLI, usando tu sesión logueada).
- **Modo burbuja**: al cambiar de ventana, la app se achica a una burbuja flotante sin cortar la grabación.
- **Sesiones**: historial de grabaciones, re-refinado, renombrado y transcripción de audios ya grabados.

## Stack

| Capa | Tecnología |
|---|---|
| Shell | Electron 44 |
| Build | electron-vite + Vite 7 |
| UI | React 18 + TypeScript |
| STT | whisper.cpp (`@kutalia/whisper-node-addon`), AssemblyAI |
| Audio | `electron-audio-loopback` |
| Empaquetado | electron-builder (NSIS) |

## Requisitos

- Windows 10/11, 64 bits
- Node.js 20+
- Modelos de whisper en formato GGML dentro de `models/` (no están versionados)

## Puesta en marcha

```bash
npm install
```

### Modelos de whisper

Descargá los modelos desde [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/main) y dejalos en `models/`:

```
models/
├─ ggml-small.bin           # transcripción en vivo
└─ ggml-large-v3-turbo.bin  # refinado al detener
```

### Variables de entorno (opcional)

Las API keys se pueden cargar desde la pestaña **Ajustes** de la app. Como alternativa, en desarrollo se leen de un `.env` en la raíz:

```env
GEMINI_API_KEY=...
DEEPSEEK_API_KEY=...
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta la app en modo desarrollo con hot reload |
| `npm run build` | Compila main, preload y renderer a `out/` |
| `npm run typecheck` | Chequea tipos sin emitir |
| `npm run dist:win` | Genera el instalador NSIS para Windows en `dist/` |

## Estructura

```
src/
├─ main/        # Proceso principal: captura de audio, sesiones, persistencia
│  ├─ stt/      # Motores de transcripción (whisper.cpp, AssemblyAI, ...)
│  └─ llm/      # Motores de LLM para el Q&A (Gemini, DeepSeek, Claude CLI, ...)
├─ preload/     # Bridge seguro entre main y renderer
├─ renderer/    # UI en React (paneles, componentes, hooks)
└─ shared/      # Tipos compartidos entre procesos
docs/           # Manual de usuario e investigaciones
build/          # Íconos para el instalador
```

## Dónde se guardan las grabaciones

Cada grabación crea una subcarpeta con la fecha y hora de inicio (`AAAA-MM-DD_HH-MM-SS`) en dos carpetas base, configurables desde Ajustes:

```
Documentos/Jaime/
├─ Audios/<sesión>/          # you.wav, other.wav
└─ Transcripciones/<sesión>/ # transcript.md, metadata.json
```

## Documentación

- [`docs/manual.html`](docs/manual.html): manual de usuario (instalación y primeros pasos)
- [`docs/teams-quien-habla.md`](docs/teams-quien-habla.md): investigación sobre diarización en Teams

> **Recomendación**: usá auriculares en el modo "Vos y otros". Sin ellos, el micrófono vuelve a captar la voz de la otra persona y queda mezclada en tu canal.
