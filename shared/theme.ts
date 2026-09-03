import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'

export type ThemeAppearance = 'light' | 'dark' | 'high-contrast-light' | 'high-contrast-dark'

export interface SemanticThemeTokens {
  pageBackground: string
  surface: string
  surfaceRaised: string
  surfaceMuted: string
  textPrimary: string
  textMuted: string
  border: string
  borderSubtle: string
  link: string
  accent: string
  focus: string
  buttonBackground: string
  buttonForeground: string
  buttonHoverBackground: string
  inputBackground: string
  inputForeground: string
  inputBorder: string
  inputPlaceholder: string
  rowHoverBackground: string
  rowSelectedBackground: string
  rowSelectedForeground: string
  codeBackground: string
  codeForeground: string
  error: string
  warning: string
  success: string
  info: string
  progress: string
}

export interface NormalizedTheme {
  name: string
  appearance: ThemeAppearance
  tokens: SemanticThemeTokens
}

export type ThemeImportErrorCode =
  | ThemeValidationErrorCode
  | 'file-too-large'
  | 'integrity-failed'
  | 'open-vsx-unavailable'
  | 'persistence-failed'
  | 'read-failed'
  | 'unsupported-extension'
  | 'unsupported-file-type'

export interface ThemeImportError {
  code: ThemeImportErrorCode
  message: string
}

export type ThemeImportResult =
  | { status: 'cancelled' }
  | { status: 'success'; theme: NormalizedTheme }
  | { status: 'error'; error: ThemeImportError }

export type ThemeRemovalResult =
  | { status: 'success' }
  | { status: 'error'; error: ThemeImportError }

export interface OpenVsxThemeSummary {
  id: string
  name: string
  publisher: string
  description: string
  downloadCount: number
}

export type OpenVsxThemeSearchResult =
  | { status: 'success'; themes: OpenVsxThemeSummary[] }
  | { status: 'error'; message: string }

export type ThemeValidationErrorCode =
  | 'invalid-color'
  | 'invalid-shape'
  | 'malformed-json'
  | 'missing-colors'
  | 'unsupported-type'

export class ThemeValidationError extends Error {
  readonly code: ThemeValidationErrorCode

  constructor(code: ThemeValidationErrorCode, message: string) {
    super(message)
    this.name = 'ThemeValidationError'
    this.code = code
  }
}

const semanticTokenKeys = [
  'pageBackground',
  'surface',
  'surfaceRaised',
  'surfaceMuted',
  'textPrimary',
  'textMuted',
  'border',
  'borderSubtle',
  'link',
  'accent',
  'focus',
  'buttonBackground',
  'buttonForeground',
  'buttonHoverBackground',
  'inputBackground',
  'inputForeground',
  'inputBorder',
  'inputPlaceholder',
  'rowHoverBackground',
  'rowSelectedBackground',
  'rowSelectedForeground',
  'codeBackground',
  'codeForeground',
  'error',
  'warning',
  'success',
  'info',
  'progress',
] as const satisfies readonly (keyof SemanticThemeTokens)[]

const supportedColorKeys = new Set([
  'editor.background',
  'editor.foreground',
  'foreground',
  'sideBar.background',
  'panel.background',
  'editorWidget.background',
  'descriptionForeground',
  'disabledForeground',
  'panel.border',
  'sideBar.border',
  'contrastBorder',
  'contrastActiveBorder',
  'focusBorder',
  'textLink.foreground',
  'textLink.activeForeground',
  'button.background',
  'button.foreground',
  'button.hoverBackground',
  'input.background',
  'input.foreground',
  'input.border',
  'input.placeholderForeground',
  'list.hoverBackground',
  'list.activeSelectionBackground',
  'list.activeSelectionForeground',
  'list.inactiveSelectionBackground',
  'list.inactiveSelectionForeground',
  'errorForeground',
  'editorError.foreground',
  'notificationsErrorIcon.foreground',
  'notificationsWarningIcon.foreground',
  'editorWarning.foreground',
  'notificationsInfoIcon.foreground',
  'editorInfo.foreground',
  'testing.iconPassed',
  'terminal.ansiGreen',
  'progressBar.background',
])

const lightFallbacks: SemanticThemeTokens = {
  pageBackground: '#EFF1F5',
  surface: '#E6E9EF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#DCE0E8',
  textPrimary: '#4C4F69',
  textMuted: '#6C6F85',
  border: '#ACB0BE',
  borderSubtle: '#CCD0DA',
  link: '#1E66F5',
  accent: '#8839EF',
  focus: '#1E66F5',
  buttonBackground: '#1E66F5',
  buttonForeground: '#FFFFFF',
  buttonHoverBackground: '#1A5AD7',
  inputBackground: '#FFFFFF',
  inputForeground: '#4C4F69',
  inputBorder: '#9CA0B0',
  inputPlaceholder: '#7C7F93',
  rowHoverBackground: '#DCE0E8',
  rowSelectedBackground: '#D9E2FA',
  rowSelectedForeground: '#4C4F69',
  codeBackground: '#E6E9EF',
  codeForeground: '#4C4F69',
  error: '#D20F39',
  warning: '#8A5600',
  success: '#287D3C',
  info: '#176B87',
  progress: '#8839EF',
}

const darkFallbacks: SemanticThemeTokens = {
  pageBackground: '#1E1E2E',
  surface: '#181825',
  surfaceRaised: '#242435',
  surfaceMuted: '#313244',
  textPrimary: '#CDD6F4',
  textMuted: '#A6ADC8',
  border: '#585B70',
  borderSubtle: '#45475A',
  link: '#89B4FA',
  accent: '#CBA6F7',
  focus: '#89B4FA',
  buttonBackground: '#89B4FA',
  buttonForeground: '#11111B',
  buttonHoverBackground: '#B4BEFE',
  inputBackground: '#11111B',
  inputForeground: '#CDD6F4',
  inputBorder: '#6C7086',
  inputPlaceholder: '#9399B2',
  rowHoverBackground: '#313244',
  rowSelectedBackground: '#45475A',
  rowSelectedForeground: '#CDD6F4',
  codeBackground: '#11111B',
  codeForeground: '#CDD6F4',
  error: '#F38BA8',
  warning: '#F9E2AF',
  success: '#A6E3A1',
  info: '#89DCEB',
  progress: '#CBA6F7',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSupportedSourceColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)

const isNormalizedColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)

const normalizeColor = (color: string): string => color.length === 4 || color.length === 5
  ? `#${[...color.slice(1)].map(channel => channel.repeat(2)).join('')}`
  : color

const colorChannels = (color: string): [red: number, green: number, blue: number, alpha: number] => {
  const expanded = color.length === 4 || color.length === 5
    ? [...color.slice(1)].map(channel => channel.repeat(2)).join('')
    : color.slice(1)
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
    expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  ]
}

const contrastRatio = (foreground: string, background: string, underlay: string): number => {
  const [underlayRed, underlayGreen, underlayBlue] = colorChannels(underlay)
  const composite = (color: string): [number, number, number] => {
    const [red, green, blue, alpha] = colorChannels(color)
    return [
      red * alpha + underlayRed * (1 - alpha),
      green * alpha + underlayGreen * (1 - alpha),
      blue * alpha + underlayBlue * (1 - alpha),
    ]
  }
  const luminance = ([red, green, blue]: [number, number, number]): number => {
    const linear = [red, green, blue].map(channel => {
      const normalized = channel / 255
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
  }
  const foregroundLuminance = luminance(composite(foreground))
  const backgroundLuminance = luminance(composite(background))
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

const readableForeground = ({
  background,
  preferred,
  underlay,
}: {
  background: string
  preferred: string
  underlay: string
}): string => {
  if (contrastRatio(preferred, background, underlay) >= 4.5) return preferred
  const candidates = [preferred, '#000000', '#FFFFFF']
  return candidates.reduce((best, candidate) =>
    contrastRatio(candidate, background, underlay) > contrastRatio(best, background, underlay)
      ? candidate
      : best)
}

const visibleIndicator = ({
  color,
  against,
  fallback,
}: {
  color: string
  against: string
  fallback: string
}): string => {
  if (contrastRatio(color, against, against) >= 3) return color
  if (contrastRatio(fallback, against, against) >= 3) return fallback
  return readableForeground({ background: against, preferred: fallback, underlay: against })
}

const readableSemanticColor = ({
  color,
  background,
  underlay,
  fallback,
}: {
  color: string
  background: string
  underlay: string
  fallback: string
}): string => contrastRatio(color, background, underlay) >= 4.5
  ? color
  : readableForeground({ background, preferred: fallback, underlay })

const readableAcrossBackgrounds = ({
  color,
  backgrounds,
  underlay,
  fallbacks,
}: {
  color: string
  backgrounds: readonly string[]
  underlay: string
  fallbacks: readonly string[]
}): string => {
  const candidates = [color, ...fallbacks]
  const readable = candidates.find(candidate =>
    backgrounds.every(background => contrastRatio(candidate, background, underlay) >= 4.5))
  if (readable) return readable
  return candidates.reduce((best, candidate) => {
    const minimumContrast = Math.min(...backgrounds.map(background =>
      contrastRatio(candidate, background, underlay)))
    const bestMinimumContrast = Math.min(...backgrounds.map(background =>
      contrastRatio(best, background, underlay)))
    return minimumContrast > bestMinimumContrast ? candidate : best
  })
}

const opaqueBackground = (color: string, fallback: string): string =>
  colorChannels(color)[3] === 1 ? color : fallback

const inferAppearance = (background: string): ThemeAppearance => {
  const [red, green, blue] = colorChannels(background)
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  return luminance < 0.5 ? 'dark' : 'light'
}

const parseAppearance = (value: unknown, background: string): ThemeAppearance => {
  if (value === undefined) return inferAppearance(background)
  if (value === 'light') return 'light'
  if (value === 'dark') return 'dark'
  if (value === 'hc') return 'high-contrast-dark'
  if (value === 'hcLight') return 'high-contrast-light'
  throw new ThemeValidationError(
    'unsupported-type',
    'The theme type must be "light", "dark", "hc", or "hcLight".',
  )
}

const firstColor = (
  colors: Record<string, unknown>,
  keys: readonly string[],
  fallback: string,
): string => {
  for (const key of keys) {
    const value = colors[key]
    if (isSupportedSourceColor(value)) return normalizeColor(value)
  }
  return fallback
}

const lineAndColumn = (source: string, offset: number): { line: number; column: number } => {
  const preceding = source.slice(0, offset)
  const lines = preceding.split('\n')
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

const themeNameFromFile = (fileName: string): string => {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? 'Imported theme'
  return (baseName.replace(/\.jsonc?$/i, '') || 'Imported theme').slice(0, 80)
}

const mapSemanticTokens = ({
  colors,
  appearance,
  background,
  foreground,
}: {
  colors: Record<string, unknown>
  appearance: ThemeAppearance
  background: string
  foreground: string
}): SemanticThemeTokens => {
  const fallback = appearance === 'dark' || appearance === 'high-contrast-dark'
    ? darkFallbacks
    : lightFallbacks
  const borderKeys = appearance.startsWith('high-contrast')
    ? ['contrastBorder', 'contrastActiveBorder', 'panel.border', 'sideBar.border', 'focusBorder']
    : ['panel.border', 'sideBar.border', 'contrastBorder', 'input.border', 'focusBorder']
  const rawBorder = firstColor(colors, borderKeys, fallback.border)
  const border = appearance.startsWith('high-contrast')
    ? visibleIndicator({ color: rawBorder, against: background, fallback: fallback.border })
    : rawBorder
  const rawLink = firstColor(
    colors,
    ['textLink.foreground', 'focusBorder', 'progressBar.background', 'button.background'],
    fallback.link,
  )
  const rawAccent = firstColor(
    colors,
    ['focusBorder', 'progressBar.background', 'textLink.foreground', 'button.background'],
    rawLink,
  )
  const textPrimary = readableForeground({
    background,
    preferred: foreground,
    underlay: background,
  })
  const surfaceCandidate = firstColor(
    colors,
    ['sideBar.background', 'panel.background', 'editor.background'],
    fallback.surface,
  )
  const surface = contrastRatio(textPrimary, surfaceCandidate, background) >= 4.5
    ? surfaceCandidate
    : background
  const surfaceRaisedCandidate = firstColor(
    colors,
    ['panel.background', 'sideBar.background', 'editorWidget.background', 'editor.background'],
    surface,
  )
  const surfaceRaised = contrastRatio(textPrimary, surfaceRaisedCandidate, background) >= 4.5
    ? surfaceRaisedCandidate
    : surface
  const link = readableAcrossBackgrounds({
    color: rawLink,
    backgrounds: [background, surface],
    underlay: background,
    fallbacks: [fallback.link, textPrimary],
  })
  const accent = visibleIndicator({
    color: rawAccent,
    against: surface,
    fallback: fallback.accent,
  })
  const textMutedCandidate = firstColor(
    colors,
    ['descriptionForeground', 'disabledForeground', 'foreground', 'editor.foreground'],
    fallback.textMuted,
  )
  const textMuted = readableAcrossBackgrounds({
    color: textMutedCandidate,
    backgrounds: [background, surface],
    underlay: background,
    fallbacks: [fallback.textMuted, textPrimary],
  })
  const surfaceMutedCandidate = firstColor(
    colors,
    ['editorWidget.background', 'list.hoverBackground', 'sideBar.background', 'panel.background'],
    fallback.surfaceMuted,
  )
  const surfaceMuted = contrastRatio(textPrimary, surfaceMutedCandidate, surface) >= 4.5
    && contrastRatio(textMuted, surfaceMutedCandidate, surface) >= 4.5
    ? surfaceMutedCandidate
    : surface
  const buttonBackground = firstColor(colors, ['button.background'], fallback.buttonBackground)
  const buttonForeground = readableForeground({
      background: buttonBackground,
      preferred: firstColor(colors, ['button.foreground'], fallback.buttonForeground),
      underlay: surface,
    })
  const buttonHoverCandidate = firstColor(
    colors,
    ['button.hoverBackground', 'button.background'],
    fallback.buttonHoverBackground,
  )
  const buttonHoverBackground = contrastRatio(buttonForeground, buttonHoverCandidate, surface) >= 4.5
    ? buttonHoverCandidate
    : buttonBackground
  const focusCandidate = firstColor(
    colors,
    ['focusBorder', 'contrastActiveBorder', 'textLink.activeForeground'],
    fallback.focus,
  )
  const borderSubtleCandidate = firstColor(
    colors,
    ['panel.border', 'sideBar.border', 'contrastBorder'],
    border,
  )
  const borderSubtle = appearance.startsWith('high-contrast')
    ? visibleIndicator({ color: borderSubtleCandidate, against: surface, fallback: border })
    : borderSubtleCandidate
  const inputBackground = firstColor(colors, ['input.background'], surface)
  const inputBorderCandidate = firstColor(
    colors,
    appearance.startsWith('high-contrast')
      ? ['contrastBorder', 'input.border', 'focusBorder']
      : ['input.border', 'contrastBorder', 'focusBorder'],
    border,
  )
  const statusColor = (keys: readonly string[], statusFallback: string): string =>
    readableSemanticColor({
      color: firstColor(colors, keys, statusFallback),
      background: surface,
      underlay: background,
      fallback: statusFallback,
    })
  const rowHoverCandidate = firstColor(colors, ['list.hoverBackground'], fallback.rowHoverBackground)
  const rowHoverBackground = contrastRatio(textPrimary, rowHoverCandidate, surface) >= 4.5
    ? rowHoverCandidate
    : surface

  return {
    pageBackground: background,
    surface,
    surfaceRaised,
    surfaceMuted,
    textPrimary,
    textMuted,
    border,
    borderSubtle,
    link,
    accent,
    focus: visibleIndicator({ color: focusCandidate, against: background, fallback: fallback.focus }),
    buttonBackground,
    buttonForeground,
    buttonHoverBackground,
    inputBackground,
    inputForeground: readableForeground({
      background: inputBackground,
      preferred: firstColor(colors, ['input.foreground', 'editor.foreground', 'foreground'], textPrimary),
      underlay: surface,
    }),
    inputBorder: appearance.startsWith('high-contrast')
      ? visibleIndicator({ color: inputBorderCandidate, against: inputBackground, fallback: border })
      : inputBorderCandidate,
    inputPlaceholder: readableSemanticColor({
      color: firstColor(colors, ['input.placeholderForeground', 'descriptionForeground'], textMuted),
      background: inputBackground,
      underlay: surface,
      fallback: fallback.textMuted,
    }),
    rowHoverBackground,
    rowSelectedBackground: firstColor(
      colors,
      ['list.activeSelectionBackground', 'list.inactiveSelectionBackground'],
      fallback.rowSelectedBackground,
    ),
    rowSelectedForeground: readableForeground({
      background: firstColor(
        colors,
        ['list.activeSelectionBackground', 'list.inactiveSelectionBackground'],
        fallback.rowSelectedBackground,
      ),
      preferred: firstColor(
        colors,
        ['list.activeSelectionForeground', 'list.inactiveSelectionForeground'],
        fallback.rowSelectedForeground,
      ),
      underlay: surface,
    }),
    codeBackground: firstColor(colors, ['editor.background'], fallback.codeBackground),
    codeForeground: readableForeground({
      background: firstColor(colors, ['editor.background'], fallback.codeBackground),
      preferred: firstColor(colors, ['editor.foreground', 'foreground'], fallback.codeForeground),
      underlay: background,
    }),
    error: statusColor(
      ['errorForeground', 'notificationsErrorIcon.foreground', 'editorError.foreground'],
      fallback.error,
    ),
    warning: statusColor(
      ['notificationsWarningIcon.foreground', 'editorWarning.foreground'],
      fallback.warning,
    ),
    success: statusColor(['testing.iconPassed', 'terminal.ansiGreen'], fallback.success),
    info: statusColor(
      ['notificationsInfoIcon.foreground', 'editorInfo.foreground', 'textLink.foreground'],
      fallback.info,
    ),
    progress: visibleIndicator({
      color: firstColor(colors, ['progressBar.background', 'focusBorder', 'textLink.foreground'], accent),
      against: surfaceMuted,
      fallback: fallback.progress,
    }),
  }
}

export const parseVsCodeTheme = ({
  source,
  fileName,
}: {
  source: string
  fileName: string
}): NormalizedTheme => {
  const errors: ParseError[] = []
  const parsed: unknown = parse(source, errors, { allowTrailingComma: true })
  const firstError = errors[0]
  if (firstError) {
    const { line, column } = lineAndColumn(source, firstError.offset)
    throw new ThemeValidationError(
      'malformed-json',
      `The theme could not be parsed (${printParseErrorCode(firstError.error)} at line ${line}, column ${column}).`,
    )
  }
  if (!isRecord(parsed)) {
    throw new ThemeValidationError('invalid-shape', 'The theme file must contain a JSON object.')
  }
  if (parsed.name !== undefined && typeof parsed.name !== 'string') {
    throw new ThemeValidationError('invalid-shape', 'The theme name must be a string when provided.')
  }
  if (!isRecord(parsed.colors)) {
    throw new ThemeValidationError('invalid-shape', 'The theme must contain a "colors" object.')
  }

  const colors = parsed.colors
  for (const key of supportedColorKeys) {
    const value = colors[key]
    if (value !== undefined && !isSupportedSourceColor(value)) {
      throw new ThemeValidationError(
        'invalid-color',
        `The color for "${key}" must be a 3-, 4-, 6-, or 8-digit hexadecimal value.`,
      )
    }
  }

  const background = firstColor(
    colors,
    ['editor.background', 'sideBar.background', 'panel.background'],
    '',
  )
  const foreground = firstColor(colors, ['editor.foreground', 'foreground'], '')
  if (!background || !foreground) {
    throw new ThemeValidationError(
      'missing-colors',
      'The theme must define a supported background color and foreground color.',
    )
  }

  const appearance = parseAppearance(parsed.type, background)
  const fallback = appearance === 'dark' || appearance === 'high-contrast-dark'
    ? darkFallbacks
    : lightFallbacks
  const safeBackground = opaqueBackground(background, fallback.pageBackground)
  return {
    name: (parsed.name?.trim().replace(/\s+/g, ' ').slice(0, 80)) || themeNameFromFile(fileName),
    appearance,
    tokens: mapSemanticTokens({
      colors,
      appearance,
      background: safeBackground,
      foreground,
    }),
  }
}

export const isNormalizedTheme = (value: unknown): value is NormalizedTheme => {
  if (
    !isRecord(value)
    || typeof value.name !== 'string'
    || value.name.trim().length === 0
    || value.name.length > 80
  ) {
    return false
  }
  const appearance = value.appearance
  if (
    appearance !== 'light'
    && appearance !== 'dark'
    && appearance !== 'high-contrast-light'
    && appearance !== 'high-contrast-dark'
  ) return false
  const tokens = value.tokens
  if (!isRecord(tokens) || Object.keys(tokens).length !== semanticTokenKeys.length) return false
  return semanticTokenKeys.every(key => isNormalizedColor(tokens[key]))
}

export { semanticTokenKeys }
