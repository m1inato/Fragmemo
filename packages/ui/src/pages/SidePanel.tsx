import type { Lang } from '@fragmemo/core'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { errorText } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'
import { useShell } from '../lib/shell'

interface Turn { role: 'user' | 'assistant'; text: string; error?: boolean }

let seq = 0
const newConversation = () => `qa-${Date.now().toString(36)}-${++seq}`

/** Q&A with the tutor. Read-only: turning an answer into cards goes through a normal task. */
export function QaPanel() {
  const { go } = useShell()
  const [lang, setLang] = useState<Lang>('ja')
  const [conversation, setConversation] = useState(newConversation)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(
    () => api.onAskDelta((e) => {
      if (e.conversationId !== conversation) return
      setTurns((ts) => {
        const last = ts[ts.length - 1]
        return last?.role === 'assistant' ? [...ts.slice(0, -1), { ...last, text: last.text + e.delta }] : ts
      })
    }),
    [conversation]
  )

  useEffect(() => {
    // Block body on purpose: scrollIntoView now returns a promise, which must not become the cleanup.
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [turns])

  async function send() {
    const q = draft.trim()
    if (!q || busy) return
    setDraft('')
    setBusy(true)
    setTurns((ts) => [...ts, { role: 'user', text: q }, { role: 'assistant', text: '' }])
    try {
      const answer = await api.ask(conversation, lang, q)
      // The stream may have been partial (or absent, for providers that answer in one piece).
      setTurns((ts) => [...ts.slice(0, -1), { role: 'assistant', text: answer || ts[ts.length - 1].text }])
    } catch (err) {
      setTurns((ts) => [...ts.slice(0, -1), { role: 'assistant', text: errorText(err), error: true }])
    } finally {
      setBusy(false)
    }
  }

  function reset(next: Lang = lang) {
    api.forgetConversation(conversation).catch(() => {})
    setConversation(newConversation())
    setTurns([])
    setLang(next)
  }

  return (
    <>
      <div className="qa-bar">
        <div className="segmented segmented-small">
          {(['ja', 'en'] as Lang[]).map((l) => (
            <button key={l} className={l === lang ? 'active' : ''} onClick={() => l !== lang && reset(l)}>{LANG_LABELS[l]}</button>
          ))}
        </div>
        <span className="spacer" />
        {turns.length > 0 && <button className="button button-small button-ghost" onClick={() => reset()}>新对话</button>}
      </div>

      <div className="panel-body qa-body" lang={lang}>
        {!turns.length && (
          <p className="panel-empty muted">例如：「嬉しい」和「楽しい」有什么区别？</p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`qa-turn qa-${t.role}${t.error ? ' qa-error' : ''}`}>
            <div className="qa-text">{t.text ? <Inline text={t.text} /> : busy && i === turns.length - 1 ? '…' : ''}</div>
            {t.role === 'assistant' && t.text && !t.error && !(busy && i === turns.length - 1) && (
              <button className="link qa-add" onClick={() => go({ name: 'import', source: 'text', lang, text: t.text })}>加入卡组</button>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form className="qa-input" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea
          rows={2}
          value={draft}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button type="button" className="icon-button bordered" title="停止" onClick={() => api.stopAsking(conversation)}>
            <Icon name="stop" />
          </button>
        ) : (
          <button type="submit" className="icon-button send" title="发送" disabled={!draft.trim()}>
            <Icon name="send" />
          </button>
        )}
      </form>
    </>
  )
}

/** Models like **bold**; render just that, everything else stays plain text. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part))}</>
}
