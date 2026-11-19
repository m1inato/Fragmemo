import type { TaskInput } from '@fragmemo/ai'
import { answerText, noteTitle, stripHtml, type Note } from '@fragmemo/core'
import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS, MODE_LABELS, NOTE_TYPE_LABELS, SOURCE_LABELS, langHue } from '../lib/format'
import { useShell } from '../lib/shell'
import { useAsync } from '../lib/useAsync'
import { NoteEditor } from './NoteEditor'

export function DeckView({ deckId }: { deckId: string }) {
  const { langs, version, go, setPanel } = useShell()
  const { data: notes } = useAsync(() => api.listNotes(deckId), [deckId, version])
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Note | 'new' | null>(null)
  const deck = langs?.flatMap((l) => l.decks).find((d) => d.id === deckId)
  const rawCount = (notes ?? []).filter((n) => n.type === 'raw').length
  // Words missing a reading (Japanese) or any example are worth a pass.
  const thin = (notes ?? [])
    .filter((n) => n.type === 'word' && (!n.fields.examples?.length || (deck?.lang === 'ja' && !n.fields.reading)))
    .map((n) => n.id)

  async function runTask(input: TaskInput, what: string) {
    if (!window.confirm(`${what}？\n改动会先经过检查，之后可以整批撤销。`)) return
    await toast.track(api.createTask(input), { pending: '正在加入任务队列…', done: '已加入任务队列' }).catch(() => {})
    setPanel('tasks')
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (notes ?? [])
      .map((n) => ({ note: n, title: noteTitle(n), detail: detail(n) }))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q) || r.note.tags.some((t) => t.toLowerCase().includes(q)))
  }, [notes, query])

  const left = deck ? deck.due + deck.fresh : 0

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-inner">
          {deck && (
            <section className="hero">
              <div className="hero-tags">
                <span className="chip tint" style={{ '--h': langHue(deck.lang) } as React.CSSProperties}>{LANG_LABELS[deck.lang]}</span>
                <span className="chip">{SOURCE_LABELS[deck.source]}</span>
              </div>
              <h1>{deck.name}</h1>
              <p className="stats">
                <span><b>{deck.notes}</b> 条笔记</span>
                <span><b>{deck.cards}</b> 张卡</span>
                <span>已学 <b>{deck.learned}</b></span>
                <span>待复习 <b>{deck.due}</b></span>
                <span>今日新卡 <b>{deck.fresh}</b></span>
              </p>
              <div className="hero-actions">
                <button className="button button-primary" disabled={!left} onClick={() => go({ name: 'review', scope: { lang: deck.lang, deckIds: [deck.id] }, title: deck.name })}>
                  <Icon name="play" size={14} />
                  {left ? `复习 ${left} 张` : '今天已完成'}
                </button>
                <button className="button" onClick={() => setEditing('new')}>
                  <Icon name="plus" />
                  添加笔记
                </button>
                {thin.length > 0 && (
                  <button className="button" onClick={() => runTask({ kind: 'enrich-notes', lang: deck.lang, deckId, noteIds: thin, fields: ['reading', 'examples', 'confusables'] }, `为 ${thin.length} 条单词补读音、例句和易混词`)}>
                    <Icon name="sparkles" />
                    AI 补全 {thin.length} 条
                  </button>
                )}
                {rawCount > 0 && (
                  <button className="button" onClick={() => runTask({ kind: 'convert-raw', lang: deck.lang, deckId }, `把 ${rawCount} 条 Anki 卡片转成标准笔记`)}>
                    <Icon name="sparkles" />
                    AI 转为标准卡片
                  </button>
                )}
              </div>
            </section>
          )}

          <div className="tools">
            <span className="faint">{query ? `${rows.length} / ${notes?.length ?? 0} 条` : `${notes?.length ?? 0} 条笔记`}</span>
            <span className="spacer" />
            <input className="tools-search" type="search" placeholder="搜索词、释义或标签…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          {notes && !notes.length && <p className="empty faint">还没有笔记。添加一条，或者让 AI 补一些进来。</p>}
          {rows.length > 0 && (
            <div className="card note-list">
              {rows.map(({ note, title, detail }) => (
                <div key={note.id} className="note-row" onClick={() => setEditing(note)} lang={deck?.lang}>
                  <div className="note-main">
                    <p className="note-title">{title}</p>
                    <p className="note-detail muted">{detail}</p>
                  </div>
                  <div className="note-tags">
                    {note.mode && <span className="chip">{MODE_LABELS[note.mode]}</span>}
                    <span className="chip">{NOTE_TYPE_LABELS[note.type]}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {editing && deck && <NoteEditor deck={deck} note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function detail(n: Note): string {
  if (n.type === 'raw') return stripHtml(n.fields.VocabDefSC || n.fields.VocabDefTC || n.fields.definition || Object.values(n.fields)[1] || '')
  return answerText(n, 0)
}
