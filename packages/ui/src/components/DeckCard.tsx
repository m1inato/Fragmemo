import type { DeckSummary } from '@fragmemo/core'
import { LANG_LABELS, SOURCE_LABELS, langHue } from '../lib/format'
import { useShell } from '../lib/shell'

/** A deck as a small book: a cover with one of its words, then name, counts and progress. */
export function DeckCard({ deck: d }: { deck: DeckSummary }) {
  const { go } = useShell()
  const left = d.due + d.fresh
  const pct = d.cards ? Math.round((d.learned / d.cards) * 100) : 0
  return (
    <article className="card deck" style={{ '--h': langHue(d.lang) } as React.CSSProperties} onClick={() => go({ name: 'deck', deckId: d.id })}>
      <DeckCover deck={d} />
      <div className="deck-body">
        <h3 title={d.name}>{d.name}</h3>
        <p className="deck-meta">{d.notes.toLocaleString()} 条笔记 · {d.cards.toLocaleString()} 张卡</p>
        <div className="deck-foot">
          <span className="chip tint">{LANG_LABELS[d.lang]}</span>
          <span className="chip">{SOURCE_LABELS[d.source]}</span>
          <span className="spacer" />
          <span className="deck-progress" title={`已学 ${d.learned} / ${d.cards}`}>
            <span className="progress"><span style={{ width: `${pct}%` }} /></span>
            <small>{pct}%</small>
          </span>
        </div>
      </div>
      <button
        className={`button button-small deck-review${left ? ' button-soft' : ''}`}
        disabled={!left}
        onClick={(e) => {
          e.stopPropagation()
          go({ name: 'review', scope: { lang: d.lang, deckIds: [d.id] }, title: d.name })
        }}
      >
        {left ? `复习 ${left}` : d.cards ? '已完成' : '没有卡片'}
      </button>
    </article>
  )
}

export function DeckCover({ deck: d, large }: { deck: DeckSummary; large?: boolean }) {
  const word = d.sample ?? (d.lang === 'ja' ? 'あ' : 'Aa')
  return (
    <div className={`deck-cover${large ? ' deck-cover-large' : ''}`} style={{ '--h': langHue(d.lang) } as React.CSSProperties} aria-hidden>
      <span lang={d.lang} className={word.length > 4 ? 'long' : ''}>{word}</span>
    </div>
  )
}
