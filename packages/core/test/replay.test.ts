import { beforeAll, describe, expect, it } from 'vitest'
import { createScheduler, defaultSettings, effectiveReviews, replay, type LogEntry, type Rating, type Scheduler } from '../src'

let scheduler: Scheduler
beforeAll(async () => {
  scheduler = await createScheduler(defaultSettings.fsrs)
})

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1, 9)

/** Deterministic pseudo-random generator so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function randomLogs(seed: number): LogEntry[] {
  const rand = rng(seed)
  const logs: LogEntry[] = []
  const cards = ['A:0', 'A:1', 'B:0', 'C:0', 'C:1']
  let t = T0
  for (let i = 0; i < 60; i++) {
    t += Math.floor(rand() * 3 * DAY)
    const device = rand() < 0.5 ? 'mac-1' : 'android-1'
    logs.push({
      id: `R${String(i).padStart(4, '0')}`,
      cardId: cards[Math.floor(rand() * cards.length)],
      rating: (1 + Math.floor(rand() * 4)) as Rating,
      reviewedAt: t,
      durationMs: 3000,
      device,
      mode: 'flip'
    })
    if (rand() < 0.1) logs.push({ id: `U${i}`, type: 'undo', target: `R${String(i).padStart(4, '0')}`, reviewedAt: t + 1000, device })
  }
  return logs
}

function shuffled<T>(a: T[], seed: number): T[] {
  const rand = rng(seed)
  const out = a.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const snapshot = (m: Map<string, unknown>) => JSON.stringify([...m].sort(([a], [b]) => a.localeCompare(b)))

describe('replay', () => {
  it('gives the same states for any order of the same entries', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const logs = randomLogs(seed)
      const expected = snapshot(replay(logs, scheduler))
      for (let k = 0; k < 20; k++) expect(snapshot(replay(shuffled(logs, seed * 100 + k), scheduler))).toBe(expected)
    }
  })

  it('collapses entries duplicated across devices and re-imports', () => {
    const logs = randomLogs(7)
    const doubled = [...logs, ...logs.slice(0, 30)]
    expect(snapshot(replay(doubled, scheduler))).toBe(snapshot(replay(logs, scheduler)))
  })

  it('drops undone reviews wherever the undo entry sits', () => {
    const a: LogEntry = { id: '1', cardId: 'X:0', rating: 3, reviewedAt: T0, durationMs: 1, device: 'd', mode: 'flip' }
    const b: LogEntry = { id: '2', cardId: 'X:0', rating: 1, reviewedAt: T0 + DAY, durationMs: 1, device: 'd', mode: 'flip' }
    const undo: LogEntry = { id: '3', type: 'undo', target: '2', reviewedAt: T0 + DAY + 5, device: 'd' }
    const withUndo = replay([undo, b, a], scheduler)
    expect(snapshot(withUndo)).toBe(snapshot(replay([a], scheduler)))
    expect(withUndo.get('X:0')!.lapses).toBe(0)
  })

  it('breaks ties on review time by id', () => {
    const a: LogEntry = { id: 'b', cardId: 'X:0', rating: 1, reviewedAt: T0, durationMs: 1, device: 'd', mode: 'flip' }
    const b: LogEntry = { id: 'a', cardId: 'X:0', rating: 4, reviewedAt: T0, durationMs: 1, device: 'e', mode: 'flip' }
    expect(effectiveReviews([a, b]).map((r) => r.id)).toEqual(['a', 'b'])
    expect(snapshot(replay([a, b], scheduler))).toBe(snapshot(replay([b, a], scheduler)))
  })

  it('grows stability with successful reviews', () => {
    const logs: LogEntry[] = [0, 2, 7, 20].map((d, i) => ({
      id: `r${i}`, cardId: 'S:0', rating: 3, reviewedAt: T0 + d * DAY, durationMs: 1, device: 'd', mode: 'flip'
    }))
    const s = replay(logs, scheduler).get('S:0')!
    expect(s.reps).toBe(4)
    expect(s.stability).toBeGreaterThan(10)
  })
})
