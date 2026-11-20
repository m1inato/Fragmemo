import { clozeOrdinals, renderTemplate } from './anki/template'
import type { GrammarNote, Lang, Note, NoteType, RawNote, RawTemplate, SentenceNote, WordNote } from './types'

export function cardIdOf(noteId: string, face: number): string {
  return `${noteId}:${face}`
}

export function parseCardId(cardId: string): { noteId: string; face: number } {
  const i = cardId.lastIndexOf(':')
  return { noteId: cardId.slice(0, i), face: Number(cardId.slice(i + 1)) }
}

export type NoteKeyInput =
  | Pick<WordNote, 'type' | 'fields'>
  | Pick<SentenceNote, 'type' | 'fields'>
  | Pick<GrammarNote, 'type' | 'fields'>
  | { type: 'raw'; guid: string }

/** Dedupe key: language + dictionary form. Sentences and grammar get their own namespaces. */
export function noteKey(lang: Lang, note: NoteKeyInput): string {
  switch (note.type) {
    case 'word':
      return `${lang}:${normalizeTerm(lang, note.fields.term)}`
    case 'sentence':
      return `${lang}:sentence:${normalizeTerm(lang, note.fields.text)}`
    case 'grammar':
      return `${lang}:grammar:${normalizeTerm(lang, note.fields.pattern)}`
    case 'raw':
      return `raw:${note.guid}`
  }
}

export function normalizeTerm(lang: Lang, s: string): string {
  const t = s.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return lang === 'en' ? t.toLowerCase() : t
}

export const FACE_LABELS: Record<Exclude<NoteType, 'raw'>, [string, string]> = {
  word: ['词 → 义', '义 → 词'],
  sentence: ['句 → 义', '音 → 句'],
  grammar: ['语法 → 用法', '例句填空']
}

/**
 * Card faces a note produces. Standard types have fixed faces (grammar fill-in needs an example);
 * raw notes follow Anki: one card per template whose front is non-empty, or one per cloze number.
 */
export function cardFaces(note: Note, tpl?: RawTemplate): number[] {
  switch (note.type) {
    case 'word':
    case 'sentence':
      return [0, 1]
    case 'grammar':
      return note.fields.examples?.some((e) => e.text.includes(note.fields.pattern.replace(/[〜~～]/g, ''))) ? [0, 1] : [0]
    case 'raw':
      return tpl ? rawFaces(note, tpl) : [0]
  }
}

function rawFaces(note: RawNote, tpl: RawTemplate): number[] {
  if (tpl.kind === 'cloze') return clozeOrdinals(tpl.cards[0]?.front ?? '', note.fields)
  const empty = Object.fromEntries(Object.keys(note.fields).map((k) => [k, '']))
  const faces: number[] = []
  tpl.cards.forEach((c, i) => {
    const ctx = { fields: note.fields, tags: note.tags, card: c.name, ord: i }
    const filled = renderTemplate(c.front, ctx)
    if (filled.trim() && filled !== renderTemplate(c.front, { ...ctx, fields: empty })) faces.push(i)
  })
  return faces
}

/** The side a learner has to produce for this card, used for choices and spelling. */
export function answerText(note: Note, face: number): string {
  switch (note.type) {
    case 'word':
      return face === 0 ? note.fields.meaning : note.fields.term
    case 'sentence':
      return face === 0 ? note.fields.translation : note.fields.text
    case 'grammar':
      return face === 0 ? note.fields.meaning : note.fields.pattern
    case 'raw':
      return ''
  }
}

/** Text to read aloud for listening practice. */
export function speechText(note: Note): string {
  switch (note.type) {
    case 'word':
      return note.fields.term
    case 'sentence':
      return note.fields.text
    case 'grammar':
      return note.fields.examples?.[0]?.text ?? note.fields.pattern
    case 'raw':
      return ''
  }
}

/** `display` names an Anki note type's headword and gloss fields; see rawDisplay. */
export function noteTitle(note: Note, display?: RawDisplay): string {
  switch (note.type) {
    case 'word':
      return note.fields.term
    case 'sentence':
      return note.fields.text
    case 'grammar':
      return note.fields.pattern
    case 'raw':
      return firstText(note, display?.title ?? Object.keys(note.fields))
  }
}

/** The one-line gloss shown under a note's title in lists. */
export function noteDetail(note: Note, display?: RawDisplay): string {
  return note.type === 'raw' ? firstText(note, display?.detail ?? Object.keys(note.fields).slice(1)) : answerText(note, 0)
}

function firstText(note: RawNote, fields: string[]): string {
  for (const f of fields) {
    const text = stripHtml(note.fields[f] ?? '')
    if (text) return text
  }
  return ''
}

/** Candidate fields, best first, for a raw note's headword and gloss. */
export interface RawDisplay { title: string[]; detail: string[] }

// Anki decks name their fields freely and their sort field is often a list or an id, so the
// headword is inferred: a short, mostly unique field shown on the front of the first card.
// The gloss is the first such field that only the back shows.
export function rawDisplay(tpl: RawTemplate | undefined, notes: RawNote[]): RawDisplay {
  const sample = notes.slice(0, 300)
  const names = Object.keys(sample[0]?.fields ?? {})
  const stats = new Map(names.map((f) => {
    const texts = sample.map((n) => stripHtml(n.fields[f] ?? '')).filter(Boolean)
    return [f, {
      filled: texts.length / Math.max(1, sample.length),
      distinct: new Set(texts).size / Math.max(1, texts.length),
      length: texts.reduce((n, t) => n + t.length, 0) / Math.max(1, texts.length),
      numeric: texts.filter((t) => /^[\d\s.:-]+$/.test(t)).length / Math.max(1, texts.length)
    }]
  }))
  const usable = (f: string, minDistinct: number) => {
    const s = stats.get(f)
    return !!s && s.filled >= 0.5 && s.distinct >= minDistinct && s.numeric < 0.5
  }
  const card = tpl?.cards[0]
  const front = card ? fieldRefs(card.front).filter((f) => stats.has(f)) : []
  const back = card ? fieldRefs(card.back).filter((f) => stats.has(f) && !front.includes(f)) : []
  const short = (f: string) => usable(f, 0.6) && stats.get(f)!.length <= 40
  const title = [...front.filter(short), ...names.filter(short)]
  const detail = [...back, ...names].filter((f) => f !== title[0] && usable(f, 0.3))
  return { title: unique(title.length ? title : names), detail: unique(detail) }
}

/** Field names a template prints, in order; section tags and special fields are skipped. */
function fieldRefs(html: string): string[] {
  const special = new Set(['FrontSide', 'Tags', 'Deck', 'Subdeck', 'Card', 'CardFlag', 'Type'])
  const out: string[] = []
  for (const [, inner] of html.matchAll(/\{\{([^#^/!{}][^{}]*)\}\}/g)) {
    const name = inner.split(':').pop()!.trim()
    if (name && !special.has(name)) out.push(name)
  }
  return out
}

const unique = (xs: string[]) => [...new Set(xs)]

export function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[sound:[^\]]+\]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
