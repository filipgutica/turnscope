import { describe, expect, it } from 'vitest'

import { ThemeValidationError, parseVsCodeTheme } from '../../shared/theme.js'

describe('VS Code theme parsing and normalization', () => {
  it('parses JSONC and maps VS Code colors into semantic tokens', () => {
    const theme = parseVsCodeTheme({
      fileName: 'forest.jsonc',
      source: `{
        // Comments and trailing commas are valid in VS Code themes.
        "name": "Forest",
        "type": "dark",
        "colors": {
          "editor.background": "#101812",
          "editor.foreground": "#E8F0EA",
          "sideBar.background": "#172019",
          "panel.background": "#1C271F",
          "descriptionForeground": "#A5B3A8",
          "panel.border": "#3B4B3E",
          "focusBorder": "#78D69F",
          "textLink.foreground": "#75DDA5",
          "button.background": "#287A4B",
          "button.foreground": "#FFFFFF",
          "button.hoverBackground": "#32955D",
          "input.background": "#0D140F",
          "input.foreground": "#EDF5EF",
          "input.border": "#4A5C4E",
          "input.placeholderForeground": "#91A095",
          "list.hoverBackground": "#243329",
          "list.activeSelectionBackground": "#315E43",
          "list.activeSelectionForeground": "#FFFFFF",
          "errorForeground": "#FF8B8B",
          "notificationsWarningIcon.foreground": "#F3C969",
          "notificationsInfoIcon.foreground": "#75BFFF",
          "testing.iconPassed": "#72D18B",
          "progressBar.background": "#66D995",
        },
        "tokenColors": [],
      }`,
    })

    expect(theme).toMatchObject({
      name: 'Forest',
      appearance: 'dark',
      tokens: {
        pageBackground: '#101812',
        surface: '#172019',
        surfaceRaised: '#1C271F',
        textPrimary: '#E8F0EA',
        textMuted: '#A5B3A8',
        border: '#3B4B3E',
        link: '#75DDA5',
        focus: '#78D69F',
        buttonBackground: '#287A4B',
        inputBackground: '#0D140F',
        rowHoverBackground: '#243329',
        rowSelectedBackground: '#315E43',
        error: '#FF8B8B',
        warning: '#F3C969',
        info: '#75BFFF',
        success: '#72D18B',
        progress: '#66D995',
      },
    })
  })

  it('uses ordered semantic and appearance fallbacks for missing keys', () => {
    const theme = parseVsCodeTheme({
      fileName: 'minimal.json',
      source: JSON.stringify({
        colors: {
          'editor.background': '#FAFAFA',
          foreground: '#202020',
          'textLink.foreground': '#005FB8',
        },
      }),
    })

    expect(theme.name).toBe('minimal')
    expect(theme.appearance).toBe('light')
    expect(theme.tokens).toMatchObject({
      pageBackground: '#FAFAFA',
      surface: '#FAFAFA',
      textPrimary: '#202020',
      textMuted: '#202020',
      link: '#005FB8',
      accent: '#005FB8',
      progress: '#005FB8',
    })
    expect(theme.tokens.border).toMatch(/^#[0-9A-F]{6}$/)
  })

  it.each([
    ['unsupported CSS name', 'red'],
    ['CSS injection', '#fff; background: url(file:///secret)'],
  ])('rejects %s in a supported color key', (_label, value) => {
    expect(() => parseVsCodeTheme({
      fileName: 'unsafe.json',
      source: JSON.stringify({
        colors: {
          'editor.background': '#101010',
          'editor.foreground': value,
        },
      }),
    })).toThrowError(new ThemeValidationError(
      'invalid-color',
      'The color for "editor.foreground" must be a 3-, 4-, 6-, or 8-digit hexadecimal value.',
    ))
  })

  it('accepts the short hexadecimal forms supported by VS Code', () => {
    const theme = parseVsCodeTheme({
      fileName: 'short.json',
      source: JSON.stringify({
        colors: {
          'editor.background': '#111',
          'editor.foreground': '#FFFC',
          'button.background': '#833',
        },
      }),
    })

    expect(theme.tokens.pageBackground).toBe('#111111')
    expect(theme.tokens.textPrimary).toBe('#FFFFFFCC')
    expect(theme.tokens.buttonBackground).toBe('#883333')
    expect(theme.tokens.buttonForeground).toBe('#FFFFFF')
  })

  it('infers dark appearance from a shorthand background when metadata is absent', () => {
    const theme = parseVsCodeTheme({
      fileName: 'short-dark.json',
      source: JSON.stringify({
        colors: { 'editor.background': '#000', 'editor.foreground': '#fff' },
      }),
    })

    expect(theme.appearance).toBe('dark')
    expect(theme.tokens.pageBackground).toBe('#000000')
  })

  it('uses an accessible built-in button pair when an imported theme omits it', () => {
    const theme = parseVsCodeTheme({
      fileName: 'official-dark.json',
      source: JSON.stringify({
        type: 'dark',
        colors: {
          'editor.background': '#1E1E1E',
          'editor.foreground': '#D4D4D4',
          'textLink.foreground': '#3794FF',
        },
      }),
    })

    expect(theme.tokens.buttonBackground).toBe('#89B4FA')
    expect(theme.tokens.buttonForeground).toBe('#11111B')
  })

  it('keeps muted text and links readable across page and surface backgrounds', () => {
    const theme = parseVsCodeTheme({
      fileName: 'split-surfaces.json',
      source: JSON.stringify({
        type: 'light',
        colors: {
          'editor.background': '#FFFFFF',
          'editor.foreground': '#000000',
          'sideBar.background': '#757575',
          descriptionForeground: '#FFFFFF',
          'textLink.foreground': '#FFFFFF',
        },
      }),
    })

    expect(theme.tokens.surface).toBe('#757575')
    expect(theme.tokens.textMuted).toBe('#000000')
    expect(theme.tokens.link).toBe('#000000')
  })

  it('rejects malformed JSONC with a useful location', () => {
    expect(() => parseVsCodeTheme({
      fileName: 'broken.jsonc',
      source: '{ "colors": { "editor.background": "#101010", }',
    })).toThrowError(/could not be parsed.*line 1/i)
  })

  it('rejects themes without usable base colors', () => {
    expect(() => parseVsCodeTheme({
      fileName: 'empty.json',
      source: JSON.stringify({ colors: { 'activityBar.background': '#101010' } }),
    })).toThrowError(new ThemeValidationError(
      'missing-colors',
      'The theme must define a supported background color and foreground color.',
    ))
  })

  it('preserves high-contrast appearance and explicit border fallbacks', () => {
    const theme = parseVsCodeTheme({
      fileName: 'contrast.json',
      source: JSON.stringify({
        type: 'hc',
        colors: {
          'editor.background': '#000000',
          'editor.foreground': '#FFFFFF',
          contrastBorder: '#FFFF00',
        },
      }),
    })

    expect(theme.appearance).toBe('high-contrast-dark')
    expect(theme.tokens.border).toBe('#FFFF00')
    expect(theme.tokens.inputBorder).toBe('#FFFF00')
  })

  it('replaces invisible high-contrast borders, focus, and primary text', () => {
    const theme = parseVsCodeTheme({
      fileName: 'invisible-contrast.json',
      source: JSON.stringify({
        type: 'hc',
        colors: {
          'editor.background': '#000000',
          'editor.foreground': '#000000',
          'sideBar.background': '#181825',
          'textLink.foreground': '#181825',
          errorForeground: '#18182500',
          'notificationsWarningIcon.foreground': '#181825',
          'testing.iconPassed': '#181825',
          'notificationsInfoIcon.foreground': '#181825',
          'button.background': '#FFFFFF',
          'button.foreground': '#000000',
          'button.hoverBackground': '#000000',
          'input.background': '#000000',
          'input.placeholderForeground': '#000000',
          'list.hoverBackground': '#FFFFFF',
          'progressBar.background': '#181825',
          contrastBorder: '#00000000',
          'panel.border': '#18182500',
          focusBorder: '#00000000',
        },
      }),
    })

    expect(theme.tokens.textPrimary).toBe('#FFFFFF')
    expect(theme.tokens.border).not.toBe('#00000000')
    expect(theme.tokens.borderSubtle).not.toBe('#18182500')
    expect(theme.tokens.focus).not.toBe('#00000000')
    expect(theme.tokens.link).not.toBe('#181825')
    expect(theme.tokens.error).not.toBe('#18182500')
    expect(theme.tokens.warning).not.toBe('#181825')
    expect(theme.tokens.success).not.toBe('#181825')
    expect(theme.tokens.info).not.toBe('#181825')
    expect(theme.tokens.buttonHoverBackground).toBe(theme.tokens.buttonBackground)
    expect(theme.tokens.inputPlaceholder).not.toBe('#000000')
    expect(theme.tokens.rowHoverBackground).not.toBe('#FFFFFF')
    expect(theme.tokens.surfaceMuted).not.toBe('#FFFFFF')
    expect(theme.tokens.progress).not.toBe(theme.tokens.surfaceMuted)
  })
})
