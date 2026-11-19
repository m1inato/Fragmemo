import { createLibrary, type Analyzer, type Token } from '@fragmemo/core'
import { describe, expect, it } from 'vitest'
import { allTools, readTools, runAgent, runJob, runWritePipeline, undoProposals, type ApiProvider, type AssistantTurn, type Msg } from '../src'
import { fakeClock, memoryStorage, recordingSync, seqIds } from '../../core/test/helpers'

/** A provider that replays scripted turns and records what it was sent. */
function scripted(turns: (AssistantTurn | ((messages: Msg[]) => AssistantTurn))[]): ApiProvider & { seen: Msg[][] } {
  const seen: Msg[][] = []
  let i = 0
  return {
    id: 'openai-compatible',
    kind: 'api',
    seen,
    available: async () => true,
    async step({ messages }) {
      seen.push(structuredClone(messages))
      const turn = turns[Math.min(i++, turns.length - 1)]
      return typeof turn === 'function' ? turn(messages) : turn
    }
  }
}

const call = (name: string, input: unknown, id = name): AssistantTurn => ({ text: '', toolCalls: [{ id, name, input }] })
const say = (text: string): AssistantTurn => ({ text, toolCalls: [] })

/** Tiny deterministic analyzer: knows a few words, inflects 嬉しい → 嬉しかった. */
const analyzer: Analyzer = {
  async analyze(_lang, text) {
    const lexicon: Record<string, Token> = {
      嬉しかっ: { surface: '嬉しかっ', base: '嬉しい', reading: 'うれしかっ', pos: '形容詞', known: true },
      嬉しい: { surface: '嬉しい', base: '嬉しい', reading: 'うれしい', pos: '形容詞', known: true },
      悲しい: { surface: '悲しい', base: '悲しい', reading: 'かなしい', pos: '形容詞', known: true }
    }
    const out: Token[] = []
    let rest = text
    while (rest) {
      const hit = Object.keys(lexicon).find((k) => rest.startsWith(k))
      if (hit) {
        out.push(lexicon[hit])
        rest = rest.slice(hit.length)
      } else {
        out.push({ surface: rest[0], base: rest[0], pos: '記号', known: false })
        rest = rest.slice(1)
      }
    }
    return out
  }
}

async function setup() {
  const mem = memoryStorage()
  const sync = recordingSync()
  const library = createLibrary({ storage: mem.storage, sync, clock: fakeClock(), ids: seqIds('L'), deviceId: 'mac-test' })
  const deck = await library.createDeck({ name: 'Emotion', lang: 'ja' })
  await library.upsertNotes(deck.id, [
    { id: 'old', type: 'word', key: 'ja:悲しい', fields: { term: '悲しい', meaning: '悲伤的' }, tags: [], updatedAt: 0, deleted: false }
  ])
  return { library, deck, sync, ctx: { library, analyzer, lang: 'ja' as const, deckId: deck.id, ids: seqIds('A') } }
}

const good = { type: 'word', fields: { term: '嬉しい', reading: 'うれしい', meaning: '高兴的', examples: [{ text: '嬉しかった。', translation: '很高兴。' }] } }

describe('runAgent', () => {
  it('loops through tool calls and collects proposals without writing', async () => {
    const { library, ctx, deck } = await setup()
    const provider = scripted([call('search_notes', { query: '嬉しい' }), call('propose_notes', { notes: [good] }), say('做好了')])
    const res = await runAgent({ provider, system: 's', prompt: 'p', tools: allTools, ctx, signal: new AbortController().signal })
    expect(res.text).toBe('做好了')
    expect([...res.changes.proposals.values()].map((p) => [p.note.key, p.deckId, p.isNew])).toEqual([['ja:嬉しい', deck.id, true]])
    expect(await library.findByKey('ja:嬉しい')).toBeNull()
    // The tool result went back to the model as a tool message.
    expect(provider.seen[1].at(-1)).toMatchObject({ role: 'tool', name: 'search_notes' })
  })

  it('reports bad tool input to the model instead of throwing', async () => {
    const { ctx } = await setup()
    const provider = scripted([call('propose_notes', { notes: [{ type: 'word', fields: { term: '' } }] }), say('ok')])
    await runAgent({ provider, system: 's', prompt: 'p', tools: allTools, ctx, signal: new AbortController().signal })
    expect(String((provider.seen[1].at(-1) as { content: string }).content)).toMatch(/^参数不对/)
  })

  it('only offers read tools to Q&A', async () => {
    const { ctx } = await setup()
    const provider = scripted([call('propose_notes', { notes: [good] }), say('ok')])
    const res = await runAgent({ provider, system: 's', prompt: 'p', tools: readTools, ctx, signal: new AbortController().signal })
    expect(res.changes.proposals.size).toBe(0)
    expect(String((provider.seen[1].at(-1) as { content: string }).content)).toMatch(/没有这个工具/)
  })

  it('stops at maxSteps', async () => {
    const { ctx } = await setup()
    const provider = scripted([call('known_terms', {})])
    await runAgent({ provider, system: 's', prompt: 'p', tools: allTools, ctx, maxSteps: 3, signal: new AbortController().signal })
    expect(provider.seen).toHaveLength(3)
  })
})

describe('write pipeline', () => {
  it('applies clean proposals straight away', async () => {
    const { library, ctx } = await setup()
    const provider = scripted([call('propose_notes', { notes: [good] }), say('done')])
    const res = await runWritePipeline({ provider, system: 's', prompt: 'p', tools: allTools, ctx, signal: new AbortController().signal })
    expect(res.rounds).toBe(0)
    expect(res.applied).toHaveLength(1)
    expect(await library.findByKey('ja:嬉しい')).not.toBeNull()
  })

  it('sends check findings back, applies the fix, and parks what stays wrong', async () => {
    const { library, ctx } = await setup()
    const wrongReading = { ...good, fields: { ...good.fields, reading: 'うれし' } }
    const dup = { type: 'word', fields: { term: '悲しい', meaning: '难过' } }
    const provider = scripted([
      call('propose_notes', { notes: [wrongReading, dup] }),
      say('done'),
      // Fix round: correct the reading (same key → same proposal), leave the duplicate.
      (messages) => {
        const prompt = String((messages.at(-1) as { content: string }).content)
        expect(prompt).toContain('分词结果是「うれしい」')
        expect(prompt).toContain('与已有笔记重复')
        return call('propose_notes', { notes: [good] }, 'fix')
      },
      say('A000001')
    ])
    const res = await runWritePipeline({ provider, system: 's', prompt: 'p', tools: allTools, ctx, maxRounds: 1, signal: new AbortController().signal })
    expect(res.rounds).toBe(1)
    expect(res.applied.map((p) => p.note.key)).toEqual(['ja:嬉しい'])
    expect((await library.findByKey('ja:嬉しい'))!.note).toMatchObject({ fields: { reading: 'うれしい' } })
    expect(res.pending.map((p) => [p.proposal.note.key, p.issues[0].message])).toEqual([['ja:悲しい', expect.stringContaining('重复')]])
    // The original 悲しい is untouched.
    expect((await library.getNotes(ctx.deckId)).find((n) => n.id === 'old')!.fields).toMatchObject({ meaning: '悲伤的' })
  })

  it('flags examples that do not use the word, by dictionary form', async () => {
    const { ctx } = await setup()
    const bad = { ...good, fields: { ...good.fields, examples: [{ text: '悲しい。', translation: '' }] } }
    const provider = scripted([call('propose_notes', { notes: [bad] }), say('done'), say('NONE')])
    const res = await runWritePipeline({ provider, system: 's', prompt: 'p', tools: allTools, ctx, signal: new AbortController().signal })
    expect(res.applied).toHaveLength(0)
    expect(res.pending[0].issues[0].message).toContain('没有用到「嬉しい」')
  })
})

describe('jobs', () => {
  it('generates a deck in batches and stops when the model runs dry', async () => {
    const { library } = await setup()
    let n = 0
    const provider = scripted([
      (messages) => {
        // A fresh batch starts with a user prompt; answer it with one new word, twice, then nothing.
        const last = messages.at(-1)!
        if (last.role === 'user' && n < 2) {
          n++
          const term = n === 1 ? '嬉しい' : '悲しい'
          return call('propose_notes', { notes: [{ type: 'word', fields: { term: n === 1 ? term : '楽しい', meaning: 'x' } }] })
        }
        return say('done')
      }
    ])
    const stages: string[] = []
    const res = await runJob(
      { kind: 'generate-deck', lang: 'ja', request: '情绪形容词', count: 30, deck: { name: 'AI 情绪' } },
      { provider, library, analyzer, ids: seqIds('J'), signal: new AbortController().signal, report: (s) => stages.push(s) }
    )
    expect(res.applied).toHaveLength(2)
    expect((await library.getDeck(res.deckId!))).toMatchObject({ name: 'AI 情绪', source: 'ai' })
    expect(stages[0]).toBe('第 1 批')
  })

  it('undoes a task note by note, leaving notes edited since then alone', async () => {
    const { library, ctx, deck } = await setup()
    const provider = scripted([
      call('propose_notes', { notes: [good, { id: 'old', type: 'word', fields: { term: '悲しい', meaning: '悲伤的；难过' } }, { type: 'word', fields: { term: '楽しい', meaning: '快乐' } }] }),
      say('done')
    ])
    const res = await runWritePipeline({ provider, system: 's', prompt: 'p', tools: allTools, ctx, signal: new AbortController().signal })
    expect(res.applied).toHaveLength(3)
    // The learner edits one of the new notes afterwards.
    const tanoshii = (await library.getNotes(deck.id)).find((n) => n.key === 'ja:楽しい')!
    await library.upsertNotes(deck.id, [{ ...tanoshii, fields: { term: '楽しい', meaning: '愉快的' } } as typeof tanoshii])

    const out = await undoProposals(library, res.applied)
    expect(out).toEqual({ undone: 2, skipped: ['楽しい'] })
    const notes = await library.getNotes(deck.id)
    expect(notes.find((n) => n.id === 'old')!.fields).toMatchObject({ meaning: '悲伤的' })
    expect(notes.some((n) => n.key === 'ja:嬉しい')).toBe(false)
    expect(notes.some((n) => n.key === 'ja:楽しい')).toBe(true)
  })
})
