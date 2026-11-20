import { useState } from 'react'
import type { AppState } from '../api'
import { Mark } from '../components/Icon'
import { errorText } from '../components/Toast'
import { api } from '../lib/api'

export function Welcome({ onReady }: { onReady: (s: AppState) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose() {
    setBusy(true)
    setError(null)
    try {
      const s = await api.chooseLibrary()
      if (s) onReady(s)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page welcome">
      <div className="drag-strip" />
      <main className="welcome-main">
        <Mark size={64} />
        <h1 className="welcome-title">Fragmemo</h1>
        <div className="welcome-card">
          <h2>未能打开 Library</h2>
          <button className="button button-primary" onClick={choose} disabled={busy}>
            {busy ? '正在打开…' : '选择文件夹'}
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
      </main>
    </div>
  )
}
