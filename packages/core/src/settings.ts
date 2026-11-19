import type { Lang } from './types'

/** Library-wide settings, stored in `settings.json` and synced with the Library. */
export interface Settings {
  version: 1
  review: {
    /** Stability boundaries in days: choice < [0] ≤ listen < [1] ≤ flip < [2] ≤ spell. */
    modeThresholds: [number, number, number]
    newPerDay: number
    reviewsPerDay: number
    /** Local hour at which a new learning day begins. */
    dayStartHour: number
  }
  fsrs: {
    desiredRetention: number
    maximumInterval: number
    enableFuzz: boolean
  }
  tts: Record<Lang, { engine: 'system'; voice?: string }>
}

export const defaultSettings: Settings = {
  version: 1,
  review: { modeThresholds: [3, 10, 30], newPerDay: 20, reviewsPerDay: 200, dayStartHour: 4 },
  fsrs: { desiredRetention: 0.9, maximumInterval: 36500, enableFuzz: true },
  tts: { ja: { engine: 'system' }, en: { engine: 'system' } }
}

export type SettingsPatch = { [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K] }

/** Merge a partial (possibly older or hand-edited) settings object onto the defaults. */
export function normalizeSettings(input: unknown): Settings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const pick = <T extends object>(def: T, v: unknown): T =>
    ({ ...def, ...(v && typeof v === 'object' ? (v as Partial<T>) : {}) })
  const s: Settings = {
    version: 1,
    review: pick(defaultSettings.review, raw.review),
    fsrs: pick(defaultSettings.fsrs, raw.fsrs),
    tts: pick(defaultSettings.tts, raw.tts)
  }
  const t = s.review.modeThresholds
  if (!Array.isArray(t) || t.length !== 3 || !t.every((n) => typeof n === 'number' && n >= 0) || !(t[0] <= t[1] && t[1] <= t[2])) {
    s.review.modeThresholds = defaultSettings.review.modeThresholds
  }
  s.fsrs.desiredRetention = clamp(s.fsrs.desiredRetention, 0.7, 0.99, defaultSettings.fsrs.desiredRetention)
  s.review.newPerDay = clamp(s.review.newPerDay, 0, 9999, defaultSettings.review.newPerDay)
  s.review.reviewsPerDay = clamp(s.review.reviewsPerDay, 0, 99999, defaultSettings.review.reviewsPerDay)
  s.review.dayStartHour = clamp(s.review.dayStartHour, 0, 23, defaultSettings.review.dayStartHour)
  return s
}

export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    const cur = (current as unknown as Record<string, unknown>)[k]
    next[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? { ...cur, ...v } : v
  }
  return normalizeSettings(next)
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}
