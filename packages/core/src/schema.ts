import { z } from 'zod'
import type { DeckMeta, Note } from './types'

// Runtime validation for everything read from or written to the Library. The TypeScript types in
// types.ts are the source of truth; `satisfies` below keeps the two from drifting apart.

export const langSchema = z.enum(['ja', 'en'])
export const answerModeSchema = z.enum(['flip', 'choice', 'listen', 'spell'])

const nonEmpty = z.string().trim().min(1)

const exampleSchema = z.object({
  text: nonEmpty,
  translation: z.string(),
  reading: z.string().optional()
})

export const wordFieldsSchema = z.object({
  term: nonEmpty,
  meaning: nonEmpty,
  reading: z.string().optional(),
  pos: z.string().optional(),
  examples: z.array(exampleSchema).optional(),
  notes: z.string().optional(),
  audio: z.string().optional(),
  confusables: z.array(z.string()).optional()
})

export const sentenceFieldsSchema = z.object({
  text: nonEmpty,
  translation: nonEmpty,
  reading: z.string().optional(),
  grammar: z.array(z.string()).optional(),
  audio: z.string().optional()
})

export const grammarFieldsSchema = z.object({
  pattern: nonEmpty,
  meaning: nonEmpty,
  connection: z.string().optional(),
  examples: z.array(exampleSchema).optional(),
  nuance: z.string().optional()
})

const base = {
  id: nonEmpty,
  key: nonEmpty,
  tags: z.array(z.string()),
  mode: answerModeSchema.optional(),
  updatedAt: z.number(),
  deleted: z.boolean()
}

export const noteSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('word'), fields: wordFieldsSchema }),
  z.object({ ...base, type: z.literal('sentence'), fields: sentenceFieldsSchema }),
  z.object({ ...base, type: z.literal('grammar'), fields: grammarFieldsSchema }),
  z.object({ ...base, type: z.literal('raw'), fields: z.record(z.string(), z.string()), template: nonEmpty })
]) satisfies z.ZodType<Note>

export const deckMetaSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'deck id must be lowercase ascii, digits and dashes'),
  name: nonEmpty,
  lang: langSchema,
  version: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  source: z.enum(['ai', 'repo', 'apkg', 'manual']),
  createdAt: z.string()
}) satisfies z.ZodType<DeckMeta>
