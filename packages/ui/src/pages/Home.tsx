import type { Lang, LangSummary, ReviewScope } from '@fragmemo/core'
import { useState } from 'react'
import { Modal } from '../components/Modal'
import { TitleBar } from '../components/TitleBar'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'
import { useAsync } from '../lib/useAsync'

export function Home({ version, onOpenDeck, onReview, onSettings }: {
  version: number
  onOpenDeck: (deckId: string) => void
  onReview: (scope: ReviewScope, title: string) => void
  onSettings: () => void
}) {
  const { data: langs } = useAsync(() => api.overview(), [version])
  const [dialog, setDialog] = useState<'import' | 'create' | null>(null)

  return (
    <div className="page home">
      <TitleBar
        center={<span className="titlebar-title">Fragmemo</span>}
        right={
          <>
            <button className="button button-ghost" onClick={() => setDialog('create')}>新建卡组</button>
            <button className="button button-ghost" onClick={() => setDialog('import')}>导入 Anki 卡包</button>
            <button className="icon-button" onClick={onSettings} aria-label="设置" title="设置 (⌘,)">⚙</button>
          </>
        }
      />
      <main className="home-main">
        {langs && !langs.length && <EmptyLibrary onImport={() => setDialog('import')} onCreate={() => setDialog('create')} />}
        {langs?.map((l) => <LangSection key={l.lang} summary={l} onOpenDeck={onOpenDeck} onReview={onReview} />)}
      </main>
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} onImported={onOpenDeck} />}
      {dialog === 'create' && <CreateDeckDialog onClose={() => setDialog(null)} onCreated={onOpenDeck} />}
    </div>
  )
}

function LangSection({ summary, onOpenDeck, onReview }: {
  summary: LangSummary
  onOpenDeck: (deckId: string) => void
  onReview: (scope: ReviewScope, title: string) => void
}) {
  const { lang, decks, due, fresh, learned, cards } = summary
  return (
    <section className="lang-section">
      <div className="today">
        <div>
          <p className="eyebrow">{LANG_LABELS[lang]}</p>
          <h1 className="today-title">{due + fresh ? `今天还有 ${due + fresh} 张` : '今天的已经复习完了'}</h1>
          <p className="today-sub">
            待复习 {due} · 新卡 {fresh} · 已学 {learned} / {cards}
          </p>
        </div>
        <button className="button button-primary button-large" disabled={!due && !fresh} onClick={() => onReview({ lang }, LANG_LABELS[lang])}>
          开始复习
        </button>
      </div>
      <div className="deck-grid">
        {decks.map((d) => (
          <article key={d.id} className="deck-card" onClick={() => onOpenDeck(d.id)}>
            <h3>{d.name}</h3>
            <p className="deck-card-meta">{d.notes} 条笔记 · {d.cards} 张卡</p>
            <div className="deck-card-foot">
              <span className="deck-progress" aria-label={`已学 ${d.learned} / ${d.cards}`}>
                <span style={{ width: `${d.cards ? (d.learned / d.cards) * 100 : 0}%` }} />
              </span>
              <span className={`deck-due${d.due + d.fresh ? '' : ' deck-due-done'}`}>
                {d.due + d.fresh ? `${d.due} · ${d.fresh} 新` : '已完成'}
              </span>
              <button
                className="button button-small"
                disabled={!d.due && !d.fresh}
                onClick={(e) => {
                  e.stopPropagation()
                  onReview({ lang, deckIds: [d.id] }, d.name)
                }}
              >
                复习
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function EmptyLibrary({ onImport, onCreate }: { onImport: () => void; onCreate: () => void }) {
  return (
    <div className="empty">
      <h1>Library 还是空的</h1>
      <p>导入一个 Anki 卡包，或者新建一个卡组开始。</p>
      <div className="empty-actions">
        <button className="button button-primary" onClick={onImport}>导入 Anki 卡包</button>
        <button className="button" onClick={onCreate}>新建卡组</button>
      </div>
    </div>
  )
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (deckId: string) => void }) {
  const toast = useToast()
  const [withHistory, setWithHistory] = useState(true)
  async function run() {
    const res = await toast
      .track(api.importApkg({ withHistory }), {
        pending: '正在导入…',
        done: (r) => (r ? `导入完成：新增 ${r.added} 条，更新 ${r.updated} 条` : null)
      })
      .catch(() => null)
    if (res) {
      onClose()
      onImported(res.deck.id)
    }
  }
  return (
    <Modal
      title="导入 Anki 卡包"
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>取消</button>
          <button className="button button-primary" onClick={run}>选择 .apkg 文件</button>
        </>
      }
    >
      <p className="modal-text">支持新旧两种 .apkg / .colpkg 格式。卡片按原模板显示，图片和音频一并导入；同一个卡包再导入一次会更新原卡组，不会重复。</p>
      <label className="check">
        <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} />
        同时导入复习记录（卡包需包含学习进度）
      </label>
    </Modal>
  )
}

function CreateDeckDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (deckId: string) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [lang, setLang] = useState<Lang>('ja')
  async function run() {
    const deck = await toast.track(api.createDeck({ name: name.trim(), lang }), { pending: '正在创建…', done: '卡组建好了' }).catch(() => null)
    if (deck) {
      onClose()
      onCreated(deck.id)
    }
  }
  return (
    <Modal
      title="新建卡组"
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>取消</button>
          <button className="button button-primary" disabled={!name.trim()} onClick={run}>创建</button>
        </>
      }
    >
      <label className="field">
        <span>名称</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：N3 情绪类形容词" onKeyDown={(e) => e.key === 'Enter' && name.trim() && run()} />
      </label>
      <div className="field">
        <span>语言</span>
        <div className="segmented">
          {(['ja', 'en'] as Lang[]).map((l) => (
            <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{LANG_LABELS[l]}</button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
