import { renderRawCard, type RenderedCard } from './anki/template'
import type { Library } from './library'
import { availableModes } from './modes'
import { answerText, FACE_LABELS, speechText } from './notes'
import type { AnswerMode, Lang, Note, Rating } from './types'
import { shuffle } from './util'

// Turns scheduler output into what a review screen shows. Lives in core so every shell
// (Electron main, the Android WebView) presents cards identically.

export interface ReviewScope { lang: Lang; deckIds?: string[] }

export interface ReviewHost {
  /** URL the UI can load for a media file of a deck. */
  mediaUrl(deckId: string, file: string): string
}

export interface ReviewItem {
  cardId: string
  deckId: string
  deckName: string
  lang: Lang
  face: number
  faceLabel: string
  note: Note
  isNew: boolean
  mode: AnswerMode
  /** Modes the learner may switch to for this card. */
  modes: AnswerMode[]
  /** The side to recall: a meaning, a term, a translation; for raw cards the inferred gloss or headword. */
  answer: string
  /** What a raw card asks while the learner chooses or spells (its own template shows only once revealed). */
  prompt?: string
  /** Spellings that count as right in spell mode. */
  accepted?: string[]
  /** Shuffled options including `answer`, for choice mode. */
  choices?: string[]
  /** What to read aloud when there is no recording. */
  speech?: string
  audioUrl?: string
  raw?: RenderedCard
  /** When the card would next be due (ms) for each rating. */
  intervals: Record<Rating, number>
}

export interface ReviewQueue {
  item: ReviewItem | null
  due: number
  fresh: number
}

const CHOICES = 4

export async function nextReview(lib: Library, scope: ReviewScope, host: ReviewHost): Promise<ReviewQueue> {
  const settings = await lib.settings()
  const today = await lib.today(scope.lang)
  const cards = await lib.dueCards({
    ...scope,
    limit: Math.max(0, settings.review.reviewsPerDay - today.reviewed),
    newLimit: settings.review.newPerDay
  })
  const due = cards.filter((c) => c.state).length
  const first = cards[0]
  return { item: first ? await prepareReview(lib, first.cardId, host) : null, due, fresh: cards.length - due }
}

/** Build the review view of one card, in its scheduled mode or one the learner picked. */
export async function prepareReview(lib: Library, cardId: string, host: ReviewHost, mode?: AnswerMode): Promise<ReviewItem> {
  const card = await lib.getCard(cardId)
  if (!card) throw new Error(`no such card: ${cardId}`)
  const deck = await lib.getDeck(card.deckId)
  if (!deck) throw new Error(`no such deck: ${card.deckId}`)
  const { note, face } = card
  const text = note.type === 'raw' ? await lib.describe(cardId) : null
  // A raw note without a recognisable headword and gloss can only be flipped.
  const modes = note.type === 'raw' && !(text?.title && text.detail) ? (['flip'] as AnswerMode[]) : availableModes(note)
  let chosen = mode && modes.includes(mode) ? mode : await lib.pickMode(cardId)
  if (!modes.includes(chosen)) chosen = 'flip'

  const item: ReviewItem = {
    cardId,
    deckId: deck.id,
    deckName: deck.name,
    lang: deck.lang,
    face,
    faceLabel: note.type === 'raw' ? '' : FACE_LABELS[note.type][face] ?? '',
    note,
    isNew: !card.state,
    mode: chosen,
    modes,
    answer: answerText(note, face),
    intervals: await lib.previewIntervals(cardId)
  }

  if (note.type === 'raw') {
    const tpl = await lib.getTemplate(deck.id, note.template)
    if (tpl) item.raw = renderRawCard(tpl, note, face, { deck: deck.name, mediaUrl: (f) => host.mediaUrl(deck.id, f) })
    if (text && chosen !== 'flip') {
      // Spelling always asks for the headword; a choice follows the card's direction.
      const forward = chosen === 'choice' && face === 0
      item.prompt = forward ? text.title : text.detail
      item.answer = forward ? text.detail : text.title
      item.accepted = [text.title]
    }
  } else {
    const audio = 'audio' in note.fields ? note.fields.audio : undefined
    if (audio) item.audioUrl = host.mediaUrl(deck.id, audio)
    item.speech = speechText(note)
    if (note.type === 'word') item.accepted = [note.fields.term, note.fields.reading ?? '']
  }

  if (chosen === 'choice') {
    const wrong = await lib.distractors(cardId, CHOICES - 1)
    // Two options is a coin toss; without enough material fall back to flipping.
    if (wrong.length >= 2) item.choices = shuffle([item.answer, ...wrong])
    else {
      chosen = item.mode = 'flip'
      item.prompt = undefined
    }
  }
  return item
}
