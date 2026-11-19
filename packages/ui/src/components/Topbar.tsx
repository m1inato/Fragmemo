import { useId, useRef, useState, type ReactNode } from 'react'
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

const PAGES = [
  { name: 'home', label: '今天' },
  { name: 'library', label: '卡组' },
  { name: 'import', label: '导入词组' }
] as const

export function MainTopbar() {
  const { view, go } = useShell()
  const active = view.name === 'deck' ? 'library' : view.name
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)

  function close(restoreFocus = false) {
    if (restoreFocus) trigger.current?.focus()
    setOpen(false)
  }

  return (
    <Topbar
      center={
        <nav
          className="main-nav"
          aria-label="页面导航"
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true) }}
          onPointerLeave={(e) => { if (!e.currentTarget.querySelector(':focus-visible')) close() }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) close() }}
          onKeyDown={(e) => {
            if (open && e.key === 'Escape') {
              e.stopPropagation()
              close(true)
            }
          }}
        >
          <button
            ref={trigger}
            className="nav-trigger"
            aria-label="切换页面"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen(true)}
          >
            <span />
          </button>
          <div id={menuId} className="segmented nav-pages" hidden={!open}>
            {PAGES.map(({ name, label }) => (
              <button
                key={name}
                className={active === name ? 'active' : ''}
                aria-current={active === name ? 'page' : undefined}
                onClick={(e) => {
                  if (view.name !== name) go({ name })
                  close(e.detail === 0)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      }
    />
  )
}

/** Draggable bar over the page. `inset` leaves room for the traffic lights when there is no sidebar. */
export function Topbar({ left, center, right, inset }: { left?: ReactNode; center?: ReactNode; right?: ReactNode; inset?: boolean }) {
  return (
    <header className={`topbar${inset ? ' topbar-inset' : ''}`}>
      <div className="topbar-side">{left}</div>
      <div className="topbar-center">{center}</div>
      <div className="topbar-side topbar-actions">{right ?? <TopActions />}</div>
    </header>
  )
}

/** The page-independent actions: Q&A, tasks, theme, settings. */
export function TopActions() {
  const { tasks, panel, setPanel, openSettings } = useShell()
  const busy = tasks.some((t) => t.status === 'running' || t.status === 'queued')
  const waiting = tasks.some((t) => (t.result?.pending.length ?? 0) > 0 && !t.result?.undone)
  return (
    <>
      <button className={`icon-button bordered${panel === 'qa' ? ' active' : ''}`} title="问答" onClick={() => setPanel(panel === 'qa' ? null : 'qa')}>
        <Icon name="chat" />
      </button>
      <button className={`icon-button bordered${panel === 'tasks' ? ' active' : ''}`} title="AI 任务" onClick={() => setPanel(panel === 'tasks' ? null : 'tasks')}>
        <Icon name="list" />
        {(busy || waiting) && <span className={`dot${busy ? ' dot-busy' : ''}`} />}
      </button>
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
