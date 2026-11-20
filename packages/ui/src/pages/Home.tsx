import type { Lang } from '@fragmemo/core'
import { useState } from 'react'
import { Heatmap } from '../components/Heatmap'
import { Icon, Mark } from '../components/Icon'
import { TopActions } from '../components/Topbar'
import { LANG_LABELS } from '../lib/format'
import { useShell } from '../lib/shell'

/** The home page, entered from the brand: no sidebar, today's count set large, the year of reviews, the maker. */
export function Home() {
  const { langs, activity, go } = useShell()
  const all = langs ?? []
  const due = all.reduce((n, l) => n + l.due, 0)
  const fresh = all.reduce((n, l) => n + l.fresh, 0)
  const learned = all.reduce((n, l) => n + l.learned, 0)
  const cards = all.reduce((n, l) => n + l.cards, 0)
  const left = due + fresh
  const now = new Date()
  const date = `${now.getMonth() + 1} 月 ${now.getDate()} 日  星期${'日一二三四五六'[now.getDay()]}`
  const start = (lang: Lang) => go({ name: 'review', scope: { lang }, title: LANG_LABELS[lang] })

  return (
    <div className="page home-page">
      <header className="topbar home-topbar">
        <div className="topbar-side" />
        <div className="topbar-center"><SpaceSwitch /></div>
        <div className="topbar-side topbar-actions"><TopActions /></div>
      </header>
      <div className="page-scroll">
        <main className="home">
          {langs && (
            <section className="home-hero">
              <p className="home-date">{date}</p>
              {!all.length ? (
                <p className="home-quiet">从一套卡组开始</p>
              ) : left ? (
                <p className="home-count">
                  <b>{left}</b>
                  <span>张待复习</span>
                </p>
              ) : (
                <p className="home-quiet">今天的复习完成了</p>
              )}
              {left > 0 && <p className="home-split">待复习 {due} · 新卡 {fresh}</p>}
              <div className="home-actions">
                {all.filter((l) => l.due + l.fresh > 0).map((l, i) => (
                  <button key={l.lang} className={`button button-large${i ? '' : ' button-primary'}`} onClick={() => start(l.lang)}>
                    <Icon name="play" size={14} />
                    复习{LANG_LABELS[l.lang]}
                    <span className="home-badge">{l.due + l.fresh}</span>
                  </button>
                ))}
                {!all.length && (
                  <button className="button button-large button-primary" onClick={() => go({ name: 'import' })}>
                    <Icon name="download" />
                    导入卡组
                  </button>
                )}
              </div>
            </section>
          )}

          {activity && all.length > 0 && (
            <section className="card home-record">
              <dl className="home-numbers">
                <div><dt>连续学习</dt><dd>{activity.streak}<small>天</small></dd></div>
                <div><dt>今日复习</dt><dd>{activity.days.at(-1)?.count ?? 0}<small>次</small></dd></div>
                <div><dt>已学</dt><dd>{learned.toLocaleString()}<small>/ {cards.toLocaleString()} 张</small></dd></div>
              </dl>
              <Heatmap days={activity.days} />
            </section>
          )}

          <Maker />
        </main>
      </div>
    </div>
  )
}

/** Home, decks and import, centred in the top bar while the sidebar is away. */
function SpaceSwitch() {
  const { go } = useShell()
  return (
    <nav className="segmented space-switch" aria-label="页面">
      <button className="active" aria-current="page" title="主页"><Mark size={18} /></button>
      <button onClick={() => go({ name: 'library' })}>卡组</button>
      <button onClick={() => go({ name: 'import' })}>导入</button>
    </nav>
  )
}

function Maker() {
  const { go, openGenerate } = useShell()
  const [request, setRequest] = useState('')
  const submit = () => request.trim() && openGenerate({ request: request.trim() })
  return (
    <section className="maker">
      <label className="maker-input">
        <Icon name="sparkles" size={18} />
        <input className="bare" value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="想学什么？例如：N3 里描述情绪的形容词" />
      </label>
      <button className="button button-primary maker-go" disabled={!request.trim()} onClick={submit}>AI 制卡</button>
      <button className="button maker-go" onClick={() => go({ name: 'import' })}>
        <Icon name="download" />
        导入
      </button>
    </section>
  )
}
