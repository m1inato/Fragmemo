import type { AnswerMode, Lang, Rating } from '@fragmemo/core'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "10 分钟", "3 天", "2.5 月": how far away a due time is. */
export function formatInterval(dueAt: number, now = Date.now()): string {
  const d = Math.max(0, dueAt - now)
  if (d < HOUR) return `${Math.max(1, Math.round(d / MIN))} 分钟`
  if (d < DAY) return `${Math.round(d / HOUR)} 小时`
  if (d < 30 * DAY) return `${Math.round(d / DAY)} 天`
  if (d < 365 * DAY) return `${trim(d / (30 * DAY))} 个月`
  return `${trim(d / (365 * DAY))} 年`
}

function trim(n: number): string {
  return n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n))
}

export const RATING_LABELS: Record<Rating, string> = { 1: '忘记', 2: '困难', 3: '良好', 4: '简单' }
export const MODE_LABELS: Record<AnswerMode, string> = { flip: '翻卡', choice: '选择', listen: '听音', spell: '拼写' }
export const LANG_LABELS: Record<Lang, string> = { ja: '日语', en: '英语' }
export const NOTE_TYPE_LABELS = { word: '单词', sentence: '句子', grammar: '语法', raw: 'Anki' } as const
export const SOURCE_LABELS = { ai: 'AI 生成', repo: '卡包仓库', apkg: 'Anki', manual: '手动' } as const

/** Hue for a language's tag: red for Japanese, blue for English. */
export const langHue = (lang: Lang) => (lang === 'ja' ? 355 : 215)
