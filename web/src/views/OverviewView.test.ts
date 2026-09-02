// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import type { ImportJobStatus, OverviewResponse } from '@shared/contracts'

import { apiKey, type ApiClient } from '../api'
import OverviewView from './OverviewView.vue'

const overview: OverviewResponse = {
  projects: {
    value: 1,
    unit: 'count',
    measurementClass: 'derived',
    evidence: [],
  },
  sessions: {
    value: 1,
    unit: 'count',
    measurementClass: 'direct',
    evidence: [],
  },
  inputTokens: {
    value: null,
    unit: 'tokens',
    measurementClass: 'direct',
    evidence: [],
    missingReason: 'Source did not report usage',
  },
  cachedInputTokens: {
    value: 400,
    unit: 'tokens',
    measurementClass: 'direct',
    evidence: [],
  },
  outputTokens: {
    value: 200,
    unit: 'tokens',
    measurementClass: 'direct',
    evidence: [],
  },
  cacheRatio: {
    value: 0.8,
    unit: 'ratio',
    measurementClass: 'derived',
    evidence: [],
  },
  duration: {
    value: 12_000,
    unit: 'milliseconds',
    measurementClass: 'derived',
    evidence: [],
  },
  corrections: {
    value: 0,
    unit: 'count',
    measurementClass: 'inferred',
    evidence: [],
  },
  correctionRate: {
    value: 0,
    unit: 'ratio',
    measurementClass: 'derived',
    evidence: [],
  },
  errors: {
    value: 1,
    unit: 'count',
    measurementClass: 'direct',
    evidence: [],
  },
  projectRows: [
    {
      id: 'project-1',
      name: '<img src=x onerror=alert(1)>',
      repository: '/work/example',
      sessionCount: 1,
      eventCount: 3,
      corrections: 0,
      errors: 1,
      lastActiveAt: '2026-09-01T10:00:00Z',
    },
  ],
}

describe('OverviewView', () => {
  it('shows global metrics and text-only project drill-down without listing sessions', async () => {
    const api = { getOverview: async () => overview } as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: OverviewView },
        { path: '/projects/:id', name: 'project', component: { template: '<div />' } },
        { path: '/sessions/:id', name: 'session', component: { template: '<div />' } },
      ],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(OverviewView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Source did not report usage')
    expect(wrapper.text()).toContain('Derived')
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('a[href="/projects/project-1"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/sessions/session-1"]').exists()).toBe(false)
  })

  it('starts the desktop import from the overview', async () => {
    const idle: ImportJobStatus = {
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
    const completed: ImportJobStatus = {
      ...idle,
      state: 'completed',
      startedAt: '2026-09-02T12:00:00Z',
      completedAt: '2026-09-02T12:00:01Z',
    }
    const startImport = vi.fn(async () => completed)
    const api: ApiClient = {
      getOverview: async () => overview,
      getDiagnostics: async () => { throw new Error('Not used in this test') },
      getProject: async () => { throw new Error('Not used in this test') },
      getSession: async () => { throw new Error('Not used in this test') },
      getPatterns: async () => [],
      getEvidence: async () => { throw new Error('Not used in this test') },
      updateCorrection: async () => undefined,
      createCorrection: async () => undefined,
      updateSignal: async () => undefined,
      getImportStatus: async () => idle,
      startImport,
      cancelImport: async () => completed,
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: OverviewView },
        { path: '/projects/:id', name: 'project', component: { template: '<div />' } },
      ],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(OverviewView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()
    const importButton = wrapper.findAll('button')
      .find((button) => button.text() === 'Import Codex sessions')
    expect(importButton).toBeDefined()
    await importButton?.trigger('click')
    await flushPromises()

    expect(startImport).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Import complete')
    wrapper.unmount()
  })
})
