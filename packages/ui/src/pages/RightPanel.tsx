import { Icon } from '../components/Icon'
import { useShell, type Panel } from '../lib/shell'
import { QaPanel } from './SidePanel'
import { TasksPanel } from './Tasks'

const TABS: Record<Panel, string> = { qa: '问答', tasks: 'AI 任务' }

/** The right-hand panel. Both tabs stay mounted so a conversation survives switching to tasks. */
export function RightPanel() {
  const { panel, setPanel, tasks } = useShell()
  const busy = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length
  return (
    <aside className="panel">
      <header className="panel-header">
        <div className="segmented">
          {(Object.keys(TABS) as Panel[]).map((p) => (
            <button key={p} className={panel === p ? 'active' : ''} onClick={() => setPanel(p)}>
              {TABS[p]}
              {p === 'tasks' && busy > 0 && <span className="count">{busy}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="icon-button" title="关闭" onClick={() => setPanel(null)}>
          <Icon name="x" />
        </button>
      </header>
      <div className="panel-tab" hidden={panel !== 'qa'}>
        <QaPanel />
      </div>
      <div className="panel-tab" hidden={panel !== 'tasks'}>
        <TasksPanel />
      </div>
    </aside>
  )
}
