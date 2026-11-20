import type { Lang } from '@fragmemo/core'
import { useEffect, useState, type ReactNode } from 'react'
import type { AiProviderId, AiPurpose, AiSettings, AiSettingsPatch, AiStatus } from '../api'
import { Popup, PopupOption } from '../components/Popup'
import { ServiceLogo } from '../components/ServiceLogo'
import { errorText, useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'

const PROVIDERS: Record<AiProviderId, string> = { 'codex-cli': 'ChatGPT', 'claude-cli': 'Claude', deepseek: 'DeepSeek', 'openai-compatible': 'OpenAI 兼容' }
const PURPOSES: Record<AiPurpose, string> = { write: '制卡', qa: '问答' }

/** A model that can run here, as the pickers list it. */
interface ModelOption { provider: AiProviderId; model: string; label: string; efforts: string[] }

/** Only models of connected services; a Codex install brings its own catalogue. */
function modelOptions(s: AiSettings, status: AiStatus): ModelOption[] {
  const out: ModelOption[] = status.codex.map((m) => ({ provider: 'codex-cli', model: m.id, label: m.label, efforts: m.efforts }))
  if (status.claude) {
    for (const [model, label] of [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']]) {
      out.push({ provider: 'claude-cli', model, label, efforts: ['low', 'medium', 'high'] })
    }
    if (s.deepseek.hasKey) out.push({ provider: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek Flash', efforts: ['low', 'high', 'max'] })
  }
  if (s.openai.hasApiKey && s.openai.model) out.push({ provider: 'openai-compatible', model: s.openai.model, label: s.openai.model, efforts: [] })
  return out
}

const same = (o: ModelOption, c: { provider: AiProviderId; model: string }) => o.provider === c.provider && (o.model === c.model || !c.model)

/** Which services are connected, and which model does what. Keys stay on this Mac, encrypted with the keychain. */
export function AiSection() {
  const toast = useToast()
  const [s, setS] = useState<AiSettings | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [editing, setEditing] = useState<'deepseek' | 'openai' | null>(null)
  const [testing, setTesting] = useState<AiPurpose | null>(null)

  useEffect(() => {
    api.getAiSettings().then(setS)
    api.aiStatus().then(setStatus)
  }, [])

  async function save(patch: AiSettingsPatch) {
    try {
      setS(await api.saveAiSettings(patch))
    } catch (err) {
      toast.show(errorText(err), 'error')
    }
  }

  const options = s && status ? modelOptions(s, status) : []

  // A saved choice whose service is gone falls back to the first model that can run.
  useEffect(() => {
    if (!s || !status || !options.length) return
    const fix = (Object.keys(PURPOSES) as AiPurpose[]).filter((p) => !options.some((o) => same(o, s.purposes[p])))
    if (fix.length) save({ purposes: Object.fromEntries(fix.map((p) => [p, { provider: options[0].provider, model: options[0].model, effort: '' }])) })
  }, [s, status])

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

  if (!s || !status) return null
  const codex = status.codex.length > 0

  return (
    <section className="settings-section preference-group">
      <h3>模型</h3>
      <div className="ai-settings">
        <div className="services">
          <Service provider="claude-cli" kind="订阅" ok={status.claude} state={status.claude ? '已连接' : '未安装'} />
          <Service provider="codex-cli" kind="订阅" ok={codex} state={codex ? '已连接' : '未连接'}>
            {!codex && <code className="service-cmd">codex login</code>}
          </Service>
          <Service provider="deepseek" kind="API" ok={s.deepseek.hasKey && status.claude} state={!s.deepseek.hasKey ? '' : status.claude ? '已连接' : '需要 Claude Code'}>
            <button className="button button-small" onClick={() => setEditing(editing === 'deepseek' ? null : 'deepseek')}>{s.deepseek.hasKey ? '更换 key' : '填写 key'}</button>
          </Service>
          {editing === 'deepseek' && (
            <div className="service-more">
              <KeyInput placeholder="sk-…" onSave={async (key) => { await save({ deepseek: { key } }); setEditing(null) }} onCancel={() => setEditing(null)} />
            </div>
          )}
          <Service provider="openai-compatible" kind="API" ok={s.openai.hasApiKey && !!s.openai.model} state={s.openai.hasApiKey && s.openai.model ? '已配置' : ''}>
            <button className="button button-small" onClick={() => setEditing(editing === 'openai' ? null : 'openai')}>设置</button>
          </Service>
          {editing === 'openai' && (
            <div className="service-more settings-grid">
              <LabeledField label="Base URL" value={s.openai.baseUrl} onCommit={(baseUrl) => save({ openai: { baseUrl } })} />
              <LabeledField label="模型" value={s.openai.model} onCommit={(model) => save({ openai: { model } })} />
              <SecretField label="API Key" isSet={s.openai.hasApiKey} onCommit={(apiKey) => save({ openai: { apiKey } })} />
            </div>
          )}
        </div>

        {(Object.keys(PURPOSES) as AiPurpose[]).map((purpose) => {
          const choice = s.purposes[purpose]
          const current = options.find((o) => same(o, choice))
          return (
            <div className="model-row" key={purpose}>
              <span className="model-row-label">{PURPOSES[purpose]}</span>
              <ModelPicker
                label={`${PURPOSES[purpose]}模型`}
                options={options}
                current={current}
                effort={choice.effort ?? ''}
                onPick={(o) => save({ purposes: { [purpose]: { provider: o.provider, model: o.model, effort: o.efforts.includes(choice.effort ?? '') ? choice.effort : '' } } })}
                onEffort={(effort) => save({ purposes: { [purpose]: { ...choice, effort } } })}
              />
              <button className="button button-small button-ghost" disabled={!current || testing !== null} onClick={() => test(purpose)}>
                {testing === purpose ? '连接中…' : '检查连接'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Service({ provider, kind, ok, state, children }: { provider: AiProviderId; kind: string; ok: boolean; state: string; children?: ReactNode }) {
  return (
    <div className="service">
      <ServiceLogo provider={provider} />
      <span className="service-name">{PROVIDERS[provider]}</span>
      <span className="service-kind">{kind}</span>
      <span className="spacer" />
      {state && <span className={`pill${ok ? ' ok' : ''}`}><i />{state}</span>}
      {children}
    </div>
  )
}

function ModelPicker({ label, options, current, effort, onPick, onEffort }: {
  label: string
  options: ModelOption[]
  current?: ModelOption
  effort: string
  onPick: (o: ModelOption) => void
  onEffort: (effort: string) => void
}) {
  const groups = [...new Set(options.map((o) => o.provider))]
  const value = !options.length ? (
    <span className="faint">没有可用的模型</span>
  ) : current ? (
    <span className="model-value">
      <ServiceLogo provider={current.provider} />
      {current.label}
      {effort && <small> · {effort}</small>}
    </span>
  ) : (
    <span className="faint">选择模型</span>
  )
  return (
    <Popup label={label} value={value}>
      {(dismiss) => (
        <>
          <div className="popup-options model-options">
            {groups.map((g) => (
              <section className="popup-group" key={g}>
                <h4>{PROVIDERS[g]}</h4>
                {options.filter((o) => o.provider === g).map((o) => (
                  <PopupOption key={o.model} label={o.label} selected={current === o} onClick={() => { onPick(o); if (!o.efforts.length) dismiss() }} />
                ))}
              </section>
            ))}
          </div>
          {current && current.efforts.length > 0 && (
            <div className="popup-effort">
              <span>推理强度</span>
              <div className="segmented" role="group" aria-label="推理强度">
                {['', ...current.efforts].map((e) => (
                  <button key={e} type="button" className={effort === e ? 'active' : ''} aria-pressed={effort === e} onClick={() => onEffort(e)}>{e || '默认'}</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Popup>
  )
}

function KeyInput({ placeholder, onSave, onCancel }: { placeholder: string; onSave: (key: string) => Promise<void>; onCancel: () => void }) {
  const [key, setKey] = useState('')
  const submit = () => key.trim() && onSave(key.trim())
  return (
    <div className="key-input">
      <input type="password" autoFocus spellCheck={false} placeholder={placeholder} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <button className="button button-primary button-small" disabled={!key.trim()} onClick={submit}>保存</button>
      <button className="button button-ghost button-small" onClick={onCancel}>取消</button>
    </div>
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
