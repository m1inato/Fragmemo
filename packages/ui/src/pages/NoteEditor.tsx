import type { DeckMeta, Example, Note } from '@fragmemo/core'
import { useState } from 'react'
import type { NoteDraft } from '../api'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { NOTE_TYPE_LABELS } from '../lib/format'

type Kind = NoteDraft['type']
type Form = Record<string, string>

const FIELDS: Record<Kind, { key: string; label: string; required?: boolean; multiline?: boolean; hint?: string }[]> = {
  word: [
    { key: 'term', label: '词（原形）', required: true },
    { key: 'reading', label: '读音' },
    { key: 'meaning', label: '释义', required: true },
    { key: 'pos', label: '词性' },
    { key: 'examples', label: '例句', multiline: true, hint: '一行一句：原文 | 译文' },
    { key: 'notes', label: '备注', multiline: true },
    { key: 'confusables', label: '易混词', hint: '用逗号分隔' }
  ],
  sentence: [
    { key: 'text', label: '句子', required: true, multiline: true },
    { key: 'reading', label: '读音' },
    { key: 'translation', label: '翻译', required: true, multiline: true },
    { key: 'grammar', label: '相关语法', hint: '用逗号分隔' }
  ],
  grammar: [
    { key: 'pattern', label: '句型', required: true },
    { key: 'meaning', label: '意思', required: true },
    { key: 'connection', label: '接续' },
    { key: 'nuance', label: '语感', multiline: true },
    { key: 'examples', label: '例句', multiline: true, hint: '一行一句：原文 | 译文' }
  ]
}

export function NoteEditor({ deck, note, onClose }: { deck: DeckMeta; note: Note | null; onClose: () => void }) {
  if (note?.type === 'raw') return <RawNoteView deck={deck} note={note} onClose={onClose} />
  return <StandardEditor deck={deck} note={note} onClose={onClose} />
}

function StandardEditor({ deck, note, onClose }: { deck: DeckMeta; note: Exclude<Note, { type: 'raw' }> | null; onClose: () => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<Kind>(note?.type ?? 'word')
  const [form, setForm] = useState<Form>(() => (note ? toForm(note) : {}))
  const [tags, setTags] = useState(note?.tags.join(' ') ?? '')
  const missing = FIELDS[kind].filter((f) => f.required && !form[f.key]?.trim())

  async function save() {
    const draft = { ...toDraft(kind, form), id: note?.id, tags: tags.split(/\s+/).filter(Boolean), ...(note?.mode ? { mode: note.mode } : {}) } as NoteDraft
    const ok = await toast.track(api.saveNote(deck.id, draft), { pending: '正在保存…', done: '已保存' }).then(() => true, () => false)
    if (ok) onClose()
  }

  async function remove() {
    if (!note) return
    await toast.track(api.deleteNote(deck.id, note.id), { pending: '正在删除…', done: '已删除，可在 git 历史中找回' }).catch(() => {})
    onClose()
  }

  return (
    <Modal
      title={note ? '编辑笔记' : '添加笔记'}
      onClose={onClose}
      wide
      footer={
        <>
          {note && <button className="button button-danger" onClick={remove}>删除</button>}
          <span className="spacer" />
          <button className="button" onClick={onClose}>取消</button>
          <button className="button button-primary" disabled={missing.length > 0} onClick={save}>保存</button>
        </>
      }
    >
      {!note && (
        <div className="segmented editor-kind">
          {(Object.keys(FIELDS) as Kind[]).map((k) => (
            <button key={k} className={k === kind ? 'active' : ''} onClick={() => setKind(k)}>{NOTE_TYPE_LABELS[k]}</button>
          ))}
        </div>
      )}
      <div className="editor-grid" lang={deck.lang}>
        {FIELDS[kind].map((f) => (
          <label key={f.key} className={`field${f.multiline ? ' field-wide' : ''}`}>
            <span>{f.label}{f.required && <em>*</em>}{f.hint && <small>{f.hint}</small>}</span>
            {f.multiline ? (
              <textarea rows={3} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </label>
        ))}
        <label className="field field-wide">
          <span>标签<small>用空格分隔</small></span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
      </div>
    </Modal>
  )
}

function RawNoteView({ deck, note, onClose }: { deck: DeckMeta; note: Extract<Note, { type: 'raw' }>; onClose: () => void }) {
  const toast = useToast()
  async function remove() {
    await toast.track(api.deleteNote(deck.id, note.id), { pending: '正在删除…', done: '已删除，可在 git 历史中找回' }).catch(() => {})
    onClose()
  }
  return (
    <Modal
      title="Anki 笔记"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="button button-danger" onClick={remove}>删除</button>
          <span className="spacer" />
          <button className="button" onClick={onClose}>关闭</button>
        </>
      }
    >
      <p className="modal-text">模板：{note.template}</p>
      <dl className="raw-fields">
        {Object.entries(note.fields).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

const list = (s: string | undefined) => (s ?? '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean)
const opt = (s: string | undefined) => (s?.trim() ? s.trim() : undefined)

function parseExamples(s: string | undefined): Example[] | undefined {
  const items = (s ?? '')
    .split('\n')
    .map((line) => line.split(/\s*[|｜]\s*/))
    .filter(([text]) => text?.trim())
    .map(([text, translation]) => ({ text: text.trim(), translation: (translation ?? '').trim() }))
  return items.length ? items : undefined
}

function toDraft(kind: Kind, f: Form): Pick<NoteDraft, 'type' | 'fields'> {
  const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as T
  switch (kind) {
    case 'word':
      return {
        type: 'word',
        fields: clean({
          term: f.term?.trim() ?? '', meaning: f.meaning?.trim() ?? '', reading: opt(f.reading), pos: opt(f.pos),
          examples: parseExamples(f.examples), notes: opt(f.notes), confusables: list(f.confusables)
        })
      }
    case 'sentence':
      return {
        type: 'sentence',
        fields: clean({ text: f.text?.trim() ?? '', translation: f.translation?.trim() ?? '', reading: opt(f.reading), grammar: list(f.grammar) })
      }
    case 'grammar':
      return {
        type: 'grammar',
        fields: clean({
          pattern: f.pattern?.trim() ?? '', meaning: f.meaning?.trim() ?? '', connection: opt(f.connection),
          nuance: opt(f.nuance), examples: parseExamples(f.examples)
        })
      }
  }
}

function toForm(note: Exclude<Note, { type: 'raw' }>): Form {
  const out: Form = {}
  for (const [k, v] of Object.entries(note.fields)) {
    if (k === 'examples') out[k] = (v as Example[]).map((e) => `${e.text} | ${e.translation}`).join('\n')
    else if (Array.isArray(v)) out[k] = v.join('，')
    else if (typeof v === 'string') out[k] = v
  }
  return out
}
