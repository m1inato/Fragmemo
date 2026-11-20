import type { Settings } from '@fragmemo/core'
import { useEffect, useState } from 'react'
import type { AppState, Palette, Theme } from '../api'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { useShell } from '../lib/shell'
import { PALETTE_LABELS, THEME_LABELS } from '../lib/theme'
import { AiSection, ProfileSection } from './AiSettings'

export function SettingsModal({ app, onApp, onClose }: { app: AppState; onApp: (s: AppState) => void; onClose: () => void }) {
  const toast = useToast()
  const { setTheme, setPalette } = useShell()
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    if (app.libraryPath) api.getSettings().then(setSettings)
  }, [app.libraryPath])

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
    <Modal title="设置" onClose={onClose} wide className="preferences">
      <AiSection />
      <section className="settings-section preference-group">
        <h3>词库</h3>
        <div className="library-preference">
          <p className="settings-path" title={app.libraryPath ?? undefined}>{app.libraryPath ?? '未选择'}</p>
          <button className="button button-small" onClick={switchLibrary}>更改</button>
          <button className="button button-small" onClick={() => api.revealLibrary()}>显示于 Finder</button>
        </div>
      </section>
      <section className="settings-section preference-group">
        <h3>外观</h3>
        <div className="appearance">
          <div className="preference-line">
            <span>主题</span>
            <div className="segmented">
              {(Object.keys(THEME_LABELS) as Theme[]).map(th => (
                <button key={th} className={app.theme === th ? 'active' : ''} aria-pressed={app.theme === th} onClick={() => setTheme(th)}>{THEME_LABELS[th]}</button>
              ))}
            </div>
          </div>
          <div className="preference-line">
            <span>主题色</span>
            <div className="swatches">
              {(Object.keys(PALETTE_LABELS) as Palette[]).map((p) => (
                <button key={p} className={`swatch swatch-${p}${app.palette === p ? ' active' : ''}`} aria-pressed={app.palette === p} title={PALETTE_LABELS[p]} onClick={() => setPalette(p)}>
                  <i />
                  {PALETTE_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      {settings && t && (
        <section className="settings-section preference-group">
          <h3>复习</h3>
          <div className="review-preferences">
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
          </div>
        </section>
      )}

      {app.libraryPath && <ProfileSection />}
      <p className="settings-foot">Fragmemo {app.version}</p>
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
