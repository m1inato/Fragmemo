import type { Lang } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AiProviderId, AiPurpose, AiSettings, AiSettingsPatch } from '../api'
import { errorText, useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'

const PROVIDERS: Record<AiProviderId, string> = { 'claude-cli': 'Claude Code（本机）', 'openai-compatible': 'OpenAI 兼容 API' }
const PURPOSES: Record<AiPurpose, string> = { write: '生成与修改卡片', qa: '问答' }

/** Which model does what. Keys stay on this Mac, encrypted with the system keychain. */
export function AiSection() {
  const toast = useToast()
  const [s, setS] = useState<AiSettings | null>(null)
  const [testing, setTesting] = useState<AiPurpose | null>(null)

  useEffect(() => {
    api.getAiSettings().then(setS)
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
  const uses = (id: AiProviderId) => Object.values(s.purposes).some((p) => p.provider === id)

  return (
    <>
      <section className="settings-section">
        <h3>用途</h3>
        {(Object.keys(PURPOSES) as AiPurpose[]).map((purpose) => (
          <div key={purpose} className="ai-purpose">
            <span className="ai-purpose-label">{PURPOSES[purpose]}</span>
            <select value={s.purposes[purpose].provider} onChange={(e) => save({ purposes: { [purpose]: { ...s.purposes[purpose], provider: e.target.value as AiProviderId } } })}>
              {(Object.keys(PROVIDERS) as AiProviderId[]).map((id) => <option key={id} value={id}>{PROVIDERS[id]}</option>)}
            </select>
            <Field placeholder="默认模型" value={s.purposes[purpose].model} onCommit={(model) => save({ purposes: { [purpose]: { ...s.purposes[purpose], model } } })} />
            <button className="button button-small" disabled={testing !== null} onClick={() => test(purpose)}>{testing === purpose ? '测试中…' : '测试'}</button>
          </div>
        ))}
      </section>

      {uses('claude-cli') && (
        <section className="settings-section">
          <h3>Claude Code</h3>
          <p className="settings-hint">使用本机已登录的 claude 命令行，只开放 Fragmemo 自己的工具，不能读写其他文件。</p>
          <div className="settings-grid">
            <LabeledField label="模型" placeholder="例如 sonnet、haiku" value={s.claude.model} onCommit={(model) => save({ claude: { model } })} />
            <LabeledField label="claude 路径" placeholder="自动查找" value={s.claude.path} onCommit={(path) => save({ claude: { path } })} />
            <LabeledField label="Anthropic 兼容接口（可选）" placeholder="例如 DeepSeek 的地址" value={s.claude.baseUrl} onCommit={(baseUrl) => save({ claude: { baseUrl } })} />
            <SecretField label="接口 Token" isSet={s.claude.hasAuthToken} onCommit={(authToken) => save({ claude: { authToken } })} />
          </div>
        </section>
      )}

      {uses('openai-compatible') && (
        <section className="settings-section">
          <h3>OpenAI 兼容 API</h3>
          <div className="settings-grid">
            <LabeledField label="Base URL" value={s.openai.baseUrl} onCommit={(baseUrl) => save({ openai: { baseUrl } })} />
            <LabeledField label="模型" placeholder="例如 gpt-5-mini、deepseek-chat" value={s.openai.model} onCommit={(model) => save({ openai: { model } })} />
            <SecretField label="API Key" isSet={s.openai.hasApiKey} onCommit={(apiKey) => save({ openai: { apiKey } })} />
          </div>
        </section>
      )}
    </>
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
    <section className="settings-section">
      <p className="settings-hint">AI 每次生成卡片、回答问题都会先读这份档案：母语、水平、目标、偏好，写得越具体越贴合你。</p>
      <div className="segmented">
        {(['ja', 'en'] as Lang[]).map((l) => (
          <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)}>{LANG_LABELS[l]}</button>
        ))}
      </div>
      <textarea className="profile-editor" rows={10} value={text ?? ''} disabled={text === null} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="settings-actions">
        <button className="button button-primary" disabled={text === null || text === saved} onClick={save}>保存</button>
      </div>
    </section>
  )
}

function Field({ value, placeholder, onCommit }: { value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => draft.trim() !== value && onCommit(draft.trim())
  return <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
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
