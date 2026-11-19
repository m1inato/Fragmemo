import type { DefaultSchedulerCard } from 'ts-fsrs'

export type Lang = 'ja' | 'en'
export type NoteType = 'word' | 'sentence' | 'grammar' | 'raw'
export type AnswerMode = 'flip' | 'choice' | 'listen' | 'spell'
export type Rating = 1 | 2 | 3 | 4

export interface Example { text: string; translation: string; reading?: string }
export interface WordFields {
  term: string; meaning: string
  reading?: string; pos?: string; examples?: Example[]; notes?: string; audio?: string; confusables?: string[]
}
export interface SentenceFields { text: string; translation: string; reading?: string; grammar?: string[]; audio?: string }
export interface GrammarFields { pattern: string; meaning: string; connection?: string; examples?: Example[]; nuance?: string }
export type RawFields = Record<string, string>

interface NoteBase<T extends NoteType, F> {
  id: string; type: T; key: string; fields: F; tags: string[]
  mode?: AnswerMode; updatedAt: number; deleted: boolean
}
export type WordNote = NoteBase<'word', WordFields>
export type SentenceNote = NoteBase<'sentence', SentenceFields>
export type GrammarNote = NoteBase<'grammar', GrammarFields>
export type RawNote = NoteBase<'raw', RawFields> & { template: string }
export type Note = WordNote | SentenceNote | GrammarNote | RawNote

export interface DeckMeta {
  id: string; name: string; lang: Lang; version: number
  tags: string[]; source: 'ai' | 'repo' | 'apkg' | 'manual'; createdAt: string
}

export type ReviewEntry = {
  id: string; type?: 'review'; cardId: string; rating: Rating; reviewedAt: number; durationMs: number
  device: string; mode: AnswerMode; correct?: boolean; imported?: 'anki'
}
export type UndoEntry = { id: string; type: 'undo'; target: string; reviewedAt: number; device: string }
export type LogEntry = ReviewEntry | UndoEntry

export interface InboxItem { id: string; lang: Lang; text: string; context?: string; createdAt: number; device: string }

/** Scheduler memory for one card, as produced by replaying its logs. */
export type CardState = DefaultSchedulerCard

export interface DueCard {
  cardId: string
  deckId: string
  face: number
  note: Note
  /** null for a card that has never been reviewed. */
  state: CardState | null
}

/** A raw (Anki) note type stored under `decks/<deckId>/tpl/<name>/`. */
export interface RawTemplate {
  name: string
  kind: 'standard' | 'cloze'
  css: string
  cards: { name: string; front: string; back: string }[]
}
