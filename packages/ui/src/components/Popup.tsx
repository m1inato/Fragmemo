import { useId, type ReactNode, type Ref } from 'react'
import { Icon } from './Icon'

export function Popup({ label, value, children, triggerRef }: {
  label: string
  value: ReactNode
  triggerRef?: Ref<HTMLButtonElement>
  children: (dismiss: () => void) => ReactNode
}) {
  const id = useId()
  return (
    <div className="popup-control">
      <button ref={triggerRef} type="button" className="popup-trigger" aria-label={label} popoverTarget={id}>
        <span>{value}</span>
        <Icon name="down" size={14} />
      </button>
      <div id={id} popover="auto" className="floating-popup" role="group" aria-label={label}>
        {children(() => {
          const popup = document.getElementById(id)
          if (popup?.matches(':popover-open')) popup.hidePopover()
        })}
      </div>
    </div>
  )
}

export function PopupOption({ label, selected, onClick }: { label: string; selected?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="popup-option" aria-pressed={selected} onClick={onClick}>
      <span>{label}</span>
      {selected && <Icon name="check" size={15} />}
    </button>
  )
}
