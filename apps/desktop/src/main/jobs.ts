import { acceptPending, runJob, TASK_LABELS, undoProposals, type Proposal, type TaskInput, type TaskKind } from '@fragmemo/ai'
import { createIds, noteTitle } from '@fragmemo/core'
import type { AiTaskResult, TaskRecord } from '@fragmemo/ui/api'
import { getAnalyzer, providerFor } from './ai'
import { commit, library, libraryStorage, notifyChanged } from './library'
import { enqueue, getTask, registerRunner, updateTask, type Runner } from './tasks'

// AI tasks on top of the queue: run the job, commit what it wrote as one commit, remember what
// it wrote so the whole batch can be undone, and keep flagged notes for the learner.

const KINDS = Object.keys(TASK_LABELS) as TaskKind[]

const appliedFile = (id: string) => `tasks/${id}.applied.json`

async function readApplied(id: string): Promise<Proposal[]> {
  try {
    return JSON.parse((await libraryStorage().readText(appliedFile(id))) ?? '[]') as Proposal[]
  } catch {
    return []
  }
}

const aiRunner: Runner = {
  async run(task, ctx) {
    const applied: Proposal[] = []
    // Writes of the record are chained so a slow one never lands after a newer one.
    let writing = Promise.resolve()
    const record = (more: Proposal[]) => {
      applied.push(...more)
      const snapshot = JSON.stringify(applied)
      writing = writing.then(() => libraryStorage().writeText(appliedFile(task.id), snapshot))
      return writing
    }
    const deps = {
      provider: providerFor('write'),
      library: library(),
      analyzer: getAnalyzer(),
      ids: createIds(),
      signal: ctx.signal,
      report: ctx.report,
      onDeckResolved: (deckId: string) => {
        if (task.input.kind === 'generate-deck' && 'name' in task.input.deck) {
          updateTask(task.id, { input: { ...task.input, deck: { id: deckId } } })
        }
      },
      onApplied: (p: Proposal[]) => void record(p).catch(() => {}),
      onEvent: (e: { type: string }) => e.type !== 'text' && ctx.log(e as Record<string, unknown>)
    }
    try {
      const res = await runJob(task.input, deps)
      await record([])
      const hash = res.applied.length ? await commit(`ai: ${task.kind} ${res.summary} #${task.id}`) : null
      ctx.log({ type: 'done', summary: res.summary, applied: res.applied.length, pending: res.pending.length })
      notifyChanged()
      return {
        summary: res.summary,
        deckId: res.deckId,
        applied: res.applied.length,
        ...(hash ? { commit: hash } : {}),
        pending: res.pending.map((p) => ({ proposal: p.proposal, issues: p.issues.map((i) => i.message) }))
      }
    } catch (err) {
      // Whatever earlier batches wrote stays, committed, and can still be undone from the task.
      if (applied.length) {
        await record([])
        await commit(`ai: ${task.kind} 中断，已写入 ${applied.length} 条 #${task.id}`)
        updateTask(task.id, { result: { summary: `中断前写入了 ${applied.length} 条`, applied: applied.length, pending: [] } })
        notifyChanged()
      }
      ctx.log({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  async undo(task) {
    const { undone, skipped } = await undoProposals(library(), await readApplied(task.id))
    await commit(`revert: ${task.kind} #${task.id}`)
    notifyChanged()
    const prev = task.result ?? { summary: '', applied: 0, pending: [] }
    return {
      ...prev,
      summary: `已撤销 ${undone} 条${skipped.length ? `，${skipped.length} 条后来改过、保留` : ''}`,
      undone: { at: Date.now(), skipped }
    }
  }
}

export function registerAiRunners() {
  for (const kind of KINDS) registerRunner(kind, aiRunner)
}

export function createTask(input: TaskInput): TaskRecord {
  return enqueue(input.kind, taskTitle(input), input)
}

function taskTitle(input: TaskInput): string {
  const label = TASK_LABELS[input.kind]
  switch (input.kind) {
    case 'generate-deck':
      return `${label}：${input.request.slice(0, 40)}`
    case 'extract-from-text':
      return `${label}：${input.text.replace(/\s+/g, ' ').slice(0, 30)}…`
    case 'enrich-notes':
      return `${label}（${input.noteIds.length} 条）`
    default:
      return label
  }
}

/** Accept or drop flagged notes. Accepted ones are written and committed like any task output. */
export async function resolvePending(taskId: string, noteIds: string[], accept: boolean) {
  const task = getTask(taskId)
  if (!task?.result) return
  const ids = new Set(noteIds)
  const chosen = task.result.pending.filter((p) => ids.has(p.proposal.note.id))
  if (accept && chosen.length) {
    await acceptPending(library(), chosen.map((p) => ({ proposal: p.proposal, issues: [] })))
    const applied = await readApplied(taskId)
    await libraryStorage().writeText(appliedFile(taskId), JSON.stringify([...applied, ...chosen.map((p) => p.proposal)]))
    await commit(`ai: accept ${chosen.map((p) => noteTitle(p.proposal.note)).join('、').slice(0, 60)} #${taskId}`)
  }
  const result: AiTaskResult = {
    ...task.result,
    applied: task.result.applied + (accept ? chosen.length : 0),
    pending: task.result.pending.filter((p) => !ids.has(p.proposal.note.id))
  }
  updateTask(taskId, { result })
  notifyChanged()
}
