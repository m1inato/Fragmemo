import { describe, expect, it } from 'vitest'
import { createLibrary, nextReview, prepareReview, type Note, type WordNote } from '../src'
import { seqIds, testLibrary } from './helpers'

const DAY = 86_400_000

function word(id: string, term: string, meaning: string, reading?: string): WordNote {
  return { id, type: 'word', key: `ja:${term}`, fields: { term, meaning, ...(reading ? { reading } : {}) }, tags: [], updatedAt: 0, deleted: false }
}

async function seeded(n = 6) {
  const t = testLibrary()
  const deck = await t.lib.createDeck({ name: 'N3 Emotion', lang: 'ja' })
  const words = [
    word('w1', '嬉しい', '高兴的', 'うれしい'),
    word('w2', '悲しい', '悲伤的', 'かなしい'),
    word('w3', '寂しい', '寂寞的', 'さびしい'),
    word('w4', '楽しい', '快乐的', 'たのしい'),
    word('w5', '怖い', '害怕的', 'こわい'),
    word('w6', '恥ずかしい', '害羞的', 'はずかしい')
  ].slice(0, n)
  await t.lib.upsertNotes(deck.id, words)
  return { ...t, deck }
}

describe('library', () => {
  it('writes decks as plain files', async () => {
    const { mem, deck } = await seeded(2)
    expect(deck.id).toBe('n3-emotion')
    expect(JSON.parse(mem.text('decks/n3-emotion/deck.json'))).toMatchObject({ name: 'N3 Emotion', lang: 'ja', version: 1 })
    const lines = mem.text('decks/n3-emotion/notes.jsonl').trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).id)).toEqual(['w1', 'w2'])
  })

  it('rejects notes that fail the schema', async () => {
    const { lib, deck } = await seeded(1)
    const bad = { ...word('x', '', ''), fields: { term: '', meaning: '' } } as Note
    await expect(lib.upsertNotes(deck.id, [bad])).rejects.toThrow()
  })

  it('limits new cards per day and buries new siblings', async () => {
    const { lib, deck } = await seeded(6)
    await lib.saveSettings({ review: { newPerDay: 4 } })
    const due = await lib.dueCards({ lang: 'ja', limit: 100, newLimit: 4 })
    expect(due).toHaveLength(4)
    // One face per note on the first day.
    expect(new Set(due.map((c) => c.note.id)).size).toBe(4)
    expect(due.every((c) => c.deckId === deck.id && c.state === null)).toBe(true)
  })

  it('applies the daily new-card limit per language, across decks', async () => {
    const { lib } = await seeded(6)
    const other = await lib.createDeck({ name: 'Other', lang: 'ja' })
    await lib.upsertNotes(other.id, [word('o1', '走る', '跑'), word('o2', '泳ぐ', '游泳')])
    await lib.saveSettings({ review: { newPerDay: 3 } })
    await lib.review('o1:0', { rating: 3, mode: 'flip', durationMs: 1 })

    const [ja] = await lib.overview()
    expect(ja.fresh).toBe(2)
    expect(ja.decks.map((d) => [d.id, d.fresh, d.learned])).toEqual([['n3-emotion', 2, 0], ['other', 1, 1]])
    // Reviewing one deck still counts what other decks of the language introduced today.
    expect(await lib.dueCards({ lang: 'ja', deckIds: ['n3-emotion'], limit: 100, newLimit: 3 })).toHaveLength(2)
  })

  it('appends reviews to this device\'s monthly log and schedules the card', async () => {
    const { lib, mem, clock } = await seeded(2)
    const state = await lib.review('w1:0', { rating: 3, mode: 'choice', correct: true, durationMs: 2100 })
    expect(state.reps).toBe(1)
    const file = [...mem.files.keys()].find((k) => k.startsWith('logs/mac-test/'))!
    expect(file).toMatch(/^logs\/mac-test\/\d{4}-\d{2}\.jsonl$/)
    expect(JSON.parse(mem.text(file).trim())).toMatchObject({ cardId: 'w1:0', rating: 3, mode: 'choice', correct: true, device: 'mac-test' })

    // The reviewed card is no longer due today; its sibling stays buried until tomorrow.
    let due = await lib.dueCards({ lang: 'ja', limit: 100, newLimit: 20 })
    expect(due.map((c) => c.cardId)).toEqual(['w2:0'])
    clock.advance(30 * DAY)
    due = await lib.dueCards({ lang: 'ja', limit: 100, newLimit: 20 })
    expect(due.map((c) => c.cardId)).toEqual(['w1:0', 'w1:1', 'w2:0'])
  })

  it('undoes the last review by appending, not deleting', async () => {
    const { lib, mem } = await seeded(2)
    await lib.review('w1:0', { rating: 1, mode: 'flip', durationMs: 1 })
    await lib.review('w2:0', { rating: 3, mode: 'flip', durationMs: 1 })
    expect(await lib.undo()).toBe('w2:0')
    expect((await lib.getCard('w2:0'))!.state).toBeNull()
    expect((await lib.getCard('w1:0'))!.state).not.toBeNull()
    const file = [...mem.files.keys()].find((k) => k.startsWith('logs/'))!
    expect(mem.text(file).trim().split('\n')).toHaveLength(3)
    expect(await lib.today('ja')).toEqual({ reviewed: 1, introduced: 1 })
  })

  it('rebuilds the same state from disk', async () => {
    const { lib, mem, clock } = await seeded(3)
    await lib.review('w1:0', { rating: 3, mode: 'flip', durationMs: 1 })
    clock.advance(3 * DAY)
    await lib.review('w1:0', { rating: 4, mode: 'flip', durationMs: 1 })
    const before = (await lib.getCard('w1:0'))!.state
    const again = createLibrary({ storage: mem.storage, sync: { pull: async () => {}, commit: async () => null, push: async () => {} }, clock, ids: seqIds('X'), deviceId: 'mac-other' })
    expect((await again.getCard('w1:0'))!.state).toEqual(before)
  })

  it('reports known terms by stability', async () => {
    const { lib, clock } = await seeded(3)
    for (let i = 0; i < 6; i++) {
      await lib.review('w1:0', { rating: 4, mode: 'flip', durationMs: 1 })
      clock.advance(((await lib.getCard('w1:0'))!.state!.dueAt.getTime() - clock.now()) + 1000)
    }
    await lib.review('w2:0', { rating: 1, mode: 'flip', durationMs: 1 })
    const known = await lib.knownTerms('ja')
    expect(known.mastered).toEqual(['嬉しい'])
    expect(known.learning).toEqual(['悲しい'])
  })

  it('finds notes by dedupe key', async () => {
    const { lib, deck } = await seeded(2)
    expect(await lib.findByKey('ja:悲しい')).toMatchObject({ deckId: deck.id, note: { id: 'w2' } })
    expect(await lib.findByKey('ja:none')).toBeNull()
  })

  it('imports a deck folder and keeps local pinned modes on update', async () => {
    const { lib, mem } = await seeded(0)
    const enc = (s: string) => new TextEncoder().encode(s)
    const meta = { id: 'core-100', name: 'Core 100', lang: 'en', version: 1, tags: [], source: 'repo', createdAt: '2026-11-01' }
    const notes = [{ id: 'e1', type: 'word', key: 'en:apple', fields: { term: 'apple', meaning: '苹果' }, tags: [], updatedAt: 1, deleted: false }]
    const files = new Map([
      ['core-100/deck.json', enc(JSON.stringify(meta))],
      ['core-100/notes.jsonl', enc(notes.map((n) => JSON.stringify(n)).join('\n'))],
      ['core-100/media/a.mp3', new Uint8Array([1, 2, 3])]
    ])
    expect(await lib.importDeckFolder(files)).toMatchObject({ added: 1, updated: 0 })
    expect(mem.files.get('decks/core-100/media/a.mp3')).toEqual(new Uint8Array([1, 2, 3]))
    const [apple] = await lib.getNotes('core-100')
    await lib.upsertNotes('core-100', [{ ...apple, mode: 'spell' }])
    expect(await lib.importDeckFolder(files)).toMatchObject({ added: 0, updated: 1 })
    expect((await lib.getNotes('core-100'))[0].mode).toBe('spell')
  })

  it('commits only when asked', async () => {
    const { lib, sync } = await seeded(1)
    await lib.review('w1:0', { rating: 3, mode: 'flip', durationMs: 1 })
    expect(sync.commits).toEqual([])
    await lib.commit('review: 1 cards')
    expect(sync.commits).toEqual(['review: 1 cards'])
  })
})

describe('review session', () => {
  const host = { mediaUrl: (d: string, f: string) => `fragmemo://media/${d}/${f}` }

  it('serves new cards as multiple choice with the answer among the options', async () => {
    const { lib } = await seeded(6)
    const q = await nextReview(lib, { lang: 'ja' }, host)
    expect(q.fresh).toBe(6)
    const item = q.item!
    expect(item.isNew).toBe(true)
    expect(item.mode).toBe('choice')
    expect(item.choices).toHaveLength(4)
    expect(item.choices).toContain(item.answer)
    expect(item.intervals[1]).toBeLessThan(item.intervals[4])
  })

  it('falls back to flipping when there are too few distractors', async () => {
    const { lib } = await seeded(2)
    const item = (await nextReview(lib, { lang: 'ja' }, host)).item!
    expect(item.mode).toBe('flip')
    expect(item.choices).toBeUndefined()
  })

  it('lets the learner switch mode for one card', async () => {
    const { lib } = await seeded(6)
    const item = await prepareReview(lib, 'w1:1', host, 'spell')
    expect(item.mode).toBe('spell')
    expect(item.answer).toBe('嬉しい')
    expect(item.faceLabel).toBe('义 → 词')
  })
})
