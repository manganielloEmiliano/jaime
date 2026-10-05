# Saber quién habla — opciones de diarización para Jaime

> Investigación: septiembre 2026. Estado: **solo documentación**, sin implementación.

## El problema

Jaime graba dos canales: **Vos** (micrófono) y **Otros** (loopback del sistema). "Otros" es un único stream mezclado: todos los participantes remotos suenan juntos, así que el transcript no puede decir *quién* dijo cada cosa. Queremos etiquetar cada fragmento con el hablante — idealmente con su **nombre real** y **en vivo** (para preguntar durante la reunión "¿qué dijo Juan?").

## Dos conceptos antes de las opciones

**1. Hay dos preguntas distintas, y conviene no mezclarlas:**
- **¿Cuándo cambia la voz?** (separar hablantes) → esto es *diarización*: da etiquetas anónimas ("Hablante 1", "Guest-2").
- **¿Cómo se llama esa voz?** (identificar) → el audio solo no sabe nombres; el nombre sale de **Teams** (roster, subtítulos, bot), de **nombrarla a mano** una vez, o de **inferirlo** por contexto.

**2. Hay dos formas de atribuir quién habla:**
- **Audio por persona**: cada participante llega en su propio stream → no hay nada que adivinar, cada stream ya tiene dueño. Solo lo obtiene un participante *dentro* de la llamada (bot).
- **Audio mezclado + línea de tiempo**: se graba todo junto y aparte se obtiene una línea de tiempo "10:03:12 → Juan, 10:03:20 → Ana" (de Teams o de un diarizador), y se **cruza** con los fragmentos por timestamp. El cruce puede hacerse en vivo.

**Hallazgo central:** Teams **no expone ninguna API oficial para que una app local sepa en vivo quién habla.** Lo oficial en vivo requiere un participante que entra a la reunión; lo oficial sin bot es post-reunión.

---

# Familia A — Opciones que obtienen el nombre desde Teams

## A1. UI Automation del Teams de escritorio (local)

Un helper (C#, FlaUI / System.Windows.Automation) lee el árbol de accesibilidad de `ms-teams.exe` (WebView2): el panel de **subtítulos en vivo** (nombre + texto) y/o el **indicador de quién habla**. Forma: *audio mezclado + línea de tiempo*.

| Ventajas | Desventajas |
|---|---|
| Nombres **en vivo**, sin bot visible, sin admin | **Frágil**: depende del markup de Teams; cualquier update lo puede romper |
| 100% local, nada sale de la PC | Los subtítulos hay que activarlos en cada reunión; el texto depende del idioma de la UI |
| Granola documenta que hace esto (speaker tags vía accesibilidad) → el camino existe | No hay proyecto público que documente el árbol UIA del Teams nuevo → ingeniería inversa |
| Los subtítulos de Teams ya traen el nombre → alineación directa | No soportado por Microsoft; el indicador "hablando" puede ser solo visual y no estar expuesto |
| | Proceso helper extra a empaquetar y mantener; solo Windows |

## A2. Graph meeting transcripts (oficial, post-reunión)

Login con MSAL; al terminar se descarga la transcripción de Teams (VTT con nombres y timestamps) y se alinea con los fragmentos de Jaime.

| Ventajas | Desventajas |
|---|---|
| **Oficial y robusto**, con los nombres exactos de Teams | **Solo post-reunión** → no sirve "en vivo" |
| Sin bot visible | Consentimiento del admin (`OnlineMeetingTranscript.Read.All`); el admin puede desactivar la atribución de hablantes |
| Esfuerzo bajo-medio | Requiere que **la transcripción de Teams esté activada** en la reunión (todos ven el aviso) |
| | APIs "metered" (posible costo por uso, sin verificar) |

## A3. Invitado ACS (Azure Communication Services)

Jaime se une a la reunión como **invitado silencioso** con el Calling SDK de ACS (corre en la PC del usuario, con la clave de ACS del usuario; sin servidor propio). Dos variantes:

**A3-a. Línea de tiempo (`dominantSpeakersChanged` + roster con `displayName`)** — el audio sigue saliendo del loopback.

**A3-b. Audio por participante** — la doc oficial de ACS dice que el SDK cliente *"tiene acceso a los streams de audio individuales de cada participante"* (cada stream cuelga de su `RemoteParticipant` con su nombre). Reemplazaría al loopback para "Otros": se transcribe cada persona por separado, ya con nombre.

| Ventajas | Desventajas |
|---|---|
| Oficial y **en vivo**, con nombres | **Aparece en la reunión** ("Jaime (notas)") — acordarlo con el equipo |
| Sin admin para consentir permisos (sí suscripción de Azure propia) | El tenant debe permitir **invitados anónimos**; Microsoft puede exigir **aprobación manual en el lobby** |
| A3-b: audio aislado por persona → mejor transcripción, sin diarizar | **A3-a: audio duplicado** — el invitado reproduce la reunión por los parlantes y el loopback la graba dos veces (hay que silenciar el audio entrante de ACS) |
| A3-b elimina el problema del audio duplicado | **A3-b está en preview** (sin SLA) y es **máx. 4 hablantes simultáneos**; que funcione en reuniones de Teams lo afirma un Q&A, no la doc oficial |
| Mismo modelo que Fathom → camino probado | Hay que pegar el link de cada reunión; no entra a E2EE, webinars, town halls ni live events; costo por minuto |
| | A3-b: cambio grande en Jaime (de 2 canales fijos a N dinámicos) |

## A4. Bot de media en tiempo real de Graph

Servicio en **C#/.NET en Azure** (`Microsoft.Graph.Communications.Calls.Media`) que se une a la reunión y recibe audio crudo **cuadro a cuadro** (50/s, 20 ms, **PCM 16 kHz 16-bit** — el formato exacto que ya usa whisper en Jaime). Con `ReceiveUnmixedMeetingAudio = true` recibe **hasta 4 buffers separados**, uno por cada hablante activo, con su `ActiveSpeakerId` → se mapea al roster para obtener el nombre. Forma: *audio por persona*. El bot le mandaría a Jaime (escritorio) el audio de cada persona con su nombre por WebSocket.

**Variante "grabación de cumplimiento" (Policy Recording Bot, sample oficial):** el admin asigna una política a ciertos usuarios y el bot **entra solo a todas sus llamadas y reuniones** — sin pegar links ni lobby. Los participantes ven el aviso de grabación.

Requisitos (doc oficial):
- **Solo C#/.NET** (incluye .NET 6+); Node y C++ **no** acceden a media en tiempo real → proyecto aparte de Jaime.
- **Windows Server en Azure** (VM IaaS, Cloud Service, VMSS o AKS); **no** Azure Web App.
- **IP pública por VM** + puerto público mapeado a esa instancia.
- Mínimo **2 núcleos** (serie Dv2 recomendada) o 4 vCPU.
- La llamada queda **fija a su VM**: si la VM se reinicia, la llamada se corta.
- La librería **no puede tener más de 3 meses**: las versiones viejas **dejan de funcionar**.
- Permisos de aplicación con **consentimiento del admin** (del estilo `Calls.JoinGroupCall.All`, `Calls.AccessMedia.All` — nombres exactos a confirmar).
- *"El Real-time Media Platform está en developer preview."*

Advertencias textuales de Microsoft:
- *"Real-time Media bots are not recommended for AI agent scenarios"* (recomiendan Copilot Studio o Graph transcripts).
- Pensados para compliance recording, contact centers e interop de video, *"provistos vía partners gestionados y en algunos casos certificados por Microsoft"*.
- *"Requieren inversión significativa de infraestructura… Evaluá si tu escenario realmente necesita acceso a media cruda."*

| Ventajas | Desventajas |
|---|---|
| **La mejor fuente de datos que existe**: audio aislado por persona, con nombre, en vivo | **Jaime deja de ser local**: el audio de las reuniones pasa por un servidor en Azure (privacidad/arquitectura) |
| Formato idéntico al de whisper (PCM 16 kHz) | Infraestructura a operar: VMs Windows con IP pública, costo mensual fijo (estimado: cientos de USD/mes, sin verificar) |
| Variante compliance: entra sola a todas las reuniones, sin lobby | Stack distinto (C#/.NET), SDK a actualizar cada ≤3 meses |
| Oficial | **Admin obligatorio**; plataforma en *developer preview*; Microsoft lo desaconseja para agentes IA |
| Escala a toda la empresa con un solo despliegue | Máx. 4 hablantes simultáneos en audio separado |

**Cuándo conviene:** si Jaime pasa a ser un **producto para toda la empresa** (un bot sirve a muchos usuarios, desplegado por el admin como compliance recording). Para una app de escritorio de un solo usuario es sobredimensionado.

---

# Familia B — Diarización por audio (etiquetas anónimas, sirve para cualquier plataforma)

Estas opciones **no dependen de Teams**: funcionan igual con Meet, Zoom, llamadas y audios importados. Dan "Hablante 1/2/3"; el nombre se resuelve aparte (ver Familia C).

## B1. Diarización local (sherpa-onnx)

pyannote segmentation-3.0 (ONNX) + modelo de embeddings de voz (p.ej. CAM++), con addon para Node.

| Ventajas | Desventajas |
|---|---|
| 100% local, gratis, cualquier plataforma | **Por bloques / offline**, no streaming real |
| No depende de updates de terceros | Falla con voces solapadas o parecidas |
| Los embeddings sirven también para perfiles de voz (C1) | Costo de CPU sin medir (sin cifras publicadas); más modelos en el instalador; otro addon nativo |

## B2. AssemblyAI streaming con diarización (nube) — **ya integrado en Jaime**

Jaime ya usa el WebSocket de AssemblyAI (`src/main/stt/AssemblyAiEngine.ts`). Según AssemblyAI, la diarización en streaming se activa con `speaker_labels: true` en la conexión, con `max_speakers` (1–10) como pista; etiquetas **en vivo** a nivel palabra, con una revisión ~0,5 s después de cerrar el stream.

| Ventajas | Desventajas |
|---|---|
| **Cambio chico**: el motor ya existe en Jaime | El audio sale a la nube (ya pasa hoy si se usa AssemblyAI) |
| **En vivo**, hasta 10 hablantes, sirve para cualquier plataforma | Costo extra: **USD 0,12/hora** sobre la transcripción (según su web) |
| Calidad de un modelo comercial, sin CPU local | Etiquetas anónimas; aplicaría al canal "Otros" |

## B3. Azure AI Speech — `ConversationTranscriber` (nube)

Diarización en tiempo real con IDs genéricos (`Guest-1`, `Guest-2`). Hay que habilitar `DiarizeIntermediateResults` para tener etiquetas en resultados parciales (si no, salen como `Unknown`). Jaime ya tiene un `AzureSpeechEngine.ts` (no conectado a diarización).

| Ventajas | Desventajas |
|---|---|
| En vivo, oficial de Microsoft | Microsoft aclara que **no identifica personas** (sin voice signatures en tiempo real) |
| Base de código ya presente en Jaime | Early results pueden salir `Unknown`; audio a la nube; costo por hora |

---

# Familia C — Cómo ponerle nombre a una etiqueta anónima

Se combinan con cualquier opción de la Familia B.

| Estrategia | Cómo | Ventajas | Desventajas |
|---|---|---|---|
| **C1. Nombrar una vez + perfiles de voz** (modelo Jamie) | El usuario asigna "Hablante 2 = Juan"; se guarda un embedding de voz y se reconoce en próximas reuniones | Mejora con el uso; local | Requiere el primer nombrado manual; voces parecidas confunden |
| **C2. Inferencia por contexto (LLM)** | El LLM deduce nombres del contenido ("Gracias, Ana…") | Cero fricción; Jaime ya tiene LLM | Puede equivocarse; hay que mostrarlo como sugerencia |
| **C3. Candidatos del calendario** | Los asistentes de la invitación se ofrecen como opciones al nombrar | Acota la elección | Necesita acceso al calendario (Graph, consentimiento) |
| **C4. Cruce con una fuente de Teams** | La línea de tiempo de A1/A3-a pone el nombre a cada cluster | Nombres automáticos | Hereda las dependencias de esa fuente |

---

## Descartadas (verificado)

| Opción | Por qué no |
|---|---|
| teams-js `registerSpeakingStateChangeHandler` | Devuelve solo `isSpeakingDetected` (booleano "alguien habla"), sin identidad |
| API local de terceros (`ws://127.0.0.1:8124`, la de Stream Deck) | Solo mute / cámara / mano / en reunión; retirada por Microsoft (MC1266901, 2026-06-30) |
| Logs locales de Teams | Sin evidencia de eventos de hablante activo |
| Graph AI Insights (Copilot) | Solo menciones, hasta 4 h después, requiere licencia Copilot |

---

## Cómo funciona Fathom (referencia)

### Modo con bot (el principal)
1. El usuario instala Fathom y **conecta su calendario**.
2. Al empezar una reunión entra **automáticamente** un participante visible **"Fathom Notetaker"**.
3. Entra como **invitado anónimo/externo** desde la **nube de Fathom** (no desde la PC).
4. Estando dentro de la llamada recibe audio/video y sabe quién habla → transcript con nombres (corregibles a mano), resumen, action items, CRM.

Requisitos en Teams (su centro de ayuda): **"Anonymous users can join a meeting"** (org) y **"Anonymous users can join a meeting unverified"** (política del organizador); Microsoft puede marcarlo como bot y **pedir aprobación manual en el lobby**; **no graba reuniones E2EE**. *Cómo* asigna cada frase a cada persona (audio por persona o línea de tiempo) no está documentado.

### Modo sin bot (beta)
Graba desde el dispositivo, dice mantener la atribución de hablantes (sin documentar cómo); **solo Mac**.

### Otros productos

| Producto | Cómo obtiene los nombres |
|---|---|
| **Fathom** | Bot en la nube como invitado anónimo (≈ A3/A4) |
| **Granola** | Accesibilidad de la app de reunión (≈ A1); por defecto solo "Yo / Ellos" |
| **Jamie** | Diarización + nombrar voces una vez + perfiles de voz (≈ B1 + C1) |

---

## Comparación general

| Opción | Nombres | En vivo | Admin | Local | Esfuerzo | Fragilidad |
|---|---|---|---|---|---|---|
| A1. UI Automation | Sí (con subtítulos) | Sí | No | Sí | Alto | **Alta** |
| A2. Graph transcripts | Sí | **No** | Sí | No | Bajo-medio | Baja |
| A3-a. ACS línea de tiempo | Sí | Sí | Políticas de anónimos | Sí (en la PC) | Medio | Media (audio duplicado) |
| A3-b. ACS audio por persona | Sí | Sí | Políticas de anónimos | Sí (en la PC) | Alto | Media (preview) |
| A4. Bot media Graph | Sí | Sí | **Sí** | **No (Azure)** | **Muy alto** | Baja técnica / alta operativa |
| B1. sherpa-onnx | No* | Casi | No | Sí | Medio | Media |
| B2. AssemblyAI diarización | No* | Sí | No | No (nube) | **Bajo** | Baja |
| B3. Azure ConversationTranscriber | No* | Sí | No | No (nube) | Medio | Baja |

\* Sin nombres por sí solas: se completan con una estrategia de la Familia C.

## Recomendación por escenario

| Escenario | Recomendación |
|---|---|
| **Jaime para uso personal, rápido** | **B2 (AssemblyAI con `speaker_labels`) + C1/C2** — el menor esfuerzo: el motor ya está integrado |
| **Personal, sin nube** | **B1 (sherpa-onnx) + C1** |
| **Nombres reales de Teams en vivo, uso personal** | **A3 (invitado ACS)** — probar primero A3-b; si el audio por persona no funciona en Teams, A3-a silenciando el audio entrante |
| **Producto para toda la empresa** | **A4 en modo grabación de cumplimiento** — un despliegue del admin sirve a todos |
| **Solo necesito el acta después** | **A2 (Graph transcripts)** |

## Pedir al admin del tenant (según la opción)
- A3 / estilo Fathom: **"Anonymous users can join a meeting"** (org) + **"Anonymous users can join a meeting unverified"** (política del organizador).
- A2: consentimiento de `OnlineMeetingTranscript.Read.All` y que la atribución de hablantes esté habilitada.
- A4: registro de la app con permisos de llamadas/media, consentimiento, y (variante compliance) crear y asignar la política de grabación.

---

## Fuentes

- Graph meeting transcripts — https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/meeting-transcripts/overview-transcripts
- Permisos de transcripts — https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts?view=graph-rest-1.0
- Meeting AI Insights — https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/meeting-transcripts/meeting-insights
- Real-time media concepts (Teams) — https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/real-time-media-concepts
- Requisitos de application-hosted media bots — https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots
- AudioSocketSettings / ReceiveUnmixedMeetingAudio — https://microsoftgraph.github.io/microsoft-graph-comms-samples/docs/bot_media/Microsoft.Skype.Bots.Media.AudioSocketSettings.html
- Policy Recording Bot sample — https://github.com/microsoftgraph/microsoft-graph-comms-samples/tree/master/Samples/V1.0Samples/LocalMediaSamples/PolicyRecordingBot
- teams-js meeting API — https://learn.microsoft.com/en-us/javascript/api/@microsoft/teams-js/meeting?view=msteams-client-js-latest
- ACS en reuniones de Teams (capacidades) — https://learn.microsoft.com/en-us/azure/communication-services/concepts/interop/guest/meeting-capabilities
- ACS raw media access — https://learn.microsoft.com/en-us/azure/communication-services/concepts/voice-video-calling/media-access
- Q&A: audio separado en reunión de Teams con el Calling SDK — https://learn.microsoft.com/en-us/answers/questions/2280496/get-discrete-audio-from-a-teams-meeting-with-the-c
- AssemblyAI streaming diarization — https://www.assemblyai.com/blog/streaming-diarization-major-upgrade
- AssemblyAI speaker diarization — https://www.assemblyai.com/features/speaker-diarization
- Azure Speech real-time diarization — https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-stt-diarization
- sherpa-onnx diarización — https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html
- Retiro de la API local de terceros (MC1266901) — https://mc.merill.net/message/MC1266901
- teams-monitor (campos de la API local) — https://github.com/svrooij/teams-monitor
- Fathom + Teams — https://help.fathom.video/en/articles/13114369
- Fathom integración Teams — https://www.fathom.ai/integrations/microsoft-teams
- Fathom sin bot — https://www.fathom.ai/learn/bot-free-note-taker
- Granola speaker tags — https://docs.granola.ai/help-center/taking-notes/speaker-attribution
- Jamie identificación de hablantes — https://docs.meetjamie.ai/getting-started/identify-speaker
