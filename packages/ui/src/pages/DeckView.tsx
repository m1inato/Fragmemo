import { answerText, noteTitle, stripHtml, type Note, type ReviewScope } from '@fragmemo/core'
import { useMemo, useState } from 'react'
import type { TaskInput } from '@fragmemo/ai'
import { ShellButtons } from '../components/ShellButtons'
import { TitleBar } from '../components/TitleBar'
import { useToast } from '../components/Toast'
import { useShell } from '../lib/shell'
import { api } from '../lib/api'
import { LANG_LABELS, MODE_LABELS, NOTE_TYPE_LABELS } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { NoteEditor } from './NoteEditor'

export function DeckView({ deckId, version, onBack, onReview }: {
  deckId: string
  version: number
  onBack: () => void
  onReview: (scope: ReviewScope, title: string) => void
}) {
  const { data: langs } = useAsync(() => api.overview(), [version])
  const { data: notes } = useAsync(() => api.listNotes(deckId), [deckId, version])
  const toast = useToast()
  const { setPanel } = useShell()
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

  return (
    <div className="page deck-view">
      <TitleBar
        left={<button className="button button-ghost" onClick={onBack}>← 卡组</button>}
        center={<span className="titlebar-title">{deck?.name ?? ''}</span>}
        right={
          <>
            <button className="button button-ghost" onClick={() => setEditing('new')}>添加笔记</button>
            <ShellButtons />
            {deck && (
              <button className="button button-primary button-small" disabled={!deck.due && !deck.fresh} onClick={() => onReview({ lang: deck.lang, deckIds: [deck.id] }, deck.name)}>
                复习
              </button>
            )}
          </>
        }
      />
      <main className="deck-main">
        {deck && (
          <div className="deck-head">
            <div>
              <p className="eyebrow">{LANG_LABELS[deck.lang]} · {sourceLabel(deck.source)} · v{deck.version}</p>
              <h1>{deck.name}</h1>
              <p className="deck-stats">
                {deck.notes} 条笔记 · {deck.cards} 张卡 · 已学 {deck.learned} · 待复习 {deck.due} · 今日新卡 {deck.fresh}
              </p>
            </div>
            <div className="deck-tools">
              {rawCount > 0 && (
                <button className="button button-small" onClick={() => runTask({ kind: 'convert-raw', lang: deck.lang, deckId }, `把 ${rawCount} 条 Anki 卡片转成标准笔记`)}>
                  AI 转为标准卡片
                </button>
              )}
              {thin.length > 0 && (
                <button className="button button-small" onClick={() => runTask({ kind: 'enrich-notes', lang: deck.lang, deckId, noteIds: thin, fields: ['reading', 'examples', 'confusables'] }, `为 ${thin.length} 条单词补读音、例句和易混词`)}>
                  AI 补全 {thin.length} 条
                </button>
              )}
              <input className="search" type="search" placeholder="搜索词、释义或标签" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        )}
        {notes && !notes.length && <p className="muted deck-empty">还没有笔记，点右上角「添加笔记」。</p>}
        {!!rows.length && (
          <table className="notes">
            <thead>
              <tr>
                <th>内容</th>
                <th>释义</th>
                <th>类型</th>
                <th>标签</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ note, title, detail }) => (
                <tr key={note.id} onClick={() => setEditing(note)}>
                  <td className="notes-title">{title}</td>
                  <td className="notes-detail">{detail}</td>
                  <td>
                    <span className="chip chip-quiet">{NOTE_TYPE_LABELS[note.type]}</span>
                    {note.mode && <span className="chip chip-quiet">{MODE_LABELS[note.mode]}</span>}
                  </td>
                  <td className="notes-tags">{note.tags.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
      {editing && deck && (
        <NoteEditor deck={deck} note={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function detail(n: Note): string {
  if (n.type === 'raw') return stripHtml(Object.values(n.fields)[1] ?? '')
  return answerText(n, 0)
}

function sourceLabel(s: string): string {
  return ({ ai: 'AI 生成', repo: '卡包仓库', apkg: 'Anki 导入', manual: '手动' } as Record<string, string>)[s] ?? s
}
