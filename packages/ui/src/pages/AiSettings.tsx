import type { Lang } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AiProviderId, AiPurpose, AiSettings, AiSettingsPatch, LocalModel } from '../api'
import { Popup, PopupOption } from '../components/Popup'
import { errorText, useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'

const PROVIDERS: Record<AiProviderId, string> = { 'codex-cli': 'ChatGPT（Codex）', deepseek: 'DeepSeek', 'claude-cli': 'Claude Code（本机）', 'openai-compatible': 'OpenAI 兼容 API' }
const PURPOSES: Record<AiPurpose, string> = { write: '制卡', qa: '问答' }

/** Which model does what. Keys stay on this Mac, encrypted with the system keychain. */
export function AiSection() {
  const toast = useToast()
  const [s, setS] = useState<AiSettings | null>(null)
  const [codexModels, setCodexModels] = useState<LocalModel[]>([])
  const [testing, setTesting] = useState<AiPurpose | null>(null)

  useEffect(() => {
    api.getAiSettings().then(setS)
    api.codexModels().then(setCodexModels)
  }, [])

  async function save(patch: AiSettingsPatch) {
    try {
      setS(await api.saveAiSettings(patch))
    } catch (err) {
      toast.show(errorText(err), 'error')
    }
  }

  async function test(purpose: AiPurpose) {
    setTesting(purpose)
    try {
      toast.show(await api.testAi(purpose))
    } catch (err) {
      toast.show(errorText(err), 'error')
    } finally {
      setTesting(null)
    }
  }

  if (!s) return null
  const models: Record<AiProviderId, string[]> = {
    'codex-cli': codexModels.map(model => model.id), 'claude-cli': ['sonnet', 'opus', 'haiku'],
    deepseek: ['deepseek-flash'], 'openai-compatible': s.openai.model ? [s.openai.model] : []
  }

  return (
    <section className="settings-section preference-group">
      <h3>模型选择</h3>
      <div className="model-preferences">
        <div className="service-list">
          <details name="model-services">
            <summary><strong>Claude</strong><span>订阅</span><span className="service-state">Claude Code</span></summary>
            <div className="service-content settings-grid">
              <LabeledField label="默认模型" placeholder="例如 sonnet" value={s.claude.model} onCommit={model => save({ claude: { model } })} />
              <LabeledField label="Claude Code 路径" placeholder="自动查找" value={s.claude.path} onCommit={path => save({ claude: { path } })} />
              <LabeledField label="兼容接口地址" placeholder="可选" value={s.claude.baseUrl} onCommit={baseUrl => save({ claude: { baseUrl } })} />
              <SecretField label="接口 Token" isSet={s.claude.hasAuthToken} onCommit={authToken => save({ claude: { authToken } })} />
            </div>
          </details>
          <details name="model-services">
            <summary><strong>ChatGPT</strong><span>订阅</span><span className={`service-state${codexModels.length ? ' service-found' : ''}`}>{codexModels.length ? '已发现本机 Codex' : '使用本机 Codex'}</span></summary>
            <p className="service-content settings-hint">未登录时在终端运行 <code>codex login</code></p>
          </details>
          <details name="model-services">
            <summary><strong>DeepSeek</strong><span>API</span><span className="service-state">{s.deepseek.hasKey ? '已保存 Key' : '配置 Key'}</span></summary>
            <div className="service-content">
              <SecretField label="DeepSeek API Key" isSet={s.deepseek.hasKey} onCommit={key => save({ deepseek: { key } })} />
            </div>
          </details>
          <details name="model-services">
            <summary><strong>OpenAI 兼容</strong><span>API</span><span className="service-state">{s.openai.hasApiKey ? '已保存 Key' : '配置接口'}</span></summary>
            <div className="service-content settings-grid">
              <LabeledField label="Base URL" value={s.openai.baseUrl} onCommit={baseUrl => save({ openai: { baseUrl } })} />
              <LabeledField label="默认模型" value={s.openai.model} onCommit={model => save({ openai: { model } })} />
              <SecretField label="API Key" isSet={s.openai.hasApiKey} onCommit={apiKey => save({ openai: { apiKey } })} />
            </div>
          </details>
        </div>
        {(Object.keys(PURPOSES) as AiPurpose[]).map(purpose => {
          const choice = s.purposes[purpose]
          const update = (patch: Partial<typeof choice>) => save({ purposes: { [purpose]: { ...choice, ...patch } } })
          const labelFor = (provider: AiProviderId, model: string) =>
            provider === 'codex-cli' ? codexModels.find(entry => entry.id === model)?.label ?? model : model
          const title = labelFor(choice.provider, choice.model) || PROVIDERS[choice.provider] + ' · 默认'
          const efforts = choice.provider === 'codex-cli'
            ? codexModels.find(model => model.id === choice.model)?.efforts ?? ['low', 'medium', 'high']
            : choice.provider === 'deepseek' ? ['low', 'high', 'max'] : ['low', 'medium', 'high']
          const providers = [choice.provider, ...(Object.keys(PROVIDERS) as AiProviderId[]).filter(provider => provider !== choice.provider)]
          return (
            <div className="preference-line model-purpose" key={purpose}>
              <span>{PURPOSES[purpose]}</span>
              <Popup label={PURPOSES[purpose] + '模型'} value={<>{title}{choice.effort && <small> · {choice.effort}</small>}</>}>
                {() => <>
                  <div className="popup-options model-options">
                    {providers.map(provider => (
                      <section className="popup-group" key={provider}>
                        <h4>{PROVIDERS[provider]}</h4>
                        {[...new Set([...models[provider], '', ...(provider === choice.provider ? [choice.model] : [])])].map(model =>
                          <PopupOption key={model} label={labelFor(provider, model) || '默认模型'}
                            selected={provider === choice.provider && model === choice.model}
                            onClick={() => {
                              if (provider === choice.provider && model === choice.model) return
                              const nextEfforts = codexModels.find(entry => entry.id === model)?.efforts
                              const preserveEffort = provider === choice.provider && (!nextEfforts || nextEfforts.includes(choice.effort ?? ''))
                              update({ provider, model, effort: preserveEffort ? choice.effort : '' })
                            }} />)}
                      </section>
                    ))}
                  </div>
                  {choice.provider !== 'openai-compatible' && efforts.length > 0 && <div className="popup-effort">
                    <span>推理强度</span>
                    <div className="segmented" role="group" aria-label="推理强度">
                      {['', ...new Set([...efforts, ...(choice.effort ? [choice.effort] : [])])].map(effort => (
                        <button key={effort} type="button" className={(choice.effort ?? '') === effort ? 'active' : ''}
                          aria-pressed={(choice.effort ?? '') === effort} onClick={() => update({ effort })}>{effort || '默认'}</button>
                      ))}
                    </div>
                  </div>}
                  <div className="popup-footer">
                    <details className="custom-model"><summary>自定义模型</summary>
                      <Field placeholder="模型 ID" value={choice.model && !models[choice.provider].includes(choice.model) ? choice.model : ''} onCommit={model => update({ model })} />
                    </details>
                    <button type="button" className="button button-small" disabled={testing !== null} onClick={() => test(purpose)}>{testing === purpose ? '连接中…' : '检查连接'}</button>
                  </div>
                </>}
              </Popup>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The learner profile per language, injected into every AI call. Plain Markdown in the Library. */
export function ProfileSection() {
  const toast = useToast()
  const [lang, setLang] = useState<Lang>('ja')
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    setText(null)
    api.getProfile(lang).then((t) => {
      setText(t)
      setSaved(t)
    })
  }, [lang])

  async function save() {
    if (text === null) return
    await toast.track(api.saveProfile(lang, text), { pending: '正在保存…', done: '学习档案已保存' }).catch(() => {})
    setSaved(text)
  }

  return (
    <section className="settings-section preference-group">
      <h3>学习档案</h3>
      <div className="profile-preference">
      <div className="segmented">
        {(['ja', 'en'] as Lang[]).map((l) => (
          <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)}>{LANG_LABELS[l]}</button>
        ))}
      </div>
      <textarea className="profile-editor" rows={10} value={text ?? ''} disabled={text === null} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="settings-actions">
        <button className="button button-primary" disabled={text === null || text === saved} onClick={save}>保存</button>
      </div>
      </div>
    </section>
  )
}

function Field({ value, placeholder, onCommit, list }: { list?: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => draft.trim() !== value && onCommit(draft.trim())
  return <input list={list} aria-label={placeholder} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
}

function LabeledField({ label, ...rest }: { label: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <Field {...rest} />
    </label>
  )
}

function SecretField({ label, isSet, onCommit }: { label: string; isSet: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <label className="field">
      <span>{label}{isSet && <small>已保存</small>}</span>
      <div className="secret">
        <input type="password" value={draft} placeholder={isSet ? '••••••••（输入新值替换）' : '粘贴到这里'} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
        {draft && <button className="button button-small" onClick={() => { onCommit(draft.trim()); setDraft('') }}>保存</button>}
        {!draft && isSet && <button className="button button-small button-ghost" onClick={() => onCommit('')}>清除</button>}
      </div>
    </label>
  )
}
