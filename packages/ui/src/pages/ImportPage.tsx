import type { DeckSummary } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { PresetInfo } from '../api'
import { DeckCover } from '../components/DeckCard'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { Topbar } from '../components/Topbar'
import { api } from '../lib/api'
import { LANG_LABELS, langHue } from '../lib/format'
import { useShell, type ImportSource, type View } from '../lib/shell'
import { useAsync } from '../lib/useAsync'
import { Generate } from './Generate'

const SOURCES: { id: ImportSource; label: string }[] = [
  { id: 'presets', label: '预设卡包' },
  { id: 'anki', label: 'Anki 卡包文件' },
  { id: 'text', label: '粘贴文本' }
]

export function ImportPage({ view, onImported }: { view: Extract<View, { name: 'import' }>; onImported: (deckId: string) => void }) {
  const { setPanel } = useShell()
  const [source, setSource] = useState<ImportSource>(view.source ?? 'presets')

  return (
    <div className="page">
      <Topbar />
      <div className="page-scroll">
        <main className="page-inner">
          <section className="hero import-hero">
            <div>
              <h1>导入</h1>
              <p className="stats">现成的卡包、自己的 Anki 卡包，或者一段原文交给 AI 整理。</p>
            </div>
            <div className="segmented" role="tablist" aria-label="导入来源">
              {SOURCES.map((s) => (
                <button key={s.id} role="tab" className={source === s.id ? 'active' : ''} aria-selected={source === s.id} onClick={() => setSource(s.id)}>{s.label}</button>
              ))}
            </div>
          </section>
          {source === 'presets' && <Presets onImported={onImported} />}
          {source === 'anki' && <AnkiImport onImported={onImported} />}
          <div hidden={source !== 'text'}>
            <div className="import-note">
              <Icon name="sparkles" />
              <p>一行一个词组，或者直接粘贴文章、歌词、对话。AI 会挑出值得学的词和语法，检查后写进卡组，可以整批撤销。</p>
            </div>
            <Generate preset={{ tab: 'extract-from-text', lang: view.lang, text: view.text }} onCreated={() => setPanel('tasks')} />
          </div>
        </main>
      </div>
    </div>
  )
}

function Presets({ onImported }: { onImported: (deckId: string) => void }) {
  const { langs, go } = useShell()
  const toast = useToast()
  const { data: presets, reload } = useAsync(() => api.listPresets(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const decks = (langs ?? []).flatMap((l) => l.decks)

  useEffect(() => {
    return api.onPresetProgress((e) => setProgress((p) => ({ ...p, [e.id]: e.received / e.total })))
  }, [])

  async function run(p: PresetInfo) {
    setBusy(p.id)
    try {
      const result = await toast.track(api.importPreset(p.id, false), {
        pending: p.downloaded ? '正在导入…' : '正在下载，下载完会自动导入…',
        done: (r) => `导入完成：新增 ${r.added} 条，更新 ${r.updated} 条`
      }).catch(() => null)
      if (result) onImported(result.deck.id)
    } finally {
      setBusy(null)
      reload()
    }
  }

  return (
    <div className="preset-grid">
      {presets?.map((p) => {
        const have = decks.find((d) => d.name === p.name)
        const pct = progress[p.id]
        const cover = { lang: p.lang, sample: p.lang === 'ja' ? '言葉' : 'word' } as DeckSummary
        return (
          <article key={p.id} className="card preset" style={{ '--h': langHue(p.lang) } as React.CSSProperties}>
            <DeckCover deck={cover} />
            <div className="preset-body">
              <h3>{p.name}</h3>
              <p className="preset-desc">{p.description}</p>
              <div className="chips">
                <span className="chip tint">{LANG_LABELS[p.lang]}</span>
                <span className="chip num">{p.notes.toLocaleString()} 条</span>
                <span className="chip num">{p.downloaded ? '已下载' : `${Math.round(p.bytes / 1e6)} MB`}</span>
              </div>
              {busy === p.id && !p.downloaded && (
                <div className="preset-progress">
                  <span className="progress"><span style={{ width: `${Math.round((pct ?? 0) * 100)}%` }} /></span>
                  <small className="num">{pct === undefined ? '连接中…' : pct >= 1 ? '正在导入…' : `${Math.round(pct * 100)}%`}</small>
                </div>
              )}
              <div className="preset-actions">
                {have && <button className="button" onClick={() => go({ name: 'deck', deckId: have.id })}>打开卡组</button>}
                <button className={`button${have ? '' : ' button-primary'}`} disabled={!!busy} onClick={() => run(p)}>
                  <Icon name={p.downloaded ? 'layers' : 'download'} />
                  {busy === p.id ? '处理中…' : have ? '重新导入' : p.downloaded ? '导入' : '下载并导入'}
                </button>
              </div>
            </div>
          </article>
        )
      })}
      <p className="preset-foot faint">卡包来自社区分享，按需从 GitHub 下载，下载后校验完整性。导入后和自己的卡组一样，可以改名、编辑、交给 AI 转成标准卡片。</p>
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
    <section className="card anki-drop">
      <div className="anki-icon"><Icon name="file" size={26} /></div>
      <h3>选择 .apkg 或 .colpkg 文件</h3>
      <p className="muted">保留原来的模板、图片和音频；再次导入同一个卡包会更新卡片，不会重复。</p>
      <label className="check">
        <input type="checkbox" checked={withHistory} disabled={busy} onChange={(e) => setWithHistory(e.target.checked)} />
        同时导入复习记录，接着 Anki 的进度学
      </label>
      <button className="button button-primary button-large" onClick={run} disabled={busy}>
        <Icon name="folder" />
        {busy ? '正在导入…' : '选择文件'}
      </button>
    </section>
  )
}
