import type { Api } from '../api'

/** Provided by the shell before the UI loads (Electron preload, or the Android bootstrap). */
export const api: Api = (globalThis as unknown as { api: Api }).api
