import { describe, expect, it } from 'vitest'

import type { NormalizedTheme } from '@filipgutica/ui/theme'
import { applyTheme, resolveTheme } from './theme'

const importedTheme: NormalizedTheme = {
  name: 'Fixture',
  appearance: 'high-contrast-dark',
  tokens: {
    pageBackground: '#010101',
    surface: '#111111',
    surfaceRaised: '#181818',
    surfaceMuted: '#222222',
    textPrimary: '#FFFFFF',
    textMuted: '#CCCCCC',
    border: '#FFFF00',
    borderSubtle: '#AAAA00',
    link: '#66CCFF',
    accent: '#00AAFF',
    focus: '#FFFF00',
    buttonBackground: '#0055AA',
    buttonForeground: '#FFFFFF',
    buttonHoverBackground: '#0066CC',
    inputBackground: '#000000',
    inputForeground: '#FFFFFF',
    inputBorder: '#FFFF00',
    inputPlaceholder: '#BBBBBB',
    rowHoverBackground: '#202020',
    rowSelectedBackground: '#004477',
    rowSelectedForeground: '#FFFFFF',
    codeBackground: '#000000',
    codeForeground: '#FFFFFF',
    error: '#FF7777',
    warning: '#FFD866',
    success: '#77DD88',
    info: '#66CCFF',
    progress: '#00AAFF',
  },
}

const createRoot = () => {
  const classes = new Set<string>()
  const properties = new Map<string, string>()
  const attributes = new Map<string, string>()
  return {
    classes,
    properties,
    attributes,
    root: {
      classList: {
        toggle: (name: string, enabled?: boolean) => {
          const active = enabled ?? !classes.has(name)
          if (active) classes.add(name)
          else classes.delete(name)
          return active
        },
      },
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
      },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
  }
}

describe('theme preference', () => {
  it('uses the explicit preference before the system preference', () => {
    expect(resolveTheme({ preference: 'dark', systemDark: false })).toBe('dark')
    expect(resolveTheme({ preference: 'light', systemDark: true })).toBe('light')
    expect(resolveTheme({ preference: 'system', systemDark: true })).toBe('dark')
  })

  it('applies only normalized semantic variables and high-contrast state', () => {
    const target = createRoot()

    applyTheme({ root: target.root, resolvedTheme: 'imported', importedTheme })

    expect(target.classes).toEqual(new Set(['dark', 'high-contrast']))
    expect(target.attributes.get('data-theme')).toBe('imported')
    expect(target.properties.get('--color-bg')).toBe('#010101')
    expect(target.properties.get('--color-button-bg')).toBe('#0055AA')
    expect(target.properties.get('--color-focus')).toBe('#FFFF00')
    expect([...target.properties.keys()]).toHaveLength(Object.keys(importedTheme.tokens).length)
  })

  it('clears imported variables when restoring a built-in theme', () => {
    const target = createRoot()
    applyTheme({ root: target.root, resolvedTheme: 'imported', importedTheme })

    applyTheme({ root: target.root, resolvedTheme: 'light', importedTheme: null })

    expect(target.classes.size).toBe(0)
    expect(target.properties.size).toBe(0)
    expect(target.attributes.get('data-theme')).toBe('light')
  })
})
