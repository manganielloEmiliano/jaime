import { useEffect, useState } from 'react'

type TestStatus = 'idle' | 'testing' | 'ok' | 'error'
type SaveStatus = 'idle' | 'saving' | 'saved'

const PROVIDER_INFO: Record<LlmProvider, { label: string; keyHint: string; needsKey: boolean }> = {
  gemini: { label: 'Gemini (Google AI Studio)', keyHint: 'Generá una key en aistudio.google.com/apikey', needsKey: true },
  deepseek: { label: 'DeepSeek', keyHint: 'Generá una key en platform.deepseek.com', needsKey: true },
  'claude-cli': {
    label: 'Claude (sesión local de Claude Code)',
    keyHint:
      'Sin API key — usa la sesión de Claude Code ya logueada en esta máquina (misma que la terminal). Corre contra tu suscripción, no factura por token. Requiere tener el CLI "claude" instalado y logueado (claude login).',
    needsKey: false
  }
}

const STT_PROVIDER_INFO: Record<SttProvider, { label: string; hint: string }> = {
  'whisper-local': {
    label: 'Local (whisper.cpp)',
    hint: 'Corre 100% en esta máquina, sin costo por uso, pero sin resultados en vivo palabra a palabra (transcribe por chunks de ~6s).'
  },
  assemblyai: {
    label: 'API en tiempo real (AssemblyAI)',
    hint: 'Streaming real con resultados parciales en vivo. Requiere API key y conexión a internet — $0.15/hora aprox. (Universal-Streaming Multilingual).'
  }
}

/**
 * Settings: proveedor de LLM (sin cambios de fondo), + dos secciones
 * nuevas — rutas de guardado (carpeta base de audios/transcripciones, con
 * selector nativo de carpetas) y proveedor de STT (local vs API en tiempo
 * real, con su propia key).
 */
export function SettingsPanel() {
  const [settings, setSettingsState] = useState<AppSettings | null>(null)

  const [selectedProvider, setSelectedProvider] = useState<LlmProvider>('gemini')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  const [claudeModel, setClaudeModel] = useState<ClaudeModelTier | undefined>(undefined)

  const [sttProvider, setSttProvider] = useState<SttProvider>('whisper-local')
  const [assemblyKeyInput, setAssemblyKeyInput] = useState('')
  const [sttTestStatus, setSttTestStatus] = useState<TestStatus>('idle')
  const [sttTestError, setSttTestError] = useState<string | null>(null)

  useEffect(() => {
    window.jaime.getSettings().then((s) => {
      setSettingsState(s)
      setSelectedProvider(s.llmProvider)
      setApiKeyInput(s.apiKeys[s.llmProvider] ?? '')
      setClaudeModel(s.claudeModel)
      setSttProvider(s.sttProvider)
      setAssemblyKeyInput(s.apiKeys.assemblyai ?? '')
    })
  }, [])

  function handleProviderChange(provider: LlmProvider) {
    setSelectedProvider(provider)
    setApiKeyInput(settings?.apiKeys[provider] ?? '')
    setTestStatus('idle')
    setTestError(null)
  }

  async function handleTestAndSaveLlm() {
    setTestStatus('testing')
    setTestError(null)
    const result = await window.jaime.testLlmKey(selectedProvider, apiKeyInput)
    if (!result.ok) {
      setTestStatus('error')
      setTestError(result.error)
      return
    }
    setTestStatus('ok')
    setSaveStatus('saving')
    const updated = await window.jaime.setSettings(
      PROVIDER_INFO[selectedProvider].needsKey
        ? { llmProvider: selectedProvider, apiKeys: { [selectedProvider]: apiKeyInput } }
        : { llmProvider: selectedProvider } // claude-cli no guarda ninguna key
    )
    setSettingsState(updated)
    setSaveStatus('saved')
  }

  async function handleClaudeModelChange(tier: ClaudeModelTier) {
    setClaudeModel(tier)
    const updated = await window.jaime.setSettings({ claudeModel: tier })
    setSettingsState(updated)
  }

  async function handleSttProviderChange(provider: SttProvider) {
    setSttProvider(provider)
    setSttTestStatus('idle')
    setSttTestError(null)
    if (provider === 'whisper-local') {
      const updated = await window.jaime.setSettings({ sttProvider: provider })
      setSettingsState(updated)
    }
  }

  async function handleTestAndSaveStt() {
    setSttTestStatus('testing')
    setSttTestError(null)
    const result = await window.jaime.testSttKey(assemblyKeyInput)
    if (!result.ok) {
      setSttTestStatus('error')
      setSttTestError(result.error)
      return
    }
    setSttTestStatus('ok')
    const updated = await window.jaime.setSettings({
      sttProvider: 'assemblyai',
      apiKeys: { assemblyai: assemblyKeyInput }
    })
    setSettingsState(updated)
  }

  async function handleChooseFolder(field: 'audioBaseDir' | 'transcriptBaseDir') {
    const chosen = await window.jaime.chooseFolder()
    if (!chosen) return
    const updated = await window.jaime.setSettings({ [field]: chosen })
    setSettingsState(updated)
  }

  if (!settings) {
    return (
      <div className="panel-padding">
        <p className="muted">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="panel-padding">
      <div className="settings-section">
        <h3>Rutas de guardado</h3>
        <p className="muted" style={{ marginBottom: 8 }}>
          Cada grabación crea una subcarpeta con la fecha/hora dentro de estas carpetas base — el transcript
          queda como Markdown + metadata.json, listo para que lo lea Claude u otro agente.
        </p>
        <div className="settings-path-row">
          <span>Audios:</span>
          <span className="settings-path-row__path" title={settings.audioBaseDir}>
            {settings.audioBaseDir}
          </span>
          <button className="btn" title="Abrir carpeta" onClick={() => window.jaime.openPath(settings.audioBaseDir)}>
            📂
          </button>
          <button className="btn" onClick={() => handleChooseFolder('audioBaseDir')}>
            Elegir carpeta
          </button>
        </div>
        <div className="settings-path-row">
          <span>Transcripciones:</span>
          <span className="settings-path-row__path" title={settings.transcriptBaseDir}>
            {settings.transcriptBaseDir}
          </span>
          <button
            className="btn"
            title="Abrir carpeta"
            onClick={() => window.jaime.openPath(settings.transcriptBaseDir)}
          >
            📂
          </button>
          <button className="btn" onClick={() => handleChooseFolder('transcriptBaseDir')}>
            Elegir carpeta
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>Transcripción (STT)</h3>
        {(Object.keys(STT_PROVIDER_INFO) as SttProvider[]).map((provider) => (
          <label key={provider} className="settings-radio">
            <input
              type="radio"
              name="sttProvider"
              checked={sttProvider === provider}
              onChange={() => handleSttProviderChange(provider)}
            />{' '}
            {STT_PROVIDER_INFO[provider].label}
            {provider === 'assemblyai' && settings.apiKeys.assemblyai && <span style={{ color: 'var(--success)' }}> (key configurada)</span>}
          </label>
        ))}
        <p className="muted" style={{ margin: '4px 0 8px' }}>{STT_PROVIDER_INFO[sttProvider].hint}</p>

        {sttProvider === 'assemblyai' && (
          <>
            <input
              type="password"
              className="settings-input"
              placeholder="API key de AssemblyAI"
              value={assemblyKeyInput}
              onChange={(e) => {
                setAssemblyKeyInput(e.target.value)
                setSttTestStatus('idle')
              }}
            />
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={handleTestAndSaveStt}
              disabled={!assemblyKeyInput.trim() || sttTestStatus === 'testing'}
            >
              {sttTestStatus === 'testing' ? 'Probando la key...' : 'Probar y guardar'}
            </button>
            {sttTestStatus === 'ok' && <p style={{ color: 'var(--success)' }}>Key válida y guardada.</p>}
            {sttTestStatus === 'error' && <p className="error-text">La key no funcionó: {sttTestError}</p>}
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>Proveedor de LLM para el Q&amp;A</h3>
        {(Object.keys(PROVIDER_INFO) as LlmProvider[]).map((provider) => {
          // "en uso ahora" = lo que está guardado y realmente activo (settings.llmProvider) — distinto
          // de `selectedProvider`, que es solo el radio tocado en esta pantalla, todavía sin guardar.
          const isActive = settings.llmProvider === provider
          const hasStoredKey = PROVIDER_INFO[provider].needsKey && Boolean(settings.apiKeys[provider])
          return (
            <label key={provider} className="settings-radio">
              <input
                type="radio"
                name="llmProvider"
                checked={selectedProvider === provider}
                onChange={() => handleProviderChange(provider)}
              />{' '}
              {PROVIDER_INFO[provider].label}
              {isActive && (
                <span style={{ color: 'var(--success)' }}>
                  {' '}
                  · en uso ahora{provider === 'claude-cli' ? ' (con tu cuenta de Claude)' : ''}
                </span>
              )}
              {!isActive && hasStoredKey && <span className="muted"> (key guardada, no en uso)</span>}
            </label>
          )
        })}

        {selectedProvider === 'claude-cli' && (
          <div style={{ margin: '8px 0' }}>
            <span className="muted">Modelo: </span>
            {(['sonnet', 'opus', 'haiku'] as const).map((tier) => (
              <label key={tier} className="settings-radio" style={{ display: 'inline-block', marginRight: 14 }}>
                <input
                  type="radio"
                  name="claudeModel"
                  checked={(claudeModel ?? 'sonnet') === tier}
                  onChange={() => handleClaudeModelChange(tier)}
                />{' '}
                {tier}
              </label>
            ))}
          </div>
        )}

        <p className="muted" style={{ margin: '8px 0 4px' }}>{PROVIDER_INFO[selectedProvider].keyHint}</p>
        {PROVIDER_INFO[selectedProvider].needsKey && (
          <input
            type="password"
            className="settings-input"
            placeholder="API key"
            value={apiKeyInput}
            onChange={(e) => {
              setApiKeyInput(e.target.value)
              setTestStatus('idle')
            }}
          />
        )}
        <button
          className="btn"
          style={{ marginTop: 8 }}
          onClick={handleTestAndSaveLlm}
          disabled={(PROVIDER_INFO[selectedProvider].needsKey && !apiKeyInput.trim()) || testStatus === 'testing'}
        >
          {testStatus === 'testing'
            ? 'Probando...'
            : PROVIDER_INFO[selectedProvider].needsKey
              ? 'Probar y guardar'
              : 'Probar conexión y guardar'}
        </button>

        {testStatus === 'ok' && saveStatus === 'saved' && <p style={{ color: 'var(--success)' }}>Key válida y guardada.</p>}
        {testStatus === 'error' && <p className="error-text">La key no funcionó: {testError}</p>}
      </div>

      <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />
      <p className="muted">
        Recordá usar auriculares si vas a grabar "vos y otros" — sin ellos el micrófono capta el audio del otro
        lado y contamina tu canal.
      </p>
      <p className="muted">Modo 100% local (LLM sin nube) todavía no está implementado.</p>
    </div>
  )
}
