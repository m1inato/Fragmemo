import {
  answerText, grammarFieldsSchema, noteKey, noteTitle, sentenceFieldsSchema, wordFieldsSchema, type Note
} from '@fragmemo/core'
import { z } from 'zod'
import type { StandardNote, ToolCtx, ToolSpec } from './types'

export interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  input: z.ZodType<I>
  run(input: I, ctx: ToolCtx): Promise<O>
}

const define = <I, O>(t: Tool<I, O>): Tool<I, O> => t

export function toolSpec(t: Tool): ToolSpec {
  const { $schema: _, ...parameters } = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>
  return { name: t.name, description: t.description, parameters }
}

const LIST_LIMIT = 50

async function langNotes(ctx: ToolCtx): Promise<{ deckId: string; deckName: string; note: Note }[]> {
  const out: { deckId: string; deckName: string; note: Note }[] = []
  for (const d of await ctx.library.listDecks()) {
    if (d.lang !== ctx.lang) continue
    for (const note of await ctx.library.getNotes(d.id)) out.push({ deckId: d.id, deckName: d.name, note })
  }
  return out
}

function brief(n: Note) {
  return {
    id: n.id,
    type: n.type,
    title: noteTitle(n),
    ...(n.type === 'raw' ? { fields: n.fields } : { answer: answerText(n, 0), fields: n.fields }),
    tags: n.tags
  }
}

export const searchNotes = define({
  name: 'search_notes',
  description: '在学习者当前语言的卡组中查找笔记：按词、释义或标签匹配。用来查重、找相关词或找要修改的笔记。',
  input: z.object({
    query: z.string().optional().describe('匹配词条、读音、释义的关键字'),
    tag: z.string().optional(),
    deckId: z.string().optional(),
    limit: z.number().int().min(1).max(LIST_LIMIT).optional()
  }),
  async run({ query, tag, deckId, limit }, ctx) {
    const q = query?.trim().toLowerCase()
    const hits = (await langNotes(ctx)).filter(({ deckId: d, note }) =>
      (!deckId || d === deckId) &&
      (!tag || note.tags.includes(tag)) &&
      (!q || JSON.stringify(note.fields).toLowerCase().includes(q)))
    return {
      total: hits.length,
      notes: hits.slice(0, limit ?? 20).map(({ deckId: d, deckName, note }) => ({ deckId: d, deckName, ...brief(note) }))
    }
  }
})

export const getLeeches = define({
  name: 'get_leeches',
  description: '列出反复遗忘的卡片（遗忘次数多），附带复习次数与当前记忆稳定度（天）。',
  input: z.object({ minLapses: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(LIST_LIMIT).optional() }),
  async run({ minLapses, limit }, ctx) {
    const decks = new Map((await ctx.library.listDecks()).map((d) => [d.id, d]))
    const cards = (await ctx.library.leeches(minLapses ?? 4)).filter((c) => decks.get(c.deckId)?.lang === ctx.lang)
    return cards.slice(0, limit ?? 20).map((c) => ({
      cardId: c.cardId,
      deckId: c.deckId,
      lapses: c.state?.lapses ?? 0,
      reps: c.state?.reps ?? 0,
      stabilityDays: Math.round((c.state?.stability ?? 0) * 10) / 10,
      note: brief(c.note)
    }))
  }
})

export const knownTerms = define({
  name: 'known_terms',
  description: '学习者已掌握（mastered）和正在学（learning）的词。用来避免重复、控制例句难度。',
  input: z.object({}),
  async run(_, ctx) {
    const { mastered, learning } = await ctx.library.knownTerms(ctx.lang)
    return { mastered: mastered.slice(0, 800), learning: learning.slice(0, 800), truncated: mastered.length > 800 || learning.length > 800 }
  }
})

export const analyzeText = define({
  name: 'analyze_text',
  description: '分词：返回每个词的原形、读音（日语）和词性。用来确认原形与读音，不要凭感觉写读音。',
  input: z.object({ text: z.string().min(1).max(2000) }),
  async run({ text }, ctx) {
    return (await ctx.analyzer.analyze(ctx.lang, text)).map((t) => ({
      surface: t.surface, base: t.base, ...(t.reading ? { reading: t.reading } : {}), pos: t.pos, ...(t.known ? {} : { guessed: true })
    }))
  }
})

export const readInbox = define({
  name: 'read_inbox',
  description: '读取学习者在手机上收藏、等待整理成卡片的词句。',
  input: z.object({}),
  async run(_, ctx) {
    return (await ctx.library.readInbox()).filter((i) => i.lang === ctx.lang)
  }
})

const proposalInput = z.discriminatedUnion('type', [
  z.object({ id: z.string().optional(), type: z.literal('word'), fields: wordFieldsSchema, tags: z.array(z.string()).optional() }),
  z.object({ id: z.string().optional(), type: z.literal('sentence'), fields: sentenceFieldsSchema, tags: z.array(z.string()).optional() }),
  z.object({ id: z.string().optional(), type: z.literal('grammar'), fields: grammarFieldsSchema, tags: z.array(z.string()).optional() })
])

export const proposeNotes = define({
  name: 'propose_notes',
  description:
    '新建或修改笔记。不带 id 是新建；带已有笔记的 id 是整条替换它的字段。' +
    '只是提交提案：代码会校验后再写入，有问题会把问题清单发回给你。',
  input: z.object({ notes: z.array(proposalInput).min(1).max(20) }),
  async run({ notes }, ctx) {
    const accepted: { id: string; key: string; title: string }[] = []
    const errors: string[] = []
    const existing = new Map((await langNotes(ctx)).map((x) => [x.note.id, x]))
    for (const input of notes) {
      const prev = input.id ? existing.get(input.id) : undefined
      const pending = input.id ? ctx.changes.proposals.get(input.id) : undefined
      if (input.id && !prev && !pending) {
        errors.push(`找不到 id 为 ${input.id} 的笔记；新建时不要带 id`)
        continue
      }
      const deckId = prev?.deckId ?? pending?.deckId ?? ctx.deckId
      if (!deckId) {
        errors.push('这次任务没有指定目标卡组，只能修改已有笔记')
        continue
      }
      const key = noteKey(ctx.lang, input)
      // A new proposal for a key already proposed in this run replaces the earlier one.
      const sameKey = !input.id ? [...ctx.changes.proposals.values()].find((p) => p.isNew && p.note.key === key) : undefined
      const id = input.id ?? sameKey?.note.id ?? ctx.ids.ulid()
      const note = {
        id,
        type: input.type,
        key,
        fields: input.fields,
        tags: input.tags ?? prev?.note.tags ?? [],
        updatedAt: 0,
        deleted: false,
        ...(prev?.note.mode ? { mode: prev.note.mode } : {})
      } as StandardNote
      ctx.changes.proposals.set(id, { note, deckId, isNew: !prev, ...(prev ? { before: prev.note } : {}) })
      accepted.push({ id, key, title: noteTitle(note) })
    }
    return { accepted, ...(errors.length ? { errors } : {}) }
  }
})

export const readTools: Tool<any, any>[] = [searchNotes, getLeeches, knownTerms, analyzeText, readInbox]
export const allTools: Tool<any, any>[] = [...readTools, proposeNotes]
