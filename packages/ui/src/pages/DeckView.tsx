import type { TaskInput } from '@fragmemo/ai'
import type { Note } from '@fragmemo/core'
import { useMemo, useState } from 'react'
import { DeckCover } from '../components/DeckCard'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { TopActions } from '../components/Topbar'
import { api } from '../lib/api'
import { LANG_LABELS, MODE_LABELS, NOTE_TYPE_LABELS, SOURCE_LABELS } from '../lib/format'
import { useShell } from '../lib/shell'
import { useAsync } from '../lib/useAsync'
import { NoteEditor } from './NoteEditor'

const PAGE = 200

export function DeckView({ deckId }: { deckId: string }) {
  const { langs, version, go, setPanel } = useShell()
  const { data: rows } = useAsync(() => api.listNotes(deckId), [deckId, version])
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [editing, setEditing] = useState<Note | 'new' | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const deck = langs?.flatMap((l) => l.decks).find((d) => d.id === deckId)
  const notes = useMemo(() => (rows ?? []).map((r) => r.note), [rows])
  const rawCount = notes.filter((n) => n.type === 'raw').length
  // Words missing a reading (Japanese) or any example are worth a pass.
  const thin = notes
    .filter((n) => n.type === 'word' && (!n.fields.examples?.length || (deck?.lang === 'ja' && !n.fields.reading)))
    .map((n) => n.id)

  async function runTask(input: TaskInput, what: string) {
    if (!window.confirm(`${what}？`)) return
    await toast.track(api.createTask(input), { pending: '正在加入任务队列…', done: '已加入任务队列' }).catch(() => {})
    setPanel('tasks')
  }

  async function rename() {
    const name = renaming?.trim()
    setRenaming(null)
    if (!name || name === deck?.name) return
    await toast.track(api.renameDeck(deckId, name), { pending: '正在改名…', done: '已改名' }).catch(() => {})
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter((r) => !q || r.title.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q) || r.note.tags.some((t) => t.toLowerCase().includes(q)))
  }, [rows, query])

  const left = deck ? deck.due + deck.fresh : 0
  const pct = deck?.cards ? Math.round((deck.learned / deck.cards) * 100) : 0

  return (
    <div className="page">
      <header className="topbar">
        <nav className="crumbs topbar-side">
          <button onClick={() => go({ name: 'library' })}>全部卡组</button>
          <Icon name="next" size={14} />
          <span className="topbar-title">{deck?.name}</span>
        </nav>
        <span className="spacer" />
        <div className="topbar-side topbar-actions"><TopActions /></div>
      </header>
      <div className="page-scroll">
        <div className="page-inner">
          {deck && (
            <section className="deck-hero">
              <DeckCover deck={deck} large />
              <div className="deck-hero-main">
                <div className="chips">
                  <span className="chip tint" style={{ '--h': deck.lang === 'ja' ? 355 : 215 } as React.CSSProperties}>{LANG_LABELS[deck.lang]}</span>
                  <span className="chip">{SOURCE_LABELS[deck.source]}</span>
                  <span className="mono faint">{deck.createdAt}</span>
                </div>
                {renaming === null ? (
                  <h1 className="deck-title">
                    {deck.name}
                    <button className="icon-button deck-rename" title="改名" onClick={() => setRenaming(deck.name)}><Icon name="edit" size={15} /></button>
                  </h1>
                ) : (
                  <input
                    className="deck-title-input"
                    autoFocus
                    value={renaming}
                    onChange={(e) => setRenaming(e.target.value)}
                    onBlur={rename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                )}
                <div className="deck-numbers">
                  <Num value={deck.notes} label="笔记" />
                  <Num value={deck.cards} label="卡片" />
                  <Num value={deck.due} label="待复习" accent={deck.due > 0} />
                  <Num value={deck.fresh} label="今日新卡" />
                  <div className="deck-learned">
                    <span>已学 {pct}%</span>
                    <span className="progress"><span style={{ width: `${pct}%` }} /></span>
                  </div>
                </div>
                <div className="hero-actions">
                  <button className="button button-primary button-large" disabled={!left} onClick={() => go({ name: 'review', scope: { lang: deck.lang, deckIds: [deck.id] }, title: deck.name })}>
                    <Icon name="play" size={14} />
                    {left ? `开始复习 · ${left}` : '今天已完成'}
                  </button>
                  <button className="button button-large" onClick={() => setEditing('new')}>
                    <Icon name="plus" />
                    添加笔记
                  </button>
                  {thin.length > 0 && (
                    <button className="button button-large button-soft" onClick={() => runTask({ kind: 'enrich-notes', lang: deck.lang, deckId, noteIds: thin, fields: ['reading', 'examples', 'confusables'] }, `为 ${thin.length} 条单词补读音、例句和易混词`)}>
                      <Icon name="sparkles" />
                      AI 补全 {thin.length} 条
                    </button>
                  )}
                  {rawCount > 0 && (
                    <button className="button button-large button-soft" onClick={() => runTask({ kind: 'convert-raw', lang: deck.lang, deckId }, `把 ${rawCount} 条 Anki 卡片转成标准笔记`)}>
                      <Icon name="sparkles" />
                      AI 转为标准卡片
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          <div className="tools">
            <h2 className="section-title">笔记</h2>
            <span className="faint num">{query ? `${filtered.length} / ${notes.length}` : notes.length.toLocaleString()}</span>
            <span className="spacer" />
            <label className="search tools-search">
              <Icon name="search" size={14} />
              <input type="search" placeholder="搜索词、释义或标签…" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }} />
            </label>
          </div>

          {rows && !rows.length && <div className="card empty">还没有笔记</div>}
          {filtered.length > 0 && (
            <div className="card note-list">
              {filtered.slice(0, shown).map(({ note, title, detail }) => (
                <div key={note.id} className="note-row" onClick={() => setEditing(note)}>
                  <p className="note-title" lang={deck?.lang}>{title || <span className="faint">（空）</span>}</p>
                  <p className="note-detail">{detail}</p>
                  <div className="note-tags">
                    {note.mode && <span className="chip">{MODE_LABELS[note.mode]}</span>}
                    <span className="chip">{NOTE_TYPE_LABELS[note.type]}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {filtered.length > shown && (
            <div className="more">
              <button className="button" onClick={() => setShown((n) => n + PAGE * 5)}>再显示 {Math.min(PAGE * 5, filtered.length - shown)} 条</button>
              <span className="faint">还有 {(filtered.length - shown).toLocaleString()} 条</span>
            </div>
          )}
        </div>
      </div>
      {editing && deck && <NoteEditor deck={deck} note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Num({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={`deck-num${accent ? ' accent' : ''}`}>
      <b>{value.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  )
}
