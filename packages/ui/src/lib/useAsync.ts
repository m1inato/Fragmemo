import { useCallback, useEffect, useState } from 'react'

/** Load data on mount and whenever `deps` change; `reload` refetches on demand. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    fn().then(
      (v) => alive && (setData(v), setError(null)),
      (e: unknown) => alive && setError(e instanceof Error ? e : new Error(String(e)))
    )
    return () => {
      alive = false
    }
  }, [...deps, tick])
  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) }
}
