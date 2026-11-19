import type { ReviewScope } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AppState, TaskRecord } from './api'
import { ToastProvider } from './components/Toast'
import { api } from './lib/api'
import { ShellContext, type GeneratePreset, type Shell } from './lib/shell'
import { applyTheme } from './lib/theme'
import { DeckView } from './pages/DeckView'
import { Generate } from './pages/Generate'
import { Home } from './pages/Home'
import { Review } from './pages/Review'
import { SettingsModal } from './pages/SettingsModal'
import { SidePanel } from './pages/SidePanel'
import { Tasks } from './pages/Tasks'
import { Welcome } from './pages/Welcome'

type View = { name: 'home' } | { name: 'deck'; deckId: string } | { name: 'review'; scope: ReviewScope; title: string }

export function App() {
  const [app, setApp] = useState<AppState | null>(null)
  const [view, setView] = useState<View>({ name: 'home' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [panel, setPanel] = useState<Shell['panel']>(null)
  const [generate, setGenerate] = useState<GeneratePreset | null>(null)
  // Bumped on library:changed so pages refetch.
  const [version, setVersion] = useState(0)

  useEffect(() => {
    api.getApp().then((s) => {
      applyTheme(s.theme)
      setApp(s)
    })
    return api.onLibraryChanged(() => {
      api.getApp().then(setApp)
      setVersion((v) => v + 1)
    })
  }, [])

  useEffect(() => {
    if (!app?.libraryPath) return
    api.listTasks().then(setTasks)
    return api.onTasksChanged((list) => setTasks([...list]))
  }, [app?.libraryPath])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!app) return <div className="app-loading" />

  const shell: Shell = { tasks, panel, setPanel, openGenerate: (preset = {}) => setGenerate(preset) }
  const reviewing = view.name === 'review'

  return (
    <ToastProvider>
      <ShellContext.Provider value={shell}>
        <div className={`shell${panel && !reviewing ? ' has-panel' : ''}`}>
          <div className="shell-main">
            {!app.libraryPath ? (
              <Welcome onReady={setApp} />
            ) : view.name === 'review' ? (
              <Review scope={view.scope} title={view.title} onExit={() => setView({ name: 'home' })} />
            ) : view.name === 'deck' ? (
              <DeckView
                deckId={view.deckId}
                version={version}
                onBack={() => setView({ name: 'home' })}
                onReview={(scope, title) => setView({ name: 'review', scope, title })}
              />
            ) : (
              <Home
                version={version}
                onOpenDeck={(deckId) => setView({ name: 'deck', deckId })}
                onReview={(scope, title) => setView({ name: 'review', scope, title })}
                onSettings={() => setSettingsOpen(true)}
              />
            )}
          </div>
          {app.libraryPath && !reviewing && panel === 'tasks' && <Tasks />}
          {app.libraryPath && !reviewing && panel === 'qa' && <SidePanel />}
        </div>
        {generate && <Generate preset={generate} onClose={() => setGenerate(null)} onCreated={() => setPanel('tasks')} />}
        {settingsOpen && <SettingsModal app={app} onApp={setApp} onClose={() => setSettingsOpen(false)} />}
      </ShellContext.Provider>
    </ToastProvider>
  )
}
