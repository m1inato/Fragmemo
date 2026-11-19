import type { Lang } from '@fragmemo/core'
import { LANG_LABELS } from '../lib/format'
import { useShell } from '../lib/shell'
import { Icon, Mark } from './Icon'

/** Library navigation: today, then every deck grouped by language with what is left for today. */
export function Sidebar() {
  const { view, go, langs, openCreateDeck } = useShell()
  const total = (langs ?? []).reduce((n, l) => n + l.due + l.fresh, 0)
  const groups: Lang[] = ['ja', 'en']

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <button className="brand" onClick={() => go({ name: 'home' })}>
          <Mark size={30} />
          Fragmemo
        </button>
      </div>
      <nav>
        <button className={`side-item${view.name === 'home' ? ' on' : ''}`} onClick={() => go({ name: 'home' })}>
          <span>今天</span>
          {total > 0 && <i>{total}</i>}
        </button>
        {groups.map((lang) => {
          const decks = langs?.find((l) => l.lang === lang)?.decks ?? []
          return (
            <div key={lang} className="side-group">
              <div className="side-head">
                <span>{LANG_LABELS[lang]}</span>
                <button className="icon-button side-add" title={`新建${LANG_LABELS[lang]}卡组`} onClick={() => openCreateDeck(lang)}>
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {!decks.length && <p className="side-empty">还没有卡组</p>}
              {decks.map((d) => (
                <button
                  key={d.id}
                  className={`side-item${view.name === 'deck' && view.deckId === d.id ? ' on' : ''}`}
                  onClick={() => go({ name: 'deck', deckId: d.id })}
                  title={d.name}
                >
                  <span>{d.name}</span>
                  {d.due + d.fresh > 0 && <i>{d.due + d.fresh}</i>}
                </button>
              ))}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
