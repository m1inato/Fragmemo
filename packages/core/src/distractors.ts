import { answerText, normalizeTerm } from './notes'
import type { Lang, Note, WordNote } from './types'
import { levenshtein, shuffle } from './util'

export interface PoolNote { note: Note; deckId: string }

/**
 * Wrong options for a choice question, filled in order of how instructive they are:
 * the note's own confusables, then the closest-looking notes of the same kind, then
 * anything from the same deck.
 */
export function pickDistractors(
  target: { note: Note; face: number; deckId: string; lang: Lang },
  pool: readonly PoolNote[],
  n: number,
  random: () => number = Math.random
): string[] {
  const { note, face, deckId, lang } = target
  const correct = answerText(note, face)
  const picked: string[] = []
  const seen = new Set([norm(correct)])
  const add = (s: string | undefined) => {
    if (picked.length >= n || !s?.trim()) return
    const k = norm(s)
    if (seen.has(k)) return
    seen.add(k)
    picked.push(s)
  }

  const others = pool.filter((p) => p.note.id !== note.id && !p.note.deleted && p.note.type === note.type)

  if (note.type === 'word' && note.fields.confusables?.length) {
    const byTerm = new Map(others.map((p) => [normalizeTerm(lang, (p.note as WordNote).fields.term), p.note]))
    for (const c of note.fields.confusables) {
      const hit = byTerm.get(normalizeTerm(lang, c))
      // Choosing a term: the confusable itself is the option, even if it is not in the Library.
      add(face === 1 ? c : hit && answerText(hit, face))
    }
  }

  const sameKind = others.filter((p) => note.type !== 'word' || !note.fields.pos || (p.note as WordNote).fields.pos === note.fields.pos)
  const shape = (x: Note) => (x.type === 'word' ? x.fields.reading || x.fields.term : answerText(x, 1))
  const ref = shape(note)
  const nearest = sameKind
    .map((p) => ({ p, d: levenshtein(ref, shape(p.note)) / Math.max(ref.length, shape(p.note).length, 1) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n * 3)
  // Take a random handful of the closest so the same three do not show up every time.
  for (const { p } of shuffle(nearest.slice(0, n * 2), random)) add(answerText(p.note, face))
  for (const { p } of nearest) add(answerText(p.note, face))

  for (const p of shuffle(others.filter((p) => p.deckId === deckId), random)) add(answerText(p.note, face))
  return picked
}

function norm(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase()
}
