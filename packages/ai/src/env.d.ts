// The slice of web-standard globals this package uses (fetch, abort signals), declared by hand
// so it keeps `lib` free of DOM and Node typings like core. Hosts compile it with their own.

interface AbortSignal {
  readonly aborted: boolean
  readonly reason: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
  throwIfAborted(): void
}
declare var AbortSignal: { any(signals: AbortSignal[]): AbortSignal; timeout(ms: number): AbortSignal }
declare class AbortController {
  readonly signal: AbortSignal
  abort(reason?: unknown): void
}

interface Response {
  readonly ok: boolean
  readonly status: number
  readonly body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null
  text(): Promise<string>
}
declare function fetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
): Promise<Response>
