import { nextReview, prepareReview, type AnswerMode, type Rating, type ReviewItem, type ReviewQueue, type ReviewScope } from '@fragmemo/core'
import { commit, library } from './library'

// One review round: answers are logged as they come; the round is committed once at the end
// so history gets one "review: n cards" commit instead of one per card.

const host = { mediaUrl: (deckId: string, file: string) => `fragmemo://media/${encodeURIComponent(deckId)}/${encodeURIComponent(file)}` }
let answered = 0
// Undo also writes to the log, so a round can need a commit even when the net count is zero.
let dirty = false

export const next = (scope: ReviewScope): Promise<ReviewQueue> => nextReview(library(), scope, host)

export const prepare = (cardId: string, mode?: AnswerMode): Promise<ReviewItem> => prepareReview(library(), cardId, host, mode)

export async function answer(cardId: string, a: { rating: Rating; mode: AnswerMode; correct?: boolean; durationMs: number }) {
  await library().review(cardId, a)
  answered++
  dirty = true
}

export async function undo(): Promise<ReviewItem | null> {
  const cardId = await library().undo()
  if (!cardId) return null
  answered = Math.max(0, answered - 1)
  dirty = true
  return prepare(cardId)
}

/** Pin (or with null, unpin) the answer mode for every card of this card's note. */
export async function pinMode(cardId: string, mode: AnswerMode | null) {
  const lib = library()
  const card = await lib.getCard(cardId)
  if (!card) return
  const { mode: _old, ...rest } = card.note
  await lib.upsertNotes(card.deckId, [mode ? { ...rest, mode } : rest])
  dirty = true
}

export async function finish(): Promise<number> {
  const n = answered
  if (dirty) await commit(`review: ${n} cards`)
  answered = 0
  dirty = false
  return n
}
