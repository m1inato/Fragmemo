import { noteSchema, noteTitle, readingOf, toHiragana, usesTerm, type Analyzer, type Lang, type Library } from '@fragmemo/core'
import { createChangeSet, runAgent, type AgentResult } from './harness'
import type { Tool } from './tools'
import type { AgentEvent, ChangeSet, Msg, Proposal, Provider, ToolCtx } from './types'

// Every AI write goes through here: the model proposes, code checks, the model gets one or two
// chances to fix what the checks found, and only clean notes reach the Library.

export interface Issue { noteId: string; title: string; message: string }

export interface PipelineResult {
  text: string
  applied: Proposal[]
  /** Proposals that still had issues after the fix rounds; left for the learner to decide. */
  pending: { proposal: Proposal; issues: Issue[] }[]
  rounds: number
}

export async function checkChanges(changes: ChangeSet, o: { library: Library; analyzer: Analyzer; lang: Lang }): Promise<Issue[]> {
  const issues: Issue[] = []
  const keys = new Map<string, string>()
  for (const [id, p] of changes.proposals) {
    const note = p.note
    const title = noteTitle(note)
    const add = (message: string) => issues.push({ noteId: id, title, message })

    const parsed = noteSchema.safeParse(note)
    if (!parsed.success) {
      add(`字段不符合格式：${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；')}`)
      continue
    }

    const dup = await o.library.findByKey(note.key)
    if (dup && dup.note.id !== id) add(`与已有笔记重复（卡组 ${dup.deckId}，id ${dup.note.id}）；需要改它就带上它的 id`)
    const twin = keys.get(note.key)
    if (twin) add(`与本次提交的 ${twin} 重复`)
    keys.set(note.key, id)

    if (note.type === 'word') {
      const f = note.fields
      if (o.lang === 'ja' && f.reading) {
        const expected = await readingOf(o.analyzer, f.term)
        if (expected && expected !== toHiragana(f.reading.replace(/\s/g, ''))) {
          add(`读音写的是「${f.reading}」，分词结果是「${expected}」`)
        }
      }
      for (const ex of f.examples ?? []) {
        if (!(await usesTerm(o.analyzer, o.lang, ex.text, f.term))) add(`例句「${ex.text}」里没有用到「${f.term}」（按原形比对）`)
      }
    }
  }
  return issues
}

export function fixPrompt(issues: Issue[]): string {
  const lines = issues.map((i) => `- ${i.noteId}（${i.title}）：${i.message}`)
  return [
    '代码检查发现了这些问题：',
    ...lines,
    '',
    '请只通过 propose_notes 修改有问题的笔记（带上原 id）。改完后回复改动过的 id，每行一个；',
    '如果你确认原内容没错、不需要改，只回复 NONE。'
  ].join('\n')
}

export async function runWritePipeline(o: {
  provider: Provider
  system: string
  prompt: string
  tools: Tool<any, any>[]
  ctx: Omit<ToolCtx, 'changes' | 'signal'>
  signal: AbortSignal
  maxSteps?: number
  /** Fix rounds after the first run. */
  maxRounds?: number
  onEvent?: (e: AgentEvent) => void
  onStage?: (stage: 'generate' | 'check' | 'fix' | 'apply', round: number) => void
}): Promise<PipelineResult> {
  const changes = createChangeSet()
  const ctx = { ...o.ctx, changes }
  o.onStage?.('generate', 0)
  let run: AgentResult = await runAgent({ ...o, ctx })
  let history: Msg[] = run.transcript
  let session = run.session
  let issues: Issue[] = []
  let rounds = 0

  for (;;) {
    o.onStage?.('check', rounds)
    issues = await checkChanges(changes, { library: o.ctx.library, analyzer: o.ctx.analyzer, lang: o.ctx.lang })
    if (!issues.length || rounds >= (o.maxRounds ?? 2)) break
    rounds++
    o.onStage?.('fix', rounds)
    run = await runAgent({ ...o, prompt: fixPrompt(issues), ctx, history, session })
    history = run.transcript
    session = run.session ?? session
    if (/^\s*NONE\s*$/i.test(run.text)) {
      issues = await checkChanges(changes, { library: o.ctx.library, analyzer: o.ctx.analyzer, lang: o.ctx.lang })
      break
    }
  }

  o.onStage?.('apply', rounds)
  const bad = new Map<string, Issue[]>()
  for (const i of issues) bad.set(i.noteId, [...(bad.get(i.noteId) ?? []), i])
  const applied: Proposal[] = []
  const pending: PipelineResult['pending'] = []
  for (const [id, p] of changes.proposals) {
    if (bad.has(id)) pending.push({ proposal: p, issues: bad.get(id)! })
    else applied.push(p)
  }
  await applyProposals(o.ctx.library, applied)
  return { text: run.text, applied, pending, rounds }
}

/** Write accepted proposals, grouped per deck. Committing is the caller's call. */
export async function applyProposals(library: Library, proposals: Proposal[]) {
  const byDeck = new Map<string, Proposal[]>()
  for (const p of proposals) byDeck.set(p.deckId, [...(byDeck.get(p.deckId) ?? []), p])
  for (const [deckId, list] of byDeck) await library.upsertNotes(deckId, list.map((p) => p.note))
}
