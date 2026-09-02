import { describe, expect, it } from 'vitest'

import { applyTheme, resolveTheme } from './theme'

describe('theme preference', () => {
  it('uses the explicit preference before the system preference', () => {
    expect(resolveTheme({ preference: 'dark', systemDark: false })).toBe('dark')
    expect(resolveTheme({ preference: 'light', systemDark: true })).toBe('light')
    expect(resolveTheme({ preference: 'system', systemDark: true })).toBe('dark')
  })

  it('applies dark mode to the root element', () => {
    const classes = new Set<string>()
    const root = {
      classList: {
        toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
      },
    }

    applyTheme({ root, theme: 'dark' })
    expect(classes.has('dark')).toBe(true)
    applyTheme({ root, theme: 'light' })
    expect(classes.has('dark')).toBe(false)
  })
})
