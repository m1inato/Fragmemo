import type { Lang } from '@fragmemo/core'
import { LANG_LABELS, langHue } from '../lib/format'
import { useShell, type View } from '../lib/shell'
import { Icon, Mark, type IconName } from './Icon'

const PAGES: { name: 'home' | 'library' | 'import'; label: string; icon: IconName }[] = [
  { name: 'home', label: '今天', icon: 'home' },
  { name: 'library', label: '全部卡组', icon: 'layers' },
  { name: 'import', label: '导入', icon: 'download' }
]

/** Pages, decks grouped by language, and the study streak. The traffic lights sit above the brand. */
export function Sidebar() {
  const { view, go, langs, activity, openCreateDeck } = useShell()
  const all = langs ?? []
  const left = all.reduce((n, l) => n + l.due + l.fresh, 0)
  const decks = all.reduce((n, l) => n + l.decks.length, 0)
  const counts: Record<string, number> = { home: left, library: decks }
  const current = (name: View['name']) => view.name === name
  const today = activity?.days.at(-1)?.count ?? 0
  const shown: Lang[] = all.map((l) => l.lang)

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <button className="brand" onClick={() => go({ name: 'home' })}>
          <Mark size={30} />
          Fragmemo
        </button>
      </div>
      <nav className="side-nav" aria-label="页面">
        {PAGES.map((p) => (
          <button key={p.name} className={`side-item${current(p.name) ? ' on' : ''}`} onClick={() => go({ name: p.name })} aria-current={current(p.name) ? 'page' : undefined}>
            <Icon name={p.icon} />
            <span>{p.label}</span>
            {counts[p.name] > 0 && <i>{counts[p.name]}</i>}
          </button>
        ))}
      </nav>

      {shown.map((lang) => (
        <section key={lang} className="side-group" aria-label={`${LANG_LABELS[lang]}卡组`}>
          <div className="side-head">
            <span>{LANG_LABELS[lang]}</span>
            <button className="icon-button side-add" title={`新建${LANG_LABELS[lang]}卡组`} onClick={() => openCreateDeck(lang)}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          {all.find((l) => l.lang === lang)!.decks.map((d) => (
            <button
              key={d.id}
              className={`side-item side-deck${view.name === 'deck' && view.deckId === d.id ? ' on' : ''}`}
              style={{ '--h': langHue(d.lang) } as React.CSSProperties}
              onClick={() => go({ name: 'deck', deckId: d.id })}
              title={d.name}
            >
              <span>{d.name}</span>
              {d.due + d.fresh > 0 && <i>{d.due + d.fresh}</i>}
            </button>
          ))}
        </section>
      ))}
      {langs && !all.length && (
        <button className="side-item side-new" onClick={() => openCreateDeck()}>
          <Icon name="plus" />
          <span>新建卡组</span>
        </button>
      )}

      {activity && (
        <div className="side-streak">
          <Icon name="flame" />
          <div>
            <b>{activity.streak ? `连续 ${activity.streak} 天` : '今天开始吧'}</b>
            <span>今日复习 {today} 次</span>
          </div>
          <div className="side-week" aria-hidden>
            {activity.days.slice(-7).map((d) => <i key={d.date} className={d.count ? 'on' : ''} />)}
          </div>
        </div>
      )}
    </aside>
  )
}
