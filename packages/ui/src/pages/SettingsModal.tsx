import type { Settings } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AppState, Theme } from '../api'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { applyTheme, THEME_LABELS } from '../lib/theme'

export function SettingsModal({ app, onApp, onClose }: { app: AppState; onApp: (s: AppState) => void; onClose: () => void }) {
  const toast = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    if (app.libraryPath) api.getSettings().then(setSettings)
  }, [app.libraryPath])

  async function setTheme(theme: Theme) {
    applyTheme(theme)
    onApp({ ...app, theme })
    await api.setTheme(theme)
  }

  async function saveReview(patch: Partial<Settings['review']>) {
    setSettings(await api.saveSettings({ review: patch }))
  }

  async function saveFsrs(patch: Partial<Settings['fsrs']>) {
    setSettings(await toast.track(api.saveSettings({ fsrs: patch }), { pending: '正在重新计算复习计划…', done: '已更新' }))
  }

  async function switchLibrary() {
    const s = await api.chooseLibrary().catch((err: Error) => (toast.show(err.message, 'error'), null))
    if (s) {
      onApp(s)
      onClose()
    }
  }

  const t = settings?.review.modeThresholds

  return (
    <Modal title="设置" onClose={onClose}>
      <section className="settings-section">
        <h3>外观</h3>
        <div className="segmented">
          {(Object.keys(THEME_LABELS) as Theme[]).map((th) => (
            <button key={th} className={app.theme === th ? 'active' : ''} onClick={() => setTheme(th)}>{THEME_LABELS[th]}</button>
          ))}
        </div>
      </section>

      {settings && t && (
        <section className="settings-section">
          <h3>复习</h3>
          <div className="settings-grid">
            <NumberField label="每日新卡" value={settings.review.newPerDay} min={0} max={9999} onCommit={(v) => saveReview({ newPerDay: v })} />
            <NumberField label="每日复习上限" value={settings.review.reviewsPerDay} min={0} max={99999} onCommit={(v) => saveReview({ reviewsPerDay: v })} />
            <NumberField label="一天从几点开始" value={settings.review.dayStartHour} min={0} max={23} onCommit={(v) => saveReview({ dayStartHour: v })} />
            <NumberField label="目标记忆率 %" value={Math.round(settings.fsrs.desiredRetention * 100)} min={70} max={99} onCommit={(v) => saveFsrs({ desiredRetention: v / 100 })} />
          </div>
          <p className="settings-hint">作答模式按记忆稳定度自动切换（天）：</p>
          <div className="thresholds">
            <span>选择</span>
            <NumberField value={t[0]} min={0} max={t[1]} onCommit={(v) => saveReview({ modeThresholds: [v, t[1], t[2]] })} />
            <span>听音</span>
            <NumberField value={t[1]} min={t[0]} max={t[2]} onCommit={(v) => saveReview({ modeThresholds: [t[0], v, t[2]] })} />
            <span>翻卡</span>
            <NumberField value={t[2]} min={t[1]} max={3650} onCommit={(v) => saveReview({ modeThresholds: [t[0], t[1], v] })} />
            <span>拼写</span>
          </div>
        </section>
      )}

      <section className="settings-section">
        <h3>Library</h3>
        <p className="settings-path">{app.libraryPath ?? '未选择'}</p>
        <div className="settings-actions">
          <button className="button" onClick={() => api.revealLibrary()}>在 Finder 中显示</button>
          <button className="button" onClick={switchLibrary}>切换 Library</button>
        </div>
      </section>

      <p className="settings-foot">Fragmemo {app.version} · 设备 {app.deviceId}</p>
    </Modal>
  )
}

function NumberField({ label, value, min, max, onCommit }: { label?: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Math.round(Number(draft))
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n)
    else setDraft(String(value))
  }
  const input = (
    <input type="number" value={draft} min={min} max={max} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
  )
  if (!label) return input
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  )
}
