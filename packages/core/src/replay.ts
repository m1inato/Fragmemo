import { DefaultScheduler } from 'ts-fsrs'
import type { Settings } from './settings'
import type { CardState, LogEntry, ReviewEntry } from './types'

export type Scheduler = DefaultScheduler<'FSRS-7'>

export function createScheduler(fsrs: Settings['fsrs']): Promise<Scheduler> {
  return DefaultScheduler({
    desiredRetention: fsrs.desiredRetention,
    maximumInterval: fsrs.maximumInterval,
    enableFuzz: fsrs.enableFuzz
  })
}

/**
 * The reviews that count, in canonical order: duplicates (same id seen from several devices or
 * re-imports) collapse, undone reviews drop out, and ties on time break by id so every device
 * that holds the same set of entries derives the same sequence.
 */
export function effectiveReviews(logs: readonly LogEntry[]): ReviewEntry[] {
  const undone = new Set<string>()
  const reviews = new Map<string, ReviewEntry>()
  for (const e of logs) {
    if (e.type === 'undo') undone.add(e.target)
    else if (!reviews.has(e.id)) reviews.set(e.id, e)
  }
  return [...reviews.values()]
    .filter((r) => !undone.has(r.id))
    .sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Card states derived purely from the logs. Same entries in any order → same result. */
export function replay(logs: readonly LogEntry[], scheduler: Scheduler): Map<string, CardState> {
  const states = new Map<string, CardState>()
  for (const r of effectiveReviews(logs)) applyReview(states, r, scheduler)
  return states
}

export function applyReview(states: Map<string, CardState>, r: ReviewEntry, scheduler: Scheduler): CardState {
  const now = new Date(r.reviewedAt)
  const card = states.get(r.cardId) ?? scheduler.newCard({ now, cardId: r.cardId })
  const next = scheduler.review({ card, now, grade: r.rating }).card
  states.set(r.cardId, next)
  return next
}

export const DAY_MS = 86_400_000
