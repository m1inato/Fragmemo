import { TASK_LABELS } from '@fragmemo/ai'
import { answerText, noteTitle } from '@fragmemo/core'
import type { TaskAction, TaskRecord } from '../api'
import { errorText, useToast } from '../components/Toast'
import { api } from '../lib/api'
import { useShell } from '../lib/shell'

const STATUS: Record<TaskRecord['status'], string> = {
  queued: '排队中', running: '进行中', paused: '已暂停', done: '完成', failed: '失败', cancelled: '已取消'
}

export function Tasks() {
  const { tasks, setPanel } = useShell()
  return (
    <aside className="panel" aria-label="任务">
      <header className="panel-header">
        <h2>任务</h2>
        <button className="icon-button" onClick={() => setPanel(null)} aria-label="关闭">✕</button>
      </header>
      <div className="panel-body">
        {!tasks.length && <p className="panel-empty">还没有任务。点「AI 生成」开始。</p>}
        {tasks.map((t) => <TaskItem key={t.id} task={t} />)}
      </div>
    </aside>
  )
}

function TaskItem({ task }: { task: TaskRecord }) {
  const toast = useToast()
  const act = (action: TaskAction) => api.taskAction(task.id, action).catch((e) => toast.show(errorText(e), 'error'))
  const r = task.result
  const busy = task.status === 'running'
  const progress = task.progress ?? -1

  return (
    <article className={`task task-${task.status}`}>
      <div className="task-head">
        <span className="task-kind">{TASK_LABELS[task.kind]}</span>
        <span className="task-status">{STATUS[task.status]}</span>
      </div>
      <p className="task-title">{task.title}</p>

      {busy && (
        <>
          <div className={`task-bar${progress < 0 ? ' is-indeterminate' : ''}`}>
            <span style={progress >= 0 ? { width: `${Math.round(progress * 100)}%` } : undefined} />
          </div>
          {task.stage && <p className="task-stage">{task.stage}</p>}
        </>
      )}
      {task.error && <p className="task-error">{task.error}</p>}
      {r && <p className="task-summary">{r.summary}</p>}

      {r && r.pending.length > 0 && !r.undone && <Pending task={task} />}

      <div className="task-actions">
        {(task.status === 'queued' || busy) && <button className="button button-small" onClick={() => act('pause')}>暂停</button>}
        {task.status === 'paused' && <button className="button button-small" onClick={() => act('resume')}>继续</button>}
        {(task.status === 'failed' || task.status === 'cancelled') && <button className="button button-small" onClick={() => act('retry')}>重试</button>}
        {(task.status === 'queued' || busy || task.status === 'paused') && <button className="button button-small" onClick={() => act('cancel')}>取消</button>}
        {task.status === 'done' && r && r.applied > 0 && !r.undone && (
          <button className="button button-small" onClick={() => toast.track(api.taskAction(task.id, 'undo'), { pending: '正在撤销…', done: '已撤销这一批' }).catch(() => {})}>
            整批撤销
          </button>
        )}
        {!busy && <button className="button button-small button-ghost" onClick={() => act('remove')}>移除</button>}
      </div>
    </article>
  )
}

function Pending({ task }: { task: TaskRecord }) {
  const toast = useToast()
  const pending = task.result!.pending
  const resolve = (ids: string[], accept: boolean) =>
    api.resolvePending(task.id, ids, accept).catch((e) => toast.show(errorText(e), 'error'))

  return (
    <div className="pending">
      <div className="pending-head">
        <span>待确认 {pending.length} 条：没通过检查，要不要还是加进去？</span>
        {pending.length > 1 && (
          <span className="pending-all">
            <button className="link" onClick={() => resolve(pending.map((p) => p.proposal.note.id), true)}>全部加入</button>
            <button className="link" onClick={() => resolve(pending.map((p) => p.proposal.note.id), false)}>全部丢弃</button>
          </span>
        )}
      </div>
      {pending.map(({ proposal, issues }) => (
        <div key={proposal.note.id} className="pending-item">
          <div className="pending-note">
            <strong>{noteTitle(proposal.note)}</strong>
            <span>{answerText(proposal.note, 0)}</span>
            {!proposal.isNew && <em>修改</em>}
          </div>
          <ul className="pending-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          <div className="pending-actions">
            <button className="button button-small" onClick={() => resolve([proposal.note.id], false)}>丢弃</button>
            <button className="button button-small button-primary" onClick={() => resolve([proposal.note.id], true)}>加入</button>
          </div>
        </div>
      ))}
    </div>
  )
}
