import type { ReviewScope } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AppState } from './api'
import { ToastProvider } from './components/Toast'
import { api } from './lib/api'
import { applyTheme } from './lib/theme'
import { DeckView } from './pages/DeckView'
import { Home } from './pages/Home'
import { Review } from './pages/Review'
import { SettingsModal } from './pages/SettingsModal'
import { Welcome } from './pages/Welcome'

type View = { name: 'home' } | { name: 'deck'; deckId: string } | { name: 'review'; scope: ReviewScope; title: string }

export function App() {
  const [app, setApp] = useState<AppState | null>(null)
  const [view, setView] = useState<View>({ name: 'home' })
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  return (
    <ToastProvider>
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
      {settingsOpen && <SettingsModal app={app} onApp={setApp} onClose={() => setSettingsOpen(false)} />}
    </ToastProvider>
  )
}
