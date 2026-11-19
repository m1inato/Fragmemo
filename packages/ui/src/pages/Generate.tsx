import type { TaskInput } from '@fragmemo/ai'
import type { Lang } from '@fragmemo/core'
import { useState } from 'react'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'
import type { GeneratePreset } from '../lib/shell'
import { useAsync } from '../lib/useAsync'

type Tab = NonNullable<GeneratePreset['tab']>

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'generate-deck', label: '生成卡组', hint: '描述想学什么，AI 按你的学习档案做卡片。' },
  { id: 'extract-from-text', label: '从文本提取', hint: '粘贴词组或原文，AI 会提取词汇和语法，整理成卡片。' },
  { id: 'process-inbox', label: '整理收藏', hint: '把手机上收藏的词句整理成卡片。' },
  { id: 'leech-helper', label: '攻克难记卡', hint: '找出反复遗忘的卡片，补上更好记的例句和提示。' }
]

export function Generate({ preset, onClose, onCreated }: { preset: GeneratePreset; onClose?: () => void; onCreated: () => void }) {
  const toast = useToast()
  const { data: langs } = useAsync(() => api.overview(), [])
  const [tab, setTab] = useState<Tab>(preset.tab ?? 'generate-deck')
  const [lang, setLang] = useState<Lang>(preset.lang ?? 'ja')
  const [deckId, setDeckId] = useState<string>(preset.deckId ?? '')
  const [deckName, setDeckName] = useState('')
  const [request, setRequest] = useState(preset.request ?? '')
  const [count, setCount] = useState(20)
  const [text, setText] = useState(preset.text ?? '')
  const [busy, setBusy] = useState(false)

  const decks = langs?.find((l) => l.lang === lang)?.decks ?? []
  const deck = deckId ? { id: deckId } : { name: deckName.trim() }
  const needsDeck = tab !== 'leech-helper'
  const deckOk = !needsDeck || !!deckId || !!deckName.trim()
  const ready = deckOk && (tab === 'generate-deck' ? !!request.trim() && count > 0 : tab === 'extract-from-text' ? !!text.trim() : true)

  async function submit() {
    let input: TaskInput
    switch (tab) {
      case 'generate-deck':
        input = { kind: tab, lang, request: request.trim(), count, deck }
        break
      case 'extract-from-text':
        input = { kind: tab, lang, text: text.trim(), deck }
        break
      case 'process-inbox':
        input = { kind: tab, lang, deck }
        break
      case 'leech-helper':
        input = { kind: tab, lang }
        break
    }
    setBusy(true)
    const ok = await toast.track(api.createTask(input), { pending: '正在加入任务队列…', done: '已加入任务队列' }).then(() => true, () => false)
    setBusy(false)
    if (ok) {
      if (onClose) onClose()
      else setText('')
      onCreated()
    }
  }

  const hint = TABS.find((t) => t.id === tab)!.hint
  const fields = (
    <div className="editor-grid">
      {tab === 'extract-from-text' && (
        <label className="field field-wide">
          <span>词组或原文</span>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="一行一个词组，或直接粘贴原文" lang={lang} />
        </label>
      )}
      <div className="field">
        <span>语言</span>
        <div className="segmented">
          {(['ja', 'en'] as Lang[]).map((l) => (
            <button key={l} className={l === lang ? 'active' : ''} onClick={() => { setLang(l); setDeckId('') }}>{LANG_LABELS[l]}</button>
          ))}
        </div>
      </div>
      {needsDeck && (
        <label className="field">
          <span>放进哪个卡组</span>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">新建卡组…</option>
            {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}
      {needsDeck && !deckId && (
        <label className="field field-wide">
          <span>新卡组名称</span>
          <input value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder={lang === 'ja' ? '例如：N3 情绪类形容词' : '例如：雅思高频动词'} />
        </label>
      )}

      {tab === 'generate-deck' && (
        <>
          <label className="field field-wide">
            <span>想学什么</span>
            <textarea rows={3} value={request} onChange={(e) => setRequest(e.target.value)}
              placeholder={lang === 'ja' ? '例如：N3 里描述情绪的形容词，配日常对话例句' : '例如：描述性格的常用形容词，附易混词'} />
          </label>
          <label className="field">
            <span>数量</span>
            <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
          </label>
        </>
      )}
    </div>
  )

  const action = <button className="button button-primary" disabled={!ready || busy} onClick={submit}>{onClose ? '开始' : '提取并制卡'}</button>
  if (!onClose) {
    return (
      <section className="card import-card" aria-label="粘贴词组或原文">
        {fields}
        <div className="import-actions">{action}</div>
      </section>
    )
  }

  return (
    <Modal
      title="AI 生成"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="modal-footnote">所有改动都会先经过代码检查，可以整批撤销。</span>
          <span className="spacer" />
          <button className="button" onClick={onClose}>取消</button>
          {action}
        </>
      }
    >
      <div className="segmented">
        {TABS.filter((t) => t.id !== 'extract-from-text').map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <p className="modal-text">{hint}</p>
      {fields}
    </Modal>
  )
}
