import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { useShell, type ImportPreset } from '../lib/shell'
import { Generate } from './Generate'

export function ImportPage({ preset, onImported }: { preset?: ImportPreset; onImported: (deckId: string) => void }) {
  const { setPanel } = useShell()
  const [source, setSource] = useState<'text' | 'anki'>('text')

  return (
    <div className="page">
      <div className="page-scroll">
        <main className="page-inner import-page">
          <div className="hero import-heading">
            <h1>导入词组</h1>
            <div className="segmented" role="group" aria-label="导入来源">
              <button className={source === 'text' ? 'active' : ''} aria-pressed={source === 'text'} onClick={() => setSource('text')}>粘贴文本</button>
              <button className={source === 'anki' ? 'active' : ''} aria-pressed={source === 'anki'} onClick={() => setSource('anki')}>Anki 卡包</button>
            </div>
          </div>
          <div hidden={source !== 'text'}>
            <Generate preset={{ ...preset, tab: 'extract-from-text' }} onCreated={() => setPanel('tasks')} />
          </div>
          <div hidden={source !== 'anki'}>
            <AnkiImport onImported={onImported} />
          </div>
        </main>
      </div>
    </div>
  )
}

function AnkiImport({ onImported }: { onImported: (deckId: string) => void }) {
  const toast = useToast()
  const [withHistory, setWithHistory] = useState(true)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const result = await toast.track(api.importApkg({ withHistory }), {
        pending: '正在导入…',
        done: (r) => (r ? `导入完成：新增 ${r.added} 条，更新 ${r.updated} 条` : null)
      }).catch(() => null)
      if (result) onImported(result.deck.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card import-card" aria-label="导入 Anki 卡包">
      <p className="muted">支持 .apkg 和 .colpkg，保留原模板、图片和音频。</p>
      <div className="import-actions">
        <label className="check">
          <input type="checkbox" checked={withHistory} disabled={busy} onChange={(e) => setWithHistory(e.target.checked)} />
          同时导入复习记录
        </label>
        <button className="button button-primary" onClick={run} disabled={busy}>
          <Icon name="folder" />
          {busy ? '正在导入…' : '选择 Anki 卡包'}
        </button>
      </div>
    </section>
  )
}
