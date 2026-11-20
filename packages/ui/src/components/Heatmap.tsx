import type { StudyActivity } from '@fragmemo/core'
import { useEffect, useRef } from 'react'

const WEEKDAYS = ['一', '', '三', '', '五', '', '日']

/** Reviews per day as a grid of weeks, Monday on top, like a contribution calendar. */
export function Heatmap({ days }: { days: StudyActivity['days'] }) {
  const scroller = useRef<HTMLDivElement>(null)
  // When the year does not fit, keep the latest weeks in view, also as the panel opens and closes.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const pin = () => {
      el.scrollLeft = el.scrollWidth
    }
    const observer = new ResizeObserver(pin)
    observer.observe(el)
    return () => observer.disconnect()
  }, [days.length])
  if (!days.length) return null
  const max = Math.max(1, ...days.map((d) => d.count))
  const level = (n: number) => (!n ? 0 : n >= max * 0.75 ? 4 : n >= max * 0.5 ? 3 : n >= max * 0.25 ? 2 : 1)
  const lead = (new Date(`${days[0].date}T12:00`).getDay() + 6) % 7
  const cells: ({ date: string; count: number } | null)[] = [...Array(lead).fill(null), ...days]
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const months = weeks.map((w, i) => {
    const first = w.find(Boolean)
    const prev = weeks[i - 1]?.find(Boolean)
    const m = first ? Number(first.date.slice(5, 7)) : 0
    return first && (!prev || Number(prev.date.slice(5, 7)) !== m) ? `${m}月` : ''
  })
  const total = days.reduce((n, d) => n + d.count, 0)
  const active = days.filter((d) => d.count).length

  return (
    <div className="heatmap">
      <div ref={scroller} className="heatmap-scroll">
      <div className="heatmap-grid" style={{ gridTemplateColumns: `auto repeat(${weeks.length}, 12px)` }}>
        <span />
        {months.map((m, i) => <span key={i} className="heatmap-month">{m}</span>)}
        {WEEKDAYS.map((d, row) => (
          <Row key={row} label={d} cells={weeks.map((w) => w[row] ?? null)} level={level} />
        ))}
      </div>
      </div>
      <div className="heatmap-foot">
        <span>近一年复习 <b>{total.toLocaleString()}</b> 次，学习 <b>{active}</b> 天</span>
        <span className="heatmap-legend">
          少{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`l${l}`} />)}多
        </span>
      </div>
    </div>
  )
}

function Row({ label, cells, level }: { label: string; cells: ({ date: string; count: number } | null)[]; level: (n: number) => number }) {
  return (
    <>
      <span className="heatmap-day">{label}</span>
      {cells.map((c, i) => (c ? <i key={i} className={`l${level(c.count)}`} title={`${c.date} · ${c.count} 次`} /> : <span key={i} />))}
    </>
  )
}
