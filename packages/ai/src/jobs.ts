import { noteTitle, stripHtml, type Analyzer, type Lang, type Library, type Note } from '@fragmemo/core'
import { applyProposals, runWritePipeline, type Issue } from './pipeline'
import { prompts, writerSystem } from './prompts'
import { allTools } from './tools'
import type { AgentEvent, Proposal, Provider } from './types'

// The AI tasks Fragmemo knows, as plain functions of (input, deps). The task queue in the
// desktop shell persists, schedules and commits them; nothing here knows about queues.

export type TaskInput =
  | { kind: 'generate-deck'; lang: Lang; request: string; count: number; deck: DeckTarget }
  | { kind: 'extract-from-text'; lang: Lang; text: string; deck: DeckTarget }
  | { kind: 'enrich-notes'; lang: Lang; deckId: string; noteIds: string[]; fields: string[] }
  | { kind: 'convert-raw'; lang: Lang; deckId: string }
  | { kind: 'process-inbox'; lang: Lang; deck: DeckTarget }
  | { kind: 'leech-helper'; lang: Lang; minLapses?: number }

export type TaskKind = TaskInput['kind']

/** An existing deck, or the name of one to create. */
export type DeckTarget = { id: string } | { name: string }

export interface PendingNote { proposal: Proposal; issues: Issue[] }

export interface JobResult {
  summary: string
  deckId?: string
  applied: Proposal[]
  pending: PendingNote[]
}

export interface JobDeps {
  provider: Provider
  library: Library
  analyzer: Analyzer
  ids: { ulid(): string }
  signal: AbortSignal
  /** Progress is 0–1, or -1 when unknown. */
  report: (stage: string, progress: number) => void
  onEvent?: (e: AgentEvent) => void
  /** Called after each batch is written, so a later failure still knows what is on disk. */
  onApplied?: (proposals: Proposal[]) => void
}

export const TASK_LABELS: Record<TaskKind, string> = {
  'generate-deck': '生成卡组',
  'extract-from-text': '从文本提取',
  'enrich-notes': '补全笔记',
  'convert-raw': '转换 Anki 卡片',
  'process-inbox': '整理收藏',
  'leech-helper': '攻克难记卡'
}

/** Notes per model run: small enough to check and fix, large enough to be worth a call. */
const BATCH = 12

export async function runJob(input: TaskInput, deps: JobDeps): Promise<JobResult> {
  const { library, signal } = deps
  const lang = input.lang
  const system = writerSystem(lang, await library.profile(lang))
  const applied: Proposal[] = []
  const pending: PendingNote[] = []

  const batch = async (prompt: string, deckId: string | undefined, label: string) => {
    const res = await runWritePipeline({
      provider: deps.provider,
      system,
      prompt,
      tools: allTools,
      ctx: { library, analyzer: deps.analyzer, lang, deckId, ids: deps.ids },
      signal,
      onEvent: deps.onEvent,
      onStage: (stage, round) => deps.report(`${label}${STAGES[stage]}${round ? `（第 ${round} 轮）` : ''}`, -1)
    })
    applied.push(...res.applied)
    if (res.applied.length) deps.onApplied?.(res.applied)
    pending.push(...res.pending)
    return res
  }

  switch (input.kind) {
    case 'generate-deck': {
      const deckId = await resolveDeck(library, input.deck, lang)
      const deckName = (await library.getDeck(deckId))!.name
      let left = input.count
      for (let i = 0; left > 0; i++) {
        signal.throwIfAborted()
        const n = Math.min(BATCH, left)
        deps.report(`第 ${i + 1} 批`, (input.count - left) / input.count)
        const made = (await library.getNotes(deckId)).map((x) => ('term' in x.fields ? String(x.fields.term) : '')).filter(Boolean)
        const res = await batch(prompts.generateDeck({ request: input.request, count: n, deckName, made }), deckId, `第 ${i + 1} 批 · `)
        const produced = res.applied.filter((p) => p.isNew).length + res.pending.length
        // A batch that adds nothing means the model has run out of ideas; stop rather than loop.
        if (!produced) break
        left -= produced
      }
      return { summary: `新增 ${applied.length} 条笔记`, deckId, applied, pending }
    }

    case 'extract-from-text': {
      const deckId = await resolveDeck(library, input.deck, lang)
      await batch(prompts.extractFromText({ text: input.text.slice(0, 8000) }), deckId, '')
      return { summary: `提取了 ${applied.length} 条笔记`, deckId, applied, pending }
    }

    case 'enrich-notes': {
      const all = new Map((await library.getNotes(input.deckId)).map((n) => [n.id, n]))
      const ids = input.noteIds.filter((id) => all.get(id)?.type !== 'raw' && all.has(id))
      for (let i = 0; i < ids.length; i += BATCH) {
        signal.throwIfAborted()
        deps.report(`${i + 1}–${Math.min(i + BATCH, ids.length)} / ${ids.length}`, i / ids.length)
        const notes = ids.slice(i, i + BATCH).map((id) => all.get(id)!).map(({ id, type, fields, tags }) => ({ id, type, fields, tags }))
        await batch(prompts.enrichNotes({ notes, fields: input.fields }), input.deckId, `${i + 1}–${Math.min(i + BATCH, ids.length)} · `)
      }
      return { summary: `补全了 ${applied.length} 条笔记`, deckId: input.deckId, applied, pending }
    }

    case 'convert-raw': {
      const raw = (await library.getNotes(input.deckId)).filter((n) => n.type === 'raw')
      const size = 10
      for (let i = 0; i < raw.length; i += size) {
        signal.throwIfAborted()
        deps.report(`${i + 1}–${Math.min(i + size, raw.length)} / ${raw.length}`, i / raw.length)
        const notes = raw.slice(i, i + size).map((n) => ({
          id: n.id,
          fields: Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, stripHtml(v)]))
        }))
        await batch(prompts.convertRaw({ notes }), input.deckId, `${i + 1}–${Math.min(i + size, raw.length)} · `)
      }
      return { summary: `转换了 ${applied.length} / ${raw.length} 条`, deckId: input.deckId, applied, pending }
    }

    case 'process-inbox': {
      const deckId = await resolveDeck(library, input.deck, lang)
      const res = await batch(prompts.processInbox(), deckId, '')
      return { summary: `整理出 ${applied.length} 条笔记。${res.text.trim().slice(0, 200)}`, deckId, applied, pending }
    }

    case 'leech-helper': {
      await batch(prompts.leechHelper(), undefined, '')
      return { summary: `改进了 ${applied.length} 条难记的笔记`, applied, pending }
    }
  }
}

const STAGES = { generate: '生成', check: '检查', fix: '修正', apply: '写入' } as const

async function resolveDeck(library: Library, target: DeckTarget, lang: Lang): Promise<string> {
  if ('id' in target) {
    const deck = await library.getDeck(target.id)
    if (!deck) throw new Error('目标卡组不存在')
    return deck.id
  }
  return (await library.createDeck({ name: target.name, lang, source: 'ai' })).id
}

/** The learner accepted notes the checks flagged. */
export async function acceptPending(library: Library, notes: PendingNote[]) {
  await applyProposals(library, notes.map((n) => n.proposal))
}

/**
 * Undo what a task wrote, note by note: new notes are marked deleted, modified ones get their
 * earlier version back. Notes edited again since are left alone and reported.
 */
export async function undoProposals(library: Library, proposals: Proposal[]): Promise<{ undone: number; skipped: string[] }> {
  const skipped: string[] = []
  const byDeck = new Map<string, Note[]>()
  for (const p of proposals) {
    const current = (await library.getNotes(p.deckId)).find((n) => n.id === p.note.id)
    if (!current) continue
    if (JSON.stringify(current.fields) !== JSON.stringify(p.note.fields)) {
      skipped.push(noteTitle(current))
      continue
    }
    const restored: Note = p.before ?? { ...current, deleted: true }
    byDeck.set(p.deckId, [...(byDeck.get(p.deckId) ?? []), restored])
  }
  let undone = 0
  for (const [deckId, notes] of byDeck) {
    await library.upsertNotes(deckId, notes)
    undone += notes.length
  }
  return { undone, skipped }
}
