import type { ReactNode } from 'react'

/** Custom title area: draggable, leaves room for the inset traffic lights on macOS. */
export function TitleBar({ left, center, right }: { left?: ReactNode; center?: ReactNode; right?: ReactNode }) {
  return (
    <header className="titlebar">
      <div className="titlebar-side">{left}</div>
      <div className="titlebar-center">{center}</div>
      <div className="titlebar-side titlebar-right">{right}</div>
    </header>
  )
}
