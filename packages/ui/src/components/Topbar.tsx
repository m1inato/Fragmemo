import type { ReactNode } from 'react'
import type { Theme } from '../api'
import { useShell } from '../lib/shell'
import { THEME_LABELS } from '../lib/theme'
import { Icon, type IconName } from './Icon'

const THEMES: { id: Theme; icon: IconName }[] = [
  { id: 'system', icon: 'monitor' },
  { id: 'light', icon: 'sun' },
  { id: 'dark', icon: 'moon' },
  { id: 'sepia', icon: 'leaf' }
]

/** Draggable bar over a page: optional back button and title, page-independent actions on the right. */
export function Topbar({ left, title, right, inset }: { left?: ReactNode; title?: ReactNode; right?: ReactNode; inset?: boolean }) {
  return (
    <header className={`topbar${inset ? ' topbar-inset' : ''}`}>
      <div className="topbar-side">{left}</div>
      <div className="topbar-center">{title && <span className="topbar-title">{title}</span>}</div>
      <div className="topbar-side topbar-actions">{right ?? <TopActions />}</div>
    </header>
  )
}

/** Notes, Q&A, tasks, theme, settings. */
export function TopActions() {
  const { tasks, panel, setPanel, openSettings } = useShell()
  const busy = tasks.some((t) => t.status === 'running' || t.status === 'queued')
  const waiting = tasks.some((t) => (t.result?.pending.length ?? 0) > 0 && !t.result?.undone)
  const toggle = (p: NonNullable<typeof panel>) => setPanel(panel === p ? null : p)
  return (
    <>
      <button className={`icon-button bordered${panel === 'notes' ? ' active' : ''}`} title="笔记" aria-pressed={panel === 'notes'} onClick={() => toggle('notes')}>
        <Icon name="edit" />
      </button>
      <button className={`icon-button bordered${panel === 'qa' ? ' active' : ''}`} title="问答" aria-pressed={panel === 'qa'} onClick={() => toggle('qa')}>
        <Icon name="chat" />
      </button>
      <button className={`icon-button bordered${panel === 'tasks' ? ' active' : ''}`} title="AI 任务" aria-pressed={panel === 'tasks'} onClick={() => toggle('tasks')}>
        <Icon name="sparkles" />
        {(busy || waiting) && <span className={`dot${busy ? ' dot-busy' : ''}`} />}
      </button>
      <span className="topbar-divider" />
      <ThemeButton />
      <button className="icon-button bordered" title="设置 (⌘,)" onClick={openSettings}>
        <Icon name="settings" />
      </button>
    </>
  )
}

export function ThemeButton() {
  const { theme, setTheme } = useShell()
  const i = Math.max(0, THEMES.findIndex((t) => t.id === theme))
  return (
    <button className="icon-button bordered" title={`主题：${THEME_LABELS[THEMES[i].id]}`} onClick={() => setTheme(THEMES[(i + 1) % THEMES.length].id)}>
      <Icon name={THEMES[i].icon} />
    </button>
  )
}
