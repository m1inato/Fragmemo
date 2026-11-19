import { normalizeTerm } from './notes'
import type { AnswerMode, CardState, Lang, Note } from './types'
import { levenshtein } from './util'

/** Answer modes that make sense for a note type; the first is the safe fallback. */
export function availableModes(note: Note): AnswerMode[] {
  switch (note.type) {
    case 'word':
      return ['flip', 'choice', 'listen', 'spell']
    case 'sentence':
      return ['flip', 'listen']
    case 'grammar':
      return ['flip', 'choice']
    case 'raw':
      return ['flip']
  }
}

/**
 * Harder recall as memory gets stronger: recognition while a card is fragile, production once it
 * is stable. A note's pinned `mode` wins when that mode applies to its type.
 */
export function pickMode(note: Note, state: CardState | null, thresholds: readonly [number, number, number]): AnswerMode {
  const modes = availableModes(note)
  if (note.mode && modes.includes(note.mode)) return note.mode
  const s = state?.stability ?? 0
  const wanted: AnswerMode = s < thresholds[0] ? 'choice' : s < thresholds[1] ? 'listen' : s < thresholds[2] ? 'flip' : 'spell'
  return modes.includes(wanted) ? wanted : 'flip'
}

export type SpellVerdict = 'correct' | 'close' | 'wrong'

/**
 * Japanese accepts either the written form or its reading, in hiragana or katakana.
 * English ignores case and spacing; one edit away is "close" and left to the learner.
 */
export function judgeSpelling(lang: Lang, input: string, accepted: readonly (string | undefined)[]): SpellVerdict {
  const norm = (s: string) => {
    const t = normalizeTerm(lang, s)
    return lang === 'ja' ? toHiragana(t).replace(/[\s・]/g, '') : t
  }
  const got = norm(input)
  if (!got) return 'wrong'
  const targets = accepted.filter((a): a is string => !!a?.trim()).map(norm)
  if (targets.includes(got)) return 'correct'
  if (lang === 'en' && targets.some((t) => levenshtein(t, got) === 1)) return 'close'
  return 'wrong'
}

export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
}
