import { createIds, type Storage } from '@fragmemo/core'
import type { TaskAction, TaskRecord } from '@fragmemo/ui/api'

// One serial queue of long-running jobs. State lives in the Library's tasks.json so it survives
// restarts (a task that was running is queued again) and so other devices can see it.

export interface RunContext {
  signal: AbortSignal
  /** Progress is 0–1, or -1 when unknown. */
  report(stage: string, progress: number): void
  /** Append a line to the task's run record, tasks/<id>.jsonl. */
  log(entry: Record<string, unknown>): void
}

export interface Runner {
  run(task: TaskRecord, ctx: RunContext): Promise<TaskRecord['result']>
  /** The learner asked to undo a finished task. */
  undo?(task: TaskRecord): Promise<TaskRecord['result']>
}

export class TaskError extends Error {}

const FILE = 'tasks.json'
const runners = new Map<TaskRecord['kind'], Runner>()
let storage: Storage | null = null
let device = ''
let tasks: TaskRecord[] = []
let running: { id: string; controller: AbortController } | null = null
let onChanged: (tasks: TaskRecord[]) => void = () => {}
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function registerRunner(kind: TaskRecord['kind'], runner: Runner) {
  runners.set(kind, runner)
}

/** Point the queue at a Library; called whenever a Library is opened. */
export async function initTasks(s: Storage, deviceId: string, changed: (tasks: TaskRecord[]) => void) {
  running?.controller.abort()
  running = null
  storage = s
  device = deviceId
  onChanged = changed
  try {
    tasks = JSON.parse((await s.readText(FILE)) ?? '[]') as TaskRecord[]
  } catch {
    tasks = []
  }
  // Interrupted by a quit or crash: run again.
  for (const t of tasks) if (t.status === 'running') Object.assign(t, { status: 'queued', stage: undefined, progress: undefined })
  changedNow()
  pump()
}

export function listTasks(): TaskRecord[] {
  return tasks
}

export function getTask(id: string): TaskRecord | undefined {
  return tasks.find((t) => t.id === id)
}

export function enqueue(kind: TaskRecord['kind'], title: string, input: TaskRecord['input']): TaskRecord {
  if (!storage) throw new Error('还没有打开 Library')
  const now = Date.now()
  const task: TaskRecord = { id: createIds().ulid(), kind, title, input, status: 'queued', createdAt: now, updatedAt: now, device }
  tasks.unshift(task)
  changedNow()
  pump()
  return task
}

export function updateTask(id: string, patch: Partial<TaskRecord>) {
  const t = getTask(id)
  if (!t) return
  Object.assign(t, patch, { updatedAt: Date.now() })
  changedNow()
}

export async function act(id: string, action: TaskAction) {
  const t = getTask(id)
  if (!t) return
  const isRunning = running?.id === id
  switch (action) {
    case 'pause':
      if (t.status === 'queued' || isRunning) {
        if (isRunning) running!.controller.abort(new TaskError('paused'))
        updateTask(id, { status: 'paused', stage: undefined, progress: undefined })
      }
      break
    case 'resume':
    case 'retry':
      if (t.status === 'paused' || t.status === 'failed' || t.status === 'cancelled') updateTask(id, { status: 'queued', error: undefined })
      break
    case 'cancel':
      if (isRunning) running!.controller.abort(new TaskError('cancelled'))
      if (t.status !== 'done') updateTask(id, { status: 'cancelled', stage: undefined, progress: undefined })
      break
    case 'undo': {
      const runner = runners.get(t.kind)
      if (t.status !== 'done' || !runner?.undo || t.result?.undone) return
      updateTask(id, { result: await runner.undo(t) })
      break
    }
    case 'remove':
      if (isRunning) return
      tasks = tasks.filter((x) => x.id !== id)
      changedNow()
      break
  }
  pump()
}

function pump() {
  if (running || !storage) return
  const next = [...tasks].reverse().find((t) => t.status === 'queued')
  if (!next) return
  const runner = runners.get(next.kind)
  if (!runner) return updateTask(next.id, { status: 'failed', error: '不认识的任务类型' })
  const controller = new AbortController()
  running = { id: next.id, controller }
  updateTask(next.id, { status: 'running', error: undefined, stage: '准备', progress: -1 })
  const s = storage

  const ctx: RunContext = {
    signal: controller.signal,
    report: (stage, progress) => {
      Object.assign(next, { stage, progress, updatedAt: Date.now() })
      changedSoon()
    },
    log: (entry) => {
      s.appendText(`tasks/${next.id}.jsonl`, JSON.stringify({ at: Date.now(), ...entry }) + '\n').catch(() => {})
    }
  }

  runner
    .run(next, ctx)
    .then((result) => updateTask(next.id, { status: 'done', result, stage: undefined, progress: undefined }))
    .catch((err: unknown) => {
      // Pause and cancel already set the status; anything else is a failure.
      if (controller.signal.aborted && controller.signal.reason instanceof TaskError) return
      updateTask(next.id, { status: 'failed', error: err instanceof Error ? err.message : String(err), stage: undefined, progress: undefined })
    })
    .finally(() => {
      if (running?.id === next.id) running = null
      pump()
    })
}

function changedNow() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  persist()
  onChanged(tasks)
}

/** Progress ticks are frequent; coalesce them. */
function changedSoon() {
  saveTimer ??= setTimeout(changedNow, 250)
}

function persist() {
  // Keep the file bounded: finished tasks beyond the latest 100 are dropped.
  const keep = tasks.filter((t, i) => i < 100 || (t.status !== 'done' && t.status !== 'cancelled'))
  storage?.writeText(FILE, JSON.stringify(keep, null, 1) + '\n').catch(() => {})
}
