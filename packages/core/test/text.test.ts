import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { analyzeEnglish, createAnalyzer, readingOf, usesTerm } from '../src'

const require = createRequire(import.meta.url)
const analyzer = createAnalyzer({ jaDictPath: join(dirname(require.resolve('kuromoji/package.json')), 'dict') })

describe('analyzer', () => {
  it('gives dictionary forms and hiragana readings for Japanese', async () => {
    const tokens = await analyzer.analyze('ja', '昨日ケーキを食べた')
    expect(tokens.map((t) => t.base)).toContain('食べる')
    expect(tokens.find((t) => t.surface === 'ケーキ')?.reading).toBe('けーき')
    expect(await readingOf(analyzer, '嬉しい')).toBe('うれしい')
  })

  it('finds inflected uses of a term', async () => {
    expect(await usesTerm(analyzer, 'ja', '合格できて嬉しかった。', '嬉しい')).toBe(true)
    expect(await usesTerm(analyzer, 'ja', '毎日日本語を勉強しています。', '勉強する')).toBe(true)
    expect(await usesTerm(analyzer, 'ja', '今日は楽しかった。', '嬉しい')).toBe(false)
    expect(await usesTerm(analyzer, 'en', 'She was running late.', 'run')).toBe(true)
    expect(await usesTerm(analyzer, 'en', 'He gave up smoking.', 'give up')).toBe(true)
    expect(await usesTerm(analyzer, 'en', 'A quiet morning.', 'loud')).toBe(false)
  })

  it('lemmatizes common English inflections', () => {
    expect(analyzeEnglish('studies stopped boxes children').map((t) => t.base)).toEqual(['study', 'stop', 'box', 'child'])
  })
})
