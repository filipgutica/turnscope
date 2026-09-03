import { computed, onMounted, onUnmounted, ref, watch, type InjectionKey } from 'vue'

import type { TurnscopeThemeApi } from '@shared/api'
import {
  semanticTokenKeys,
  type NormalizedTheme,
  type OpenVsxThemeSummary,
  type SemanticThemeTokens,
} from '@shared/theme'

export type ThemePreference = 'light' | 'dark' | 'system' | 'imported'
export type ResolvedTheme = 'light' | 'dark' | 'imported'

interface ThemeStatus {
  tone: 'neutral' | 'success' | 'error'
  message: string
}

const cssVariables = {
  pageBackground: '--color-bg',
  surface: '--color-surface',
  surfaceRaised: '--color-surface-raised',
  surfaceMuted: '--color-surface-muted',
  textPrimary: '--color-text',
  textMuted: '--color-muted',
  border: '--color-border',
  borderSubtle: '--color-border-subtle',
  link: '--color-link',
  accent: '--color-accent',
  focus: '--color-focus',
  buttonBackground: '--color-button-bg',
  buttonForeground: '--color-button-text',
  buttonHoverBackground: '--color-button-hover',
  inputBackground: '--color-input-bg',
  inputForeground: '--color-input-text',
  inputBorder: '--color-input-border',
  inputPlaceholder: '--color-input-placeholder',
  rowHoverBackground: '--color-row-hover',
  rowSelectedBackground: '--color-row-selected',
  rowSelectedForeground: '--color-row-selected-text',
  codeBackground: '--color-code',
  codeForeground: '--color-code-text',
  error: '--color-error',
  warning: '--color-warning',
  success: '--color-success',
  info: '--color-info',
  progress: '--color-progress',
} satisfies Record<keyof SemanticThemeTokens, string>

interface ThemeRoot {
  classList: { toggle: (name: string, enabled: boolean) => unknown }
  style: {
    setProperty: (name: string, value: string) => unknown
    removeProperty: (name: string) => unknown
  }
  setAttribute: (name: string, value: string) => unknown
  removeAttribute: (name: string) => unknown
}

export const resolveTheme = ({
  preference,
  systemDark,
}: {
  preference: ThemePreference
  systemDark: boolean
}): ResolvedTheme => {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export const applyTheme = ({
  root,
  resolvedTheme,
  importedTheme,
}: {
  root: ThemeRoot
  resolvedTheme: ResolvedTheme
  importedTheme: NormalizedTheme | null
}): void => {
  const activeImport = resolvedTheme === 'imported' ? importedTheme : null
  for (const key of semanticTokenKeys) {
    const variable = cssVariables[key]
    if (activeImport) root.style.setProperty(variable, activeImport.tokens[key])
    else root.style.removeProperty(variable)
  }

  const appearance = activeImport?.appearance ?? resolvedTheme
  const isDark = appearance === 'dark' || appearance === 'high-contrast-dark'
  const isHighContrast = appearance === 'high-contrast-dark' || appearance === 'high-contrast-light'
  root.classList.toggle('dark', isDark)
  root.classList.toggle('high-contrast', isHighContrast)
  root.setAttribute('data-theme', resolvedTheme)
  if (activeImport) root.setAttribute('data-theme-name', activeImport.name)
  else root.removeAttribute('data-theme-name')
}

const storedPreference = (): ThemePreference => {
  const value = localStorage.getItem('turnscope-theme')
  if (value === 'light' || value === 'dark' || value === 'imported') return value
  return 'system'
}

export const useTheme = (themeApi: TurnscopeThemeApi | undefined = window.turnscope) => {
  const preference = ref<ThemePreference>(storedPreference())
  const importedTheme = ref<NormalizedTheme | null>(null)
  const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const status = ref<ThemeStatus | null>(null)
  const isRestoringImportedTheme = ref(true)
  const isImporting = ref(false)
  const isRemovingImportedTheme = ref(false)
  const isSearchingOpenVsx = ref(false)
  const installingOpenVsxId = ref<string | null>(null)
  const isChangingTheme = computed(() =>
    isRestoringImportedTheme.value
    || isImporting.value
    || isRemovingImportedTheme.value
    || installingOpenVsxId.value !== null)
  const openVsxResults = ref<OpenVsxThemeSummary[]>([])
  const openVsxError = ref<string | null>(null)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let themeRevision = 0
  const resolvedTheme = computed<ResolvedTheme>(() => {
    if (preference.value === 'imported' && !importedTheme.value) {
      return systemDark.value ? 'dark' : 'light'
    }
    return resolveTheme({ preference: preference.value, systemDark: systemDark.value })
  })

  const handleSystemChange = (event: MediaQueryListEvent): void => {
    systemDark.value = event.matches
  }

  const loadImportedTheme = async (): Promise<void> => {
    const revision = themeRevision
    try {
      if (!themeApi) {
        if (preference.value === 'imported') preference.value = 'system'
        return
      }
      const restoredTheme = await themeApi.getImportedTheme()
      if (revision !== themeRevision) return
      importedTheme.value = restoredTheme
      if (preference.value === 'imported' && !importedTheme.value) {
        preference.value = 'system'
        status.value = {
          tone: 'neutral',
          message: 'The imported theme is unavailable. Using System theme.',
        }
      }
    } catch {
      if (revision !== themeRevision) return
      if (preference.value === 'imported') preference.value = 'system'
      status.value = {
        tone: 'error',
        message: 'Turnscope could not restore the imported theme. Using System theme.',
      }
    } finally {
      isRestoringImportedTheme.value = false
    }
  }

  const importTheme = async (): Promise<void> => {
    if (!themeApi) {
      status.value = { tone: 'error', message: 'Theme import is available in the desktop app.' }
      return
    }
    if (isChangingTheme.value) return
    themeRevision += 1
    isImporting.value = true
    try {
      const result = await themeApi.importVsCodeTheme()
      if (result.status === 'cancelled') {
        status.value = { tone: 'neutral', message: 'Theme import cancelled.' }
      } else if (result.status === 'error') {
        status.value = { tone: 'error', message: result.error.message }
      } else {
        importedTheme.value = result.theme
        preference.value = 'imported'
        status.value = { tone: 'success', message: `Imported and applied ${result.theme.name}.` }
      }
    } catch {
      status.value = { tone: 'error', message: 'Turnscope could not import the selected theme.' }
    } finally {
      isImporting.value = false
    }
  }

  const removeImportedTheme = async (): Promise<void> => {
    if (!themeApi || isChangingTheme.value) return
    themeRevision += 1
    isRemovingImportedTheme.value = true
    const previousPreference = preference.value
    try {
      const result = await themeApi.removeImportedTheme()
      if (result.status === 'error') {
        status.value = { tone: 'error', message: result.error.message }
        return
      }
      importedTheme.value = null
      if (previousPreference === 'imported') preference.value = 'system'
      const activePreference = previousPreference === 'imported' ? 'System' : previousPreference[0]!.toUpperCase() + previousPreference.slice(1)
      status.value = {
        tone: 'success',
        message: `Imported theme removed. Using ${activePreference} theme.`,
      }
    } catch {
      status.value = { tone: 'error', message: 'Turnscope could not remove the imported theme.' }
    } finally {
      isRemovingImportedTheme.value = false
    }
  }

  const searchOpenVsxThemes = async (query: string): Promise<void> => {
    if (!themeApi) {
      openVsxError.value = 'Open VSX themes are available in the desktop app.'
      return
    }
    isSearchingOpenVsx.value = true
    openVsxError.value = null
    try {
      const result = await themeApi.searchOpenVsxThemes(query)
      if (result.status === 'error') {
        openVsxResults.value = []
        openVsxError.value = result.message
      } else {
        openVsxResults.value = result.themes
      }
    } catch {
      openVsxResults.value = []
      openVsxError.value = 'Open VSX search is unavailable right now.'
    } finally {
      isSearchingOpenVsx.value = false
    }
  }

  const importOpenVsxTheme = async (extensionId: string): Promise<void> => {
    if (!themeApi) {
      status.value = { tone: 'error', message: 'Open VSX themes are available in the desktop app.' }
      return
    }
    if (isChangingTheme.value) return
    themeRevision += 1
    installingOpenVsxId.value = extensionId
    status.value = null
    try {
      const result = await themeApi.importOpenVsxTheme(
        extensionId,
        resolvedTheme.value === 'dark'
          || importedTheme.value?.appearance === 'dark'
          || importedTheme.value?.appearance === 'high-contrast-dark'
          ? 'dark'
          : 'light',
      )
      if (result.status === 'error') {
        status.value = { tone: 'error', message: result.error.message }
      } else if (result.status === 'success') {
        importedTheme.value = result.theme
        preference.value = 'imported'
        status.value = { tone: 'success', message: `Added and applied ${result.theme.name}.` }
      }
    } catch {
      status.value = { tone: 'error', message: 'Turnscope could not import that Open VSX theme.' }
    } finally {
      installingOpenVsxId.value = null
    }
  }

  watch(
    [resolvedTheme, importedTheme],
    ([nextResolvedTheme, nextImportedTheme]) => applyTheme({
      root: document.documentElement,
      resolvedTheme: nextResolvedTheme,
      importedTheme: nextImportedTheme,
    }),
    { immediate: true },
  )
  watch(preference, (value, previous) => {
    if (value === 'system') localStorage.removeItem('turnscope-theme')
    else localStorage.setItem('turnscope-theme', value)
    if (value !== 'imported' && previous === 'imported' && importedTheme.value) {
      const label = value[0]?.toUpperCase() + value.slice(1)
      status.value = { tone: 'neutral', message: `Using ${label} theme.` }
    }
  })
  onMounted(() => {
    media.addEventListener('change', handleSystemChange)
    void loadImportedTheme()
  })
  onUnmounted(() => media.removeEventListener('change', handleSystemChange))

  return {
    preference,
    importedTheme,
    resolvedTheme,
    status,
    isImporting,
    isChangingTheme,
    isSearchingOpenVsx,
    installingOpenVsxId,
    openVsxResults,
    openVsxError,
    importTheme,
    searchOpenVsxThemes,
    importOpenVsxTheme,
    removeImportedTheme,
  }
}

export type ThemeController = ReturnType<typeof useTheme>
export const themeKey: InjectionKey<ThemeController> = Symbol('turnscope-theme')
