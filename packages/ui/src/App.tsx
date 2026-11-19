import type { Lang } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AppState, TaskRecord, Theme } from './api'
import { Sidebar } from './components/Sidebar'
import { ToastProvider } from './components/Toast'
import { api } from './lib/api'
import { ShellContext, type GeneratePreset, type Shell, type View } from './lib/shell'
import { applyTheme } from './lib/theme'
import { useAsync } from './lib/useAsync'
import { DeckView } from './pages/DeckView'
import { Generate } from './pages/Generate'
import { Home } from './pages/Home'
import { CreateDeckDialog, ImportDialog } from './pages/LibraryDialogs'
import { RightPanel } from './pages/RightPanel'
import { Review } from './pages/Review'
import { SettingsModal } from './pages/SettingsModal'
import { Welcome } from './pages/Welcome'

type Dialog = { name: 'generate'; preset: GeneratePreset } | { name: 'import' } | { name: 'create'; lang?: Lang } | { name: 'settings' }

export function App() {
  const [app, setApp] = useState<AppState | null>(null)
  const [view, setView] = useState<View>({ name: 'home' })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [panel, setPanel] = useState<Shell['panel']>(null)
  // Bumped on library:changed so pages refetch.
  const [version, setVersion] = useState(0)
  const { data: langs } = useAsync(() => (app?.libraryPath ? api.overview() : Promise.resolve(undefined)), [version, app?.libraryPath])

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
        setDialog({ name: 'settings' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!app) return <div className="app-loading" />

  const setTheme = (theme: Theme) => {
    applyTheme(theme)
    setApp({ ...app, theme })
    api.setTheme(theme)
  }

  const shell: Shell = {
    view,
    go: setView,
    langs,
    version,
    tasks,
    panel,
    setPanel,
    openGenerate: (preset = {}) => setDialog({ name: 'generate', preset }),
    openImport: () => setDialog({ name: 'import' }),
    openCreateDeck: (lang) => setDialog({ name: 'create', lang }),
    openSettings: () => setDialog({ name: 'settings' }),
    theme: app.theme,
    setTheme
  }
  const close = () => setDialog(null)
  const reviewing = view.name === 'review'

  return (
    <ToastProvider>
      <ShellContext.Provider value={shell}>
        {!app.libraryPath ? (
          <Welcome onReady={setApp} />
        ) : (
          <div className="app">
            {!reviewing && <Sidebar />}
            <div className="main">
              {view.name === 'review' ? (
                <Review scope={view.scope} title={view.title} onExit={() => setView({ name: 'home' })} />
              ) : view.name === 'deck' ? (
                <DeckView key={view.deckId} deckId={view.deckId} />
              ) : (
                <Home />
              )}
            </div>
            {panel && !reviewing && <RightPanel />}
          </div>
        )}
        {dialog?.name === 'generate' && <Generate preset={dialog.preset} onClose={close} onCreated={() => setPanel('tasks')} />}
        {dialog?.name === 'import' && <ImportDialog onClose={close} onImported={(deckId) => setView({ name: 'deck', deckId })} />}
        {dialog?.name === 'create' && <CreateDeckDialog lang={dialog.lang} onClose={close} onCreated={(deckId) => setView({ name: 'deck', deckId })} />}
        {dialog?.name === 'settings' && <SettingsModal app={app} onApp={setApp} onClose={close} />}
      </ShellContext.Provider>
    </ToastProvider>
  )
}
