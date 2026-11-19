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

export function noteTitle(note: Note): string {
  switch (note.type) {
    case 'word':
      return note.fields.term
    case 'sentence':
      return note.fields.text
    case 'grammar':
      return note.fields.pattern
    case 'raw':
      return stripHtml(note.fields.VocabKanji || note.fields.VocabFurigana || note.fields.word || Object.values(note.fields)[0] || '')
  }
}

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
