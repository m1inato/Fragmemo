import type { DeckSummary, Lang } from '@fragmemo/core'
import { useState } from 'react'
import { Icon } from '../components/Icon'
import { LANG_LABELS, SOURCE_LABELS, langHue } from '../lib/format'
import { useShell } from '../lib/shell'

type Filter = 'all' | Lang

export function Home() {
  const { langs, go, openGenerate } = useShell()
  const [request, setRequest] = useState('')

  const all = langs ?? []
  const sum = (k: 'due' | 'fresh' | 'learned' | 'cards') => all.reduce((n, l) => n + l[k], 0)
  const left = sum('due') + sum('fresh')

  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-inner">
          <section className="hero">
            <h1>{!langs ? '' : !all.length ? '开始吧' : left ? '今天' : '今天的复习完成了'}</h1>
            {all.length > 0 && (
              <p className="stats">
                <span>待复习 <b>{sum('due')}</b> 张</span>
                <span>新卡 <b>{sum('fresh')}</b> 张</span>
                <span>已学 <b>{sum('learned')}</b> / {sum('cards')}</span>
              </p>
            )}
          </section>

          {all.some((l) => l.decks.length) && (
            <section className="card today">
              {all.map((l) => (
                <div key={l.lang} className="today-row">
                  <span className="chip tint" style={{ '--h': langHue(l.lang) } as React.CSSProperties}>{LANG_LABELS[l.lang]}</span>
                  <span className="today-count">
                    {l.due + l.fresh ? <>还有 <b>{l.due + l.fresh}</b> 张 <span className="faint">· 待复习 {l.due} · 新卡 {l.fresh}</span></> : <span className="faint">今天的已经完成</span>}
                  </span>
                  <button className="button button-primary" disabled={!l.due && !l.fresh} onClick={() => go({ name: 'review', scope: { lang: l.lang }, title: LANG_LABELS[l.lang] })}>
                    <Icon name="play" size={14} />
                    开始复习
                  </button>
                </div>
              ))}
            </section>
          )}

          <section className="card maker">
            <div className="maker-row">
              <label className="maker-input">
                <Icon name="sparkles" />
                <input
                  className="bare"
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && request.trim() && openGenerate({ request: request.trim() })}
                  placeholder="想学什么？例如：N3 里描述情绪的形容词"
                />
              </label>
              <button className="button button-primary" disabled={!request.trim()} onClick={() => openGenerate({ request: request.trim() })}>AI 制卡</button>
              <span className="faint maker-or">或</span>
              <button className="button" onClick={() => go({ name: 'import' })}>
                <Icon name="file" />
                导入词组
              </button>
            </div>
            <p className="maker-hint faint">
              AI 按你的学习档案做卡，每条都先经代码检查，可以整批撤销。也可以
              <button className="link" onClick={() => openGenerate({ tab: 'process-inbox' })}>整理收藏</button>或
              <button className="link" onClick={() => openGenerate({ tab: 'leech-helper' })}>攻克难记卡</button>。
            </p>
          </section>
          <DeckList />
        </div>
      </div>
    </div>
  )
}

export function Library() {
  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-inner">
          <section className="hero">
            <h1>卡组</h1>
          </section>
          <DeckList />
        </div>
      </div>
    </div>
  )
}

function DeckList() {
  const { langs, openCreateDeck } = useShell()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const all = (langs ?? []).flatMap((l) => l.decks)
  const search = query.trim().toLowerCase()
  const decks = all.filter((d) => (filter === 'all' || d.lang === filter) && d.name.toLowerCase().includes(search))

  return (
    <>
      <div className="tools">
        <div className="segmented">
          {(['all', 'ja', 'en'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? '全部' : LANG_LABELS[f]}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <input className="tools-search" type="search" placeholder="搜索卡组…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="button" onClick={() => openCreateDeck(filter === 'all' ? undefined : filter)}>
          <Icon name="plus" />
          新建卡组
        </button>
      </div>
      {langs && !decks.length && (
        <p className="empty faint">{all.length ? '没有匹配的卡组。' : '还没有卡组。可以导入词组，或新建一个卡组。'}</p>
      )}
      <div className="deck-grid">
        {decks.map((d) => <DeckCard key={d.id} deck={d} />)}
      </div>
    </>
  )
}

function DeckCard({ deck: d }: { deck: DeckSummary }) {
  const { go } = useShell()
  const left = d.due + d.fresh
  return (
    <article className="card deck" onClick={() => go({ name: 'deck', deckId: d.id })}>
      <h3>{d.name}</h3>
      <p className="deck-meta faint">{d.notes} 条笔记 · {d.cards} 张卡</p>
      <div className="deck-foot">
        <span className="chip tint" style={{ '--h': langHue(d.lang) } as React.CSSProperties}>{LANG_LABELS[d.lang]}</span>
        <span className="chip">{SOURCE_LABELS[d.source]}</span>
        <span className="progress" title={`已学 ${d.learned} / ${d.cards}`}>
          <span style={{ width: `${d.cards ? (d.learned / d.cards) * 100 : 0}%` }} />
        </span>
        <span className={`deck-left${left ? '' : ' faint'}`}>{left ? `${left} 张` : '已完成'}</span>
        <button
          className="button button-small"
          disabled={!left}
          onClick={(e) => {
            e.stopPropagation()
            go({ name: 'review', scope: { lang: d.lang, deckIds: [d.id] }, title: d.name })
          }}
        >
          复习
        </button>
      </div>
    </article>
  )
}
