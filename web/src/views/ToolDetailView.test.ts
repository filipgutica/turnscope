// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import type { AnalyticsRange, CoverageValue, ToolHealthResponse } from '@shared/contracts'

import { analyticsRangeKey, createAnalyticsRange } from '../analytics-range'
import { apiKey } from '../api'
import ToolDetailView from './ToolDetailView.vue'

const coverage = (numerator: number, denominator: number): CoverageValue => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? null : numerator / denominator,
  measurementClass: 'derived',
  limitation: 'Only explicitly reported values contribute.',
})

const response = (range: AnalyticsRange): ToolHealthResponse => ({
  range: {
    range,
    label: range === '7d' ? '7 days' : range === '30d' ? '30 days' : 'All time',
    from: range === 'all' ? null : '2026-08-04T00:00:00.000Z',
    to: '2026-09-03T00:00:00.000Z',
    boundaryDescription: 'Inclusive invocation occurrence boundary.',
  },
  totalInvocations: 4,
  statusCoverage: coverage(3, 4),
  timingCoverage: coverage(0, 4),
  categories: [{
    id: 'tool-terminal',
    category: 'terminal',
    label: 'Terminal',
    rawNames: [{ name: 'exec', invocations: 3 }, { name: 'exec_command', invocations: 1 }],
    uniqueInvocations: 4,
    statusCoverage: coverage(3, 4),
    successfulInvocations: 2,
    failedInvocations: 1,
    successRate: coverage(2, 3),
    affectedSessions: 2,
    permissionRejections: null,
    cancellations: null,
    interventionLimitation: 'Only explicit decisions are shown.',
    repeatInvocations: null,
    repeatCoverage: coverage(0, 4),
    medianDurationMs: null,
    p90DurationMs: null,
    timingCoverage: coverage(0, 4),
    evidence: [{
      eventId: 'event-1',
      sessionId: 'session-1',
      label: 'Build task · exec',
      sessionTitle: 'Build task',
      rawToolName: 'exec',
      sourceStatus: 'failed',
      status: 'failure',
      occurredAt: '2026-09-03T10:42:00Z',
    }],
  }],
  dataHealth: {
    importedSessions: 2,
    lastSuccessfulImport: null,
    sources: [],
    tokenUsageCoverage: coverage(0, 2),
    toolStatusCoverage: coverage(3, 4),
    toolTimingCoverage: coverage(0, 4),
    outcomeCoverage: coverage(0, 2),
    activeWarnings: [],
  },
  limitation: 'Exact identifiers are required.',
})

describe('ToolDetailView', () => {
  it('shows aliases, denominated rates, and exact evidence while omitting unsupported timing', async () => {
    const getToolHealth = vi.fn(async ({ range = '30d' } = {}) => response(range))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
        { path: '/tools/:category', name: 'tool-detail', component: ToolDetailView },
        { path: '/sessions/:id', name: 'session', component: { template: '<div />' } },
        { path: '/settings', name: 'settings', component: { template: '<div />' } },
      ],
    })
    await router.push('/tools/terminal')
    await router.isReady()
    const wrapper = mount(ToolDetailView, {
      global: {
        plugins: [router],
        provide: {
          [apiKey as symbol]: { getToolHealth },
          [analyticsRangeKey as symbol]: createAnalyticsRange(),
        },
      },
    })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Terminal')
    expect(wrapper.text()).toContain('3 of 4')
    expect(wrapper.text()).toContain('2 / 3 · 66.7%')
    expect(wrapper.text()).toContain('exec_command')
    expect(wrapper.text()).toContain('Build task')
    expect(wrapper.text()).toContain('exec · failed')
    expect(wrapper.text()).not.toContain('Execution time')
    expect(wrapper.find('a[href*="/sessions/session-1?event=event-1#event-event-1"]').exists()).toBe(true)
  })
})
