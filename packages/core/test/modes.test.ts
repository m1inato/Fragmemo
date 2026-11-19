import { describe, expect, it } from 'vitest'
import { judgeSpelling, pickDistractors, pickMode, type CardState, type Note, type WordNote } from '../src'

const word = (id: string, term: string, meaning: string, extra: Partial<WordNote['fields']> = {}, mode?: WordNote['mode']): WordNote => ({
  id, type: 'word', key: `ja:${term}`, fields: { term, meaning, ...extra }, tags: [], updatedAt: 0, deleted: false, ...(mode ? { mode } : {})
})
const stable = (stability: number) => ({ stability }) as CardState
const T: [number, number, number] = [3, 10, 30]

describe('pickMode', () => {
  const w = word('1', '嬉しい', '高兴的')
  it('moves from recognition to production as stability grows', () => {
    expect(pickMode(w, null, T)).toBe('choice')
    expect(pickMode(w, stable(2.9), T)).toBe('choice')
    expect(pickMode(w, stable(3), T)).toBe('listen')
    expect(pickMode(w, stable(10), T)).toBe('flip')
    expect(pickMode(w, stable(30), T)).toBe('spell')
  })
  it('falls back to flip for modes a type does not support', () => {
    const sentence: Note = { id: 's', type: 'sentence', key: 'k', fields: { text: '雨だ。', translation: '下雨了。' }, tags: [], updatedAt: 0, deleted: false }
    expect(pickMode(sentence, null, T)).toBe('flip')
    expect(pickMode(sentence, stable(5), T)).toBe('listen')
    expect(pickMode(sentence, stable(50), T)).toBe('flip')
    const raw: Note = { id: 'r', type: 'raw', key: 'raw:x', fields: {}, template: 't', tags: [], updatedAt: 0, deleted: false }
    expect(pickMode(raw, null, T)).toBe('flip')
  })
  it('honours a pinned mode', () => {
    expect(pickMode(word('2', '楽しい', '快乐的', {}, 'spell'), null, T)).toBe('spell')
  })
})

describe('judgeSpelling', () => {
  it('accepts kanji or kana, hiragana or katakana', () => {
    const accepted = ['嬉しい', 'うれしい']
    expect(judgeSpelling('ja', '嬉しい', accepted)).toBe('correct')
    expect(judgeSpelling('ja', 'うれしい', accepted)).toBe('correct')
    expect(judgeSpelling('ja', 'ウレシイ', accepted)).toBe('correct')
    expect(judgeSpelling('ja', 'うれし', accepted)).toBe('wrong')
  })
  it('ignores case in English and flags one-off typos as close', () => {
    expect(judgeSpelling('en', ' Serendipity ', ['serendipity'])).toBe('correct')
    expect(judgeSpelling('en', 'serendipty', ['serendipity'])).toBe('close')
    expect(judgeSpelling('en', 'serenity', ['serendipity'])).toBe('wrong')
    expect(judgeSpelling('en', '', ['a'])).toBe('wrong')
  })
})

describe('pickDistractors', () => {
  const target = word('t', '嬉しい', '高兴的', { reading: 'うれしい', pos: 'い形容词', confusables: ['楽しい'] })
  const pool = [
    target,
    word('a', '楽しい', '快乐的', { reading: 'たのしい', pos: 'い形容词' }),
    word('b', '悲しい', '悲伤的', { reading: 'かなしい', pos: 'い形容词' }),
    word('c', '寂しい', '寂寞的', { reading: 'さびしい', pos: 'い形容词' }),
    word('d', '走る', '跑', { reading: 'はしる', pos: '动词' }),
    word('e', '嬉しい2', '高兴的', { reading: 'うれしい', pos: 'い形容词' })
  ].map((note) => ({ note, deckId: 'd1' }))

  it('starts with confusables and never repeats the answer', () => {
    const got = pickDistractors({ note: target, face: 0, deckId: 'd1', lang: 'ja' }, pool, 3)
    expect(got[0]).toBe('快乐的')
    expect(got).toHaveLength(3)
    expect(got).not.toContain('高兴的')
    expect(new Set(got).size).toBe(3)
  })
  it('offers terms when the card asks for the term', () => {
    const got = pickDistractors({ note: target, face: 1, deckId: 'd1', lang: 'ja' }, pool, 3)
    expect(got[0]).toBe('楽しい')
    expect(got).not.toContain('嬉しい')
  })
  it('prefers the same part of speech before falling back to the deck', () => {
    const got = pickDistractors({ note: target, face: 0, deckId: 'd1', lang: 'ja' }, pool, 3)
    expect(got).not.toContain('跑')
  })
})
