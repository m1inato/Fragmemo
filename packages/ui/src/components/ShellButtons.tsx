import { useShell } from '../lib/shell'

/** Title-bar entries to the AI features, shared by the pages that show them. */
export function ShellButtons() {
  const { tasks, panel, setPanel, openGenerate } = useShell()
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length
  const waiting = tasks.reduce((n, t) => n + (t.result?.pending.length ?? 0), 0)
  return (
    <>
      <button className="button button-ghost" onClick={() => openGenerate()}>AI 生成</button>
      <button className={`button button-ghost${panel === 'tasks' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'tasks' ? null : 'tasks')}>
        任务
        {active > 0 && <span className="badge badge-busy">{active}</span>}
        {!active && waiting > 0 && <span className="badge">{waiting}</span>}
      </button>
      <button className={`button button-ghost${panel === 'qa' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'qa' ? null : 'qa')}>问答</button>
    </>
  )
}
