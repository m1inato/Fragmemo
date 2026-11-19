import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastItem { id: number; text: string; kind: 'info' | 'error' | 'pending' }
interface ToastApi {
  show(text: string, kind?: 'info' | 'error'): void
  /** Stays up until the promise settles, then shows the outcome. */
  track<T>(p: Promise<T>, msgs: { pending: string; done: string | ((v: T) => string | null) }): Promise<T>
}

const Ctx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const t = useContext(Ctx)
  if (!t) throw new Error('useToast outside ToastProvider')
  return t
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : '出了点问题，再试一次吧'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback((text: string, kind: ToastItem['kind']) => {
    const id = ++seq.current
    setItems((xs) => [...xs.slice(-2), { id, text, kind }])
    if (kind !== 'pending') setTimeout(() => remove(id), kind === 'error' ? 5000 : 2600)
    return id
  }, [remove])

  const api: ToastApi = {
    show: (text, kind = 'info') => void push(text, kind),
    async track(p, msgs) {
      const id = push(msgs.pending, 'pending')
      try {
        const v = await p
        remove(id)
        const done = typeof msgs.done === 'function' ? msgs.done(v) : msgs.done
        if (done) push(done, 'info')
        return v
      } catch (err) {
        remove(id)
        push(errorText(err), 'error')
        throw err
      }
    }
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'pending' && <span className="spinner" />}
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
