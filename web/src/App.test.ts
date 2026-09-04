// @vitest-environment happy-dom

import { DOMWrapper, enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseVsCodeTheme } from '@filipgutica/ui/theme'
import type { ImportJobStatus } from '@shared/contracts'

import App from './App.vue'
import { apiKey, type ApiClient } from './api'
import SettingsView from './views/SettingsView.vue'

const importedTheme = parseVsCodeTheme({
  fileName: 'fixture.json',
  source: JSON.stringify({
    name: 'Fixture',
    type: 'dark',
    colors: {
      'editor.background': '#101010',
      'editor.foreground': '#F0F0F0',
    },
  }),
})

const idleImport: ImportJobStatus = {
  state: 'idle',
  phase: null,
  startedAt: null,
  completedAt: null,
  progress: {
    filesTotal: 0,
    filesProcessed: 0,
    filesImported: 0,
    filesSkipped: 0,
    recordsInserted: 0,
    recordsUnchanged: 0,
    currentFile: null,
  },
  warningCount: 0,
  warnings: [],
  error: null,
}

const api: ApiClient = {
  getOverview: async () => { throw new Error('Not used') },
  getToolHealth: async () => { throw new Error('Not used') },
  getDiagnostics: async () => { throw new Error('Not used') },
  getProject: async () => { throw new Error('Not used') },
  getSession: async () => { throw new Error('Not used') },
  getPatterns: async () => [],
  getEvidence: async () => { throw new Error('Not used') },
  updateCorrection: async () => undefined,
  createCorrection: async () => undefined,
  updateSignal: async () => undefined,
  getImportStatus: async () => idleImport,
  startImport: async () => idleImport,
  cancelImport: async () => idleImport,
}

const mountSettings = async ({
  themeApi = {},
  apiOverrides = {},
}: {
  themeApi?: Record<string, unknown>
  apiOverrides?: Partial<ApiClient>
} = {}): Promise<VueWrapper> => {
  Object.defineProperty(window, 'turnscope', {
    configurable: true,
    value: {
      getImportedTheme: vi.fn().mockResolvedValue(null),
      importVsCodeTheme: vi.fn(),
      searchOpenVsxThemes: vi.fn().mockResolvedValue({ status: 'success', themes: [] }),
      importOpenVsxTheme: vi.fn(),
      removeImportedTheme: vi.fn().mockResolvedValue({ status: 'success' }),
      ...themeApi,
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'activity', component: { template: '<div>Activity</div>' } },
      { path: '/settings/diagnostics', name: 'patterns', component: { template: '<div>Patterns</div>' } },
      { path: '/settings', name: 'settings', component: SettingsView },
    ],
  })
  await router.push('/settings')
  await router.isReady()
  const wrapper = mount(App, {
    global: {
      plugins: [router],
      provide: { [apiKey as symbol]: { ...api, ...apiOverrides } },
    },
  })
  await flushPromises()
  return wrapper
}

const buttonWithText = (wrapper: VueWrapper, label: string) => {
  const localButton = wrapper.findAll('button').find(button => button.text() === label)
  if (localButton) return localButton
  const teleportedButton = Array.from(document.body.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === label)
  return teleportedButton ? new DOMWrapper(teleportedButton) : undefined
}

const documentBody = () => new DOMWrapper(document.body)

const themeChoice = (wrapper: VueWrapper, value: 'system' | 'light' | 'dark' | 'imported') =>
  wrapper.get<HTMLInputElement>(`input[name="color-scheme"][value="${value}"]`)

describe('settings and theme controls', () => {
  enableAutoUnmount(afterEach)

  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('style')
    document.documentElement.className = ''
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
  })

  it('moves appearance and source controls to the Settings page', async () => {
    const wrapper = await mountSettings()

    expect(wrapper.get('nav').text()).toContain('Settings')
    expect(wrapper.get('nav').text()).toContain('Activity')
    expect(wrapper.get('nav').text()).not.toContain('Overview')
    expect(wrapper.get('nav').text()).not.toContain('Tool Health')
    expect(wrapper.get('nav').text()).not.toContain('Patterns')
    expect(wrapper.get('.theme-picker legend').text()).toBe('Color scheme')
    expect(wrapper.findAll('.theme-choice')).toHaveLength(3)
    expect(themeChoice(wrapper, 'system').element.checked).toBe(true)
    expect(wrapper.find('input[aria-label="Search Open VSX themes"]').exists()).toBe(false)
    await buttonWithText(wrapper, 'Add theme')?.trigger('click')
    expect(documentBody().get('[role="dialog"]').text()).toContain('Add a theme')
    documentBody().get('input[aria-label="Search Open VSX themes"]')
    expect(buttonWithText(wrapper, 'Choose theme file…')).toBeDefined()
    await documentBody().get('button[aria-label="Close dialog"]').trigger('click')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.text()).toContain('Codex import')
    expect(wrapper.text()).toContain('Claude Code')
    expect(wrapper.text()).toContain('Planned')
  })

  it('imports, applies, and removes a local theme with clear status text', async () => {
    const removeImportedTheme = vi.fn().mockResolvedValue({ status: 'success' })
    const wrapper = await mountSettings({
      themeApi: {
        importVsCodeTheme: vi.fn().mockResolvedValue({ status: 'success', theme: importedTheme }),
        removeImportedTheme,
      },
    })

    await buttonWithText(wrapper, 'Add theme')?.trigger('click')
    await buttonWithText(wrapper, 'Choose theme file…')?.trigger('click')
    await flushPromises()
    expect(themeChoice(wrapper, 'imported').element.checked).toBe(true)
    expect(wrapper.text()).toContain('Imported and applied Fixture.')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#101010')

    await buttonWithText(wrapper, 'Remove')?.trigger('click')
    await flushPromises()
    expect(removeImportedTheme).toHaveBeenCalledOnce()
    expect(themeChoice(wrapper, 'system').element.checked).toBe(true)
    expect(wrapper.text()).toContain('Imported theme removed. Using System theme.')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('')
  })

  it('preserves a selected built-in theme when removing an inactive imported theme', async () => {
    const wrapper = await mountSettings({
      themeApi: { getImportedTheme: vi.fn().mockResolvedValue(importedTheme) },
    })
    await themeChoice(wrapper, 'light').setValue(true)
    await buttonWithText(wrapper, 'Remove')?.trigger('click')
    await flushPromises()

    expect(themeChoice(wrapper, 'light').element.checked).toBe(true)
    expect(wrapper.text()).toContain('Imported theme removed. Using Light theme.')
  })

  it('updates the status text for every built-in theme transition', async () => {
    const wrapper = await mountSettings()

    await themeChoice(wrapper, 'dark').setValue(true)
    expect(wrapper.text()).toContain('Using Dark theme.')

    await themeChoice(wrapper, 'system').setValue(true)
    expect(wrapper.text()).toContain('Using System theme.')
  })

  it('disables every theme mutation while a local import is pending', async () => {
    let finishImport: ((result: { status: 'success'; theme: typeof importedTheme }) => void) | undefined
    const importVsCodeTheme = vi.fn(() => new Promise<{ status: 'success'; theme: typeof importedTheme }>((resolve) => {
      finishImport = resolve
    }))
    const wrapper = await mountSettings({
      themeApi: {
        getImportedTheme: vi.fn().mockResolvedValue(importedTheme),
        importVsCodeTheme,
      },
    })

    await buttonWithText(wrapper, 'Add theme')?.trigger('click')
    await buttonWithText(wrapper, 'Choose theme file…')?.trigger('click')
    await flushPromises()
    expect(buttonWithText(wrapper, 'Importing…')?.attributes('disabled')).toBeDefined()
    expect(buttonWithText(wrapper, 'Remove')?.attributes('disabled')).toBeDefined()

    finishImport?.({ status: 'success', theme: importedTheme })
    await flushPromises()
    expect(buttonWithText(wrapper, 'Add theme')?.attributes('disabled')).toBeUndefined()
  })

  it('reports picker cancellation and malformed files without changing the built-in theme', async () => {
    const importVsCodeTheme = vi.fn()
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce({
        status: 'error',
        error: { code: 'malformed-json', message: 'The theme could not be parsed at line 3.' },
      })
    const wrapper = await mountSettings({ themeApi: { importVsCodeTheme } })

    await buttonWithText(wrapper, 'Add theme')?.trigger('click')
    await buttonWithText(wrapper, 'Choose theme file…')?.trigger('click')
    await flushPromises()
    expect(themeChoice(wrapper, 'system').element.checked).toBe(true)
    expect(documentBody().text()).toContain('Theme import cancelled.')

    await buttonWithText(wrapper, 'Choose theme file…')?.trigger('click')
    await flushPromises()
    expect(documentBody().get('.theme-status').attributes('data-tone')).toBe('error')
    expect(documentBody().text()).toContain('Error: The theme could not be parsed at line 3.')
  })

  it('restores a persisted imported theme when Electron starts again', async () => {
    window.localStorage.setItem('turnscope-theme', 'imported')
    const wrapper = await mountSettings({
      themeApi: { getImportedTheme: vi.fn().mockResolvedValue(importedTheme) },
    })

    expect(themeChoice(wrapper, 'imported').element.checked).toBe(true)
    expect(document.documentElement.getAttribute('data-theme-name')).toBe('Fixture')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#101010')
  })

  it('blocks theme changes until startup restoration finishes', async () => {
    const staleTheme = parseVsCodeTheme({
      fileName: 'stale.json',
      source: JSON.stringify({
        name: 'Stale',
        type: 'light',
        colors: { 'editor.background': '#EEEEEE', 'editor.foreground': '#222222' },
      }),
    })
    let finishRestore: ((theme: typeof staleTheme) => void) | undefined
    const getImportedTheme = vi.fn(() => new Promise<typeof staleTheme>((resolve) => {
      finishRestore = resolve
    }))
    const wrapper = await mountSettings({
      themeApi: {
        getImportedTheme,
        importVsCodeTheme: vi.fn().mockResolvedValue({ status: 'success', theme: importedTheme }),
      },
    })

    expect(themeChoice(wrapper, 'system').attributes('disabled')).toBeDefined()
    expect(buttonWithText(wrapper, 'Add theme')?.attributes('disabled')).toBeDefined()
    finishRestore?.(staleTheme)
    await flushPromises()
    await buttonWithText(wrapper, 'Add theme')?.trigger('click')
    await buttonWithText(wrapper, 'Choose theme file…')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Fixture')
    expect(wrapper.text()).not.toContain('Stale')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#101010')
  })

  it('allows an import after startup restoration fails', async () => {
    let failRestore: ((error: Error) => void) | undefined
    const getImportedTheme = vi.fn(() => new Promise<typeof importedTheme>((_resolve, reject) => {
      failRestore = reject
    }))
    const wrapper = await mountSettings({
      themeApi: {
        getImportedTheme,
        importVsCodeTheme: vi.fn().mockResolvedValue({ status: 'success', theme: importedTheme }),
      },
    })

    failRestore?.(new Error('late failure'))
    await flushPromises()
    await buttonWithText(wrapper, 'Add theme')?.trigger('click')
    await buttonWithText(wrapper, 'Choose theme file…')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Imported and applied Fixture.')
    expect(themeChoice(wrapper, 'imported').element.checked).toBe(true)
  })

  it('searches Open VSX after typing pauses and applies a selected theme', async () => {
    vi.useFakeTimers()
    const searchOpenVsxThemes = vi.fn().mockResolvedValue({
      status: 'success',
      themes: [{
        id: 'fixture.theme',
        name: 'Fixture Theme',
        publisher: 'fixture',
        description: 'A test theme',
        downloadCount: 1200,
      }],
    })
    const importOpenVsxTheme = vi.fn().mockResolvedValue({ status: 'success', theme: importedTheme })
    const wrapper = await mountSettings({
      themeApi: { searchOpenVsxThemes, importOpenVsxTheme },
    })

    await buttonWithText(wrapper, 'Add theme')?.trigger('click')
    await documentBody().get('input[aria-label="Search Open VSX themes"]').setValue('fixture')
    expect(buttonWithText(wrapper, 'Search')).toBeUndefined()
    expect(searchOpenVsxThemes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(299)
    expect(searchOpenVsxThemes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(searchOpenVsxThemes).toHaveBeenCalledWith('fixture')
    expect(documentBody().text()).toContain('Fixture Theme')
    expect(documentBody().text()).toContain('1.2K downloads')

    await buttonWithText(wrapper, 'Apply theme')?.trigger('click')
    await flushPromises()
    expect(importOpenVsxTheme).toHaveBeenCalledWith('fixture.theme', 'light')
    expect(wrapper.text()).toContain('Added and applied Fixture.')
    expect(themeChoice(wrapper, 'imported').element.checked).toBe(true)
  })

  it('starts Codex imports from Settings', async () => {
    const completed = {
      ...idleImport,
      state: 'completed' as const,
      startedAt: '2026-09-02T12:00:00Z',
      completedAt: '2026-09-02T12:00:01Z',
    }
    const startImport = vi.fn().mockResolvedValue(completed)
    const wrapper = await mountSettings({ apiOverrides: { startImport } })

    await buttonWithText(wrapper, 'Import Codex sessions')?.trigger('click')
    await flushPromises()

    expect(startImport).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Import complete')
  })
})
