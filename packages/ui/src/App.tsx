import type { Lang } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AppState, TaskRecord, Theme } from './api'
import { Sidebar } from './components/Sidebar'
import { ToastProvider } from './components/Toast'
import { api } from './lib/api'
import { ACTIVITY_DAYS, ShellContext, type GeneratePreset, type Shell, type View } from './lib/shell'
import { applyTheme } from './lib/theme'
import { useAsync } from './lib/useAsync'
import { DeckView } from './pages/DeckView'
import { Generate } from './pages/Generate'
import { Home } from './pages/Home'
import { ImportPage } from './pages/ImportPage'
import { Library } from './pages/Library'
import { CreateDeckDialog } from './pages/LibraryDialogs'
import { RightPanel } from './pages/RightPanel'
import { Review } from './pages/Review'
import { SettingsModal } from './pages/SettingsModal'
import { Welcome } from './pages/Welcome'

type Dialog = { name: 'generate'; preset: GeneratePreset } | { name: 'create'; lang?: Lang } | { name: 'settings' }

export function App() {
  const [app, setApp] = useState<AppState | null>(null)
  const [view, setView] = useState<View>({ name: 'home' })
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [panel, setPanel] = useState<Shell['panel']>(null)
  // Bumped on library:changed so pages refetch.
  const [version, setVersion] = useState(0)
  const open = !!app?.libraryPath
  const { data: langs } = useAsync(() => (open ? api.overview() : Promise.resolve(undefined)), [version, open])
  const { data: activity } = useAsync(() => (open ? api.studyActivity(ACTIVITY_DAYS) : Promise.resolve(undefined)), [version, open])

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
    if (!open) return
    api.listTasks().then(setTasks)
    return api.onTasksChanged((list) => setTasks([...list]))
  }, [open])

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

  const shell: Shell = {
    view,
    go: setView,
    langs,
    activity,
    version,
    refresh: () => setVersion((v) => v + 1),
    tasks,
    panel,
    setPanel,
    openGenerate: (preset = {}) => setDialog({ name: 'generate', preset }),
    openCreateDeck: (lang) => setDialog({ name: 'create', lang }),
    openSettings: () => setDialog({ name: 'settings' }),
    mac: app.platform === 'darwin',
    theme: app.theme,
    setTheme: (theme: Theme) => {
      applyTheme(theme)
      setApp({ ...app, theme })
      api.setTheme(theme)
    }
  }
  const close = () => setDialog(null)
  const reviewing = view.name === 'review'

  return (
    <ToastProvider>
      <ShellContext.Provider value={shell}>
        {!open ? (
          <Welcome onReady={setApp} />
        ) : reviewing ? (
          <Review
            scope={view.scope}
            title={view.title}
            onExit={() => {
              setVersion((v) => v + 1)
              setView(view.scope.deckIds?.length === 1 ? { name: 'deck', deckId: view.scope.deckIds[0] } : { name: 'home' })
            }}
          />
        ) : (
          <div className={`app${app.platform === 'darwin' ? ' is-mac' : ''}`}>
            <Sidebar />
            <div className="main">
              {view.name === 'home' && <Home />}
              {view.name === 'library' && <Library />}
              {view.name === 'deck' && <DeckView key={view.deckId} deckId={view.deckId} />}
              {view.name === 'import' && (
                <ImportPage
                  key={`${view.source ?? ''}:${view.text ?? ''}`}
                  view={view}
                  onImported={(deckId) => setView((current) => (current === view ? { name: 'deck', deckId } : current))}
                />
              )}
            </div>
            {panel && <RightPanel key={app.libraryPath} root={app.libraryPath!} />}
          </div>
        )}
        {dialog?.name === 'generate' && <Generate preset={dialog.preset} onClose={close} onCreated={() => setPanel('tasks')} />}
        {dialog?.name === 'create' && <CreateDeckDialog lang={dialog.lang} onClose={close} onCreated={(deckId) => setView({ name: 'deck', deckId })} />}
        {dialog?.name === 'settings' && <SettingsModal app={app} onApp={setApp} onClose={close} />}
      </ShellContext.Provider>
    </ToastProvider>
  )
}
