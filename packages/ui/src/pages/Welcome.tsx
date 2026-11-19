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
        <p className="welcome-lead">把零散的词句，记成长久的记忆。</p>
        <div className="welcome-card">
          <h2>先选一个 Library 文件夹</h2>
          <p>卡组、复习记录和设置都以纯文本保存在这个文件夹里，并用 git 记录每一次改动。选一个空文件夹会新建 Library，选已有的 Library 会直接打开。</p>
          <button className="button button-primary" onClick={choose} disabled={busy}>
            {busy ? '正在打开…' : '选择文件夹'}
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
      </main>
    </div>
  )
}
