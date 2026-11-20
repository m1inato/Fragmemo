import type { Lang, LangSummary, StudyActivity } from '@fragmemo/core'
import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Topbar } from '../components/Topbar'
import { LANG_LABELS, langHue } from '../lib/format'
import { useShell } from '../lib/shell'

/** 日课: what is left today, a few totals, and the way to add cards. */
export function Home() {
  const { langs, activity } = useShell()
  return (
    <div className="page">
      <Topbar />
      <div className="page-scroll">
        <div className="page-inner daily">
          {langs && <Summary langs={langs} activity={activity} />}
          <section className="section daily-add">
            <div className="section-head"><h2 className="section-title">添加卡片</h2></div>
            <Maker />
          </section>
        </div>
      </div>
    </div>
  )
}

function Summary({ langs, activity }: { langs: LangSummary[]; activity?: StudyActivity }) {
  const { go } = useShell()
  const due = langs.reduce((n, l) => n + l.due, 0)
  const fresh = langs.reduce((n, l) => n + l.fresh, 0)
  const learned = langs.reduce((n, l) => n + l.learned, 0)
  const cards = langs.reduce((n, l) => n + l.cards, 0)
  const left = due + fresh
  const now = new Date()
  const date = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${'日一二三四五六'[now.getDay()]}`
  const ready = langs.filter((l) => l.due + l.fresh > 0)
  const start = (lang: Lang) => go({ name: 'review', scope: { lang }, title: LANG_LABELS[lang] })
  const words = activity?.recent.map((r) => r.term) ?? []
  const stack = words.length >= 3 ? words.slice(0, 3) : ['記憶', 'memory', '習慣']

  return (
    <section className="summary">
      <div className="summary-main">
        <div className="summary-copy">
          <p className="eyebrow">{date}</p>
          <h1>{!langs.length ? '从一套卡组开始' : left ? <>今天还有 <em>{left}</em> 张</> : '今天的复习完成了'}</h1>
          {left > 0 && <p className="summary-sub">待复习 {due} · 新卡 {fresh}</p>}
          <div className="summary-actions">
            {ready.map((l, i) => (
              <button key={l.lang} className={`button button-large${i ? '' : ' button-primary'}`} onClick={() => start(l.lang)}>
                <Icon name="play" size={14} />
                复习{LANG_LABELS[l.lang]}
                <span className="summary-count">{l.due + l.fresh}</span>
              </button>
            ))}
            {!langs.length && (
              <button className="button button-large button-primary" onClick={() => go({ name: 'import' })}>
                <Icon name="download" />
                导入卡组
              </button>
            )}
          </div>
        </div>
        <div className="summary-stack" aria-hidden>
          {stack.map((w, i) => (
            <div key={i} className={`stack-card c${i}`} style={{ '--h': langHue(/[぀-ヿ一-鿿]/.test(w) ? 'ja' : 'en') } as React.CSSProperties}>
              <span>{w}</span>
            </div>
          ))}
        </div>
      </div>
      {langs.length > 0 && (
        <dl className="summary-numbers">
          <div><dt>连续学习</dt><dd>{activity?.streak ?? 0}<small>天</small></dd></div>
          <div><dt>今日复习</dt><dd>{activity?.days.at(-1)?.count ?? 0}<small>次</small></dd></div>
          <div><dt>已学</dt><dd>{learned.toLocaleString()}<small>/ {cards.toLocaleString()}</small></dd></div>
        </dl>
      )}
    </section>
  )
}

function Maker() {
  const { go, openGenerate } = useShell()
  const [request, setRequest] = useState('')
  const submit = () => request.trim() && openGenerate({ request: request.trim() })
  return (
    <div className="maker">
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
    </div>
  )
}
