import type { Lang, LangSummary } from '@fragmemo/core'
import { useState } from 'react'
import { DeckCard } from '../components/DeckCard'
import { Heatmap } from '../components/Heatmap'
import { Icon, type IconName } from '../components/Icon'
import { Topbar } from '../components/Topbar'
import { LANG_LABELS, langHue } from '../lib/format'
import { useShell } from '../lib/shell'

export function Home() {
  const { langs, activity, go, openGenerate, openCreateDeck } = useShell()
  const all = langs ?? []
  const decks = all.flatMap((l) => l.decks)
  const sum = (k: 'due' | 'fresh' | 'learned' | 'cards') => all.reduce((n, l) => n + l[k], 0)
  const recent = activity?.recent ?? []
  const month = activity?.days.slice(-30).reduce((n, d) => n + d.count, 0) ?? 0

  const tiles: { icon: IconName; value: string | number; label: string }[] = [
    { icon: 'flame', value: activity?.streak ?? 0, label: '连续学习（天）' },
    { icon: 'check', value: activity?.days.at(-1)?.count ?? 0, label: '今日复习' },
    { icon: 'calendar', value: month, label: '近 30 天复习' },
    { icon: 'book', value: `${sum('learned').toLocaleString()}`, label: `已学 / 共 ${sum('cards').toLocaleString()} 张` }
  ]

  return (
    <div className="page">
      <Topbar />
      <div className="page-scroll">
        <div className="page-inner">
          {langs && <TodayBanner langs={all} words={recent.map((r) => r.term)} />}

          {decks.length > 0 && (
            <section className="section">
              <div className="section-head"><h2 className="section-title">学习记录</h2></div>
              <div className="stat-tiles">
                {tiles.map((t) => (
                  <div key={t.label} className="card stat-tile">
                    <Icon name={t.icon} size={18} />
                    <b>{t.value}</b>
                    <span>{t.label}</span>
                  </div>
                ))}
              </div>
              {activity && <div className="card heatmap-card"><Heatmap days={activity.days} /></div>}
              {recent.length > 0 && (
                <div className="recent">
                  <span className="faint">最近学过</span>
                  {recent.map((r) => (
                    <button key={r.id} className="recent-word" title={r.deckName} onClick={() => go({ name: 'deck', deckId: r.deckId })}>{r.term}</button>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="section">
            <div className="section-head"><h2 className="section-title">添加卡片</h2></div>
            <Maker />
          </section>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">卡组</h2>
              <span className="spacer" />
              {decks.length > 4 && <button className="link" onClick={() => go({ name: 'library' })}>全部 {decks.length} 个卡组 →</button>}
            </div>
            {langs && !decks.length ? (
              <div className="card empty">
                <p>还没有卡组。从预设卡包开始最快。</p>
                <div className="hero-actions">
                  <button className="button button-primary" onClick={() => go({ name: 'import', source: 'presets' })}><Icon name="download" />浏览预设卡包</button>
                  <button className="button" onClick={() => openCreateDeck()}><Icon name="plus" />新建空卡组</button>
                </div>
              </div>
            ) : (
              <div className="deck-grid">
                {[...decks].sort((a, b) => b.due + b.fresh - (a.due + a.fresh)).slice(0, 4).map((d) => <DeckCard key={d.id} deck={d} />)}
              </div>
            )}
          </section>
          <p className="home-foot faint">
            <button className="link" onClick={() => openGenerate({ tab: 'process-inbox' })}>整理收藏</button>
            <span>·</span>
            <button className="link" onClick={() => openGenerate({ tab: 'leech-helper' })}>攻克难记卡</button>
          </p>
        </div>
      </div>
    </div>
  )
}

function TodayBanner({ langs, words }: { langs: LangSummary[]; words: string[] }) {
  const { go } = useShell()
  const due = langs.reduce((n, l) => n + l.due, 0)
  const fresh = langs.reduce((n, l) => n + l.fresh, 0)
  const left = due + fresh
  const now = new Date()
  const date = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 星期${'日一二三四五六'[now.getDay()]}`
  const ready = langs.filter((l) => l.due + l.fresh > 0)
  const start = (lang: Lang) => go({ name: 'review', scope: { lang }, title: LANG_LABELS[lang] })
  const stack = words.length ? words.slice(0, 3) : langs.length ? ['記憶', 'memory', '習慣'] : ['はじめ', 'begin', '一歩']

  return (
    <section className="banner">
      <div className="banner-copy">
        <p className="eyebrow">{date}</p>
        <h1>
          {!langs.length ? '从一套卡组开始' : left ? <>今天还有 <em>{left}</em> 张</> : '今天的复习完成了'}
        </h1>
        <p className="banner-sub">
          {!langs.length
            ? '导入 Anki 卡包，或者让 AI 按你的水平做一套。'
            : left
              ? `待复习 ${due} 张 · 新卡 ${fresh} 张`
              : '新的卡片明天到期。可以加几张新词，或者回顾一下难记的卡。'}
        </p>
        <div className="banner-actions">
          {ready.map((l, i) => (
            <button key={l.lang} className={`button button-large${i ? '' : ' button-primary'}`} onClick={() => start(l.lang)}>
              <Icon name="play" size={14} />
              复习{LANG_LABELS[l.lang]}
              <span className="banner-count">{l.due + l.fresh}</span>
            </button>
          ))}
          {!langs.length && (
            <button className="button button-large button-primary" onClick={() => go({ name: 'import', source: 'presets' })}>
              <Icon name="download" />浏览预设卡包
            </button>
          )}
        </div>
      </div>
      <div className="banner-stack" aria-hidden>
        {stack.map((w, i) => (
          <div key={i} className={`banner-card c${i}`} style={{ '--h': langHue(/[぀-ヿ一-鿿]/.test(w) ? 'ja' : 'en') } as React.CSSProperties}>
            <span>{w}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Maker() {
  const { go, openGenerate } = useShell()
  const [request, setRequest] = useState('')
  const submit = () => request.trim() && openGenerate({ request: request.trim() })
  return (
    <div className="card maker">
      <div className="maker-row">
        <label className="maker-input">
          <Icon name="sparkles" />
          <input className="bare" value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="想学什么？例如：N3 里描述情绪的形容词" />
        </label>
        <button className="button button-primary maker-go" disabled={!request.trim()} onClick={submit}>AI 制卡</button>
        <span className="faint">或</span>
        <button className="button maker-go" onClick={() => go({ name: 'import' })}>
          <Icon name="download" />
          导入
        </button>
      </div>
      <p className="maker-hint">AI 按你的学习档案做卡，每条先经代码检查再写入，可以整批撤销。也可以导入 Anki 卡包或粘贴一段原文。</p>
    </div>
  )
}
