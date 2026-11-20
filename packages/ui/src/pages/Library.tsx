import type { Lang } from '@fragmemo/core'
import { useState } from 'react'
import { DeckCard } from '../components/DeckCard'
import { Icon } from '../components/Icon'
import { Topbar } from '../components/Topbar'
import { LANG_LABELS } from '../lib/format'
import { useShell } from '../lib/shell'

type Filter = 'all' | Lang

export function Library() {
  const { langs, go, openCreateDeck } = useShell()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const all = (langs ?? []).flatMap((l) => l.decks)
  const search = query.trim().toLowerCase()
  const decks = all.filter((d) => (filter === 'all' || d.lang === filter) && d.name.toLowerCase().includes(search))
  const sum = (k: 'cards' | 'learned' | 'notes') => all.reduce((n, d) => n + d[k], 0)

  return (
    <div className="page">
      <Topbar />
      <div className="page-scroll">
        <div className="page-inner">
          <section className="hero">
            <h1>全部卡组</h1>
            <p className="stats">
              <span>共 <b>{all.length}</b> 个卡组</span>
              <span><b>{sum('notes').toLocaleString()}</b> 条笔记</span>
              <span>已学 <b>{sum('learned').toLocaleString()}</b> / {sum('cards').toLocaleString()} 张</span>
            </p>
          </section>

          <div className="tools">
            <div className="segmented">
              {(['all', 'ja', 'en'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? '全部' : LANG_LABELS[f]}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <label className="search tools-search">
              <Icon name="search" size={14} />
              <input type="search" placeholder="搜索卡组…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button className="button" onClick={() => go({ name: 'import' })}>
              <Icon name="download" />
              导入
            </button>
            <button className="button" onClick={() => openCreateDeck(filter === 'all' ? undefined : filter)}>
              <Icon name="plus" />
              新建卡组
            </button>
          </div>

          {langs && !decks.length && <p className="card empty">{all.length ? '没有匹配的卡组' : '还没有卡组'}</p>}
          <div className="deck-grid">
            {decks.map((d) => <DeckCard key={d.id} deck={d} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
