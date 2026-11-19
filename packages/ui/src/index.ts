import { createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/index.css'

export { App }
export type { Api, AppState, NoteDraft, Theme, Answer } from './api'

/** Mount the app; the shell must have installed `globalThis.api` first. */
export function mount(el: HTMLElement) {
  createRoot(el).render(createElement(StrictMode, null, createElement(App)))
}
