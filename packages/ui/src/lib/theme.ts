import type { Palette, Theme } from '../api'

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
let current: Theme = 'system'

/** Resolve "system" here so the stylesheet only needs one block per concrete theme. */
export function applyTheme(theme: Theme) {
  current = theme
  const resolved = theme === 'system' ? (dark?.matches ? 'dark' : 'light') : theme
  document.documentElement.dataset.theme = resolved
}

export function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark'
}

dark?.addEventListener('change', () => {
  if (current === 'system') applyTheme('system')
})

export const THEME_LABELS: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色', sepia: '护眼' }

export function applyPalette(palette: Palette) {
  document.documentElement.dataset.palette = palette
}

export const PALETTE_LABELS: Record<Palette, string> = { sky: '天青', sakura: '樱', mint: '薄荷', matcha: '抹茶', plain: '素' }
