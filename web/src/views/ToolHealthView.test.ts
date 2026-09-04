// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import type { AnalyticsRange, CoverageValue, ToolHealthResponse } from '@shared/contracts'

import { analyticsRangeKey, createAnalyticsRange } from '../analytics-range'
import { apiKey, type ApiClient } from '../api'
import ToolHealthView from './ToolHealthView.vue'

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
  totalInvocations: 5,
  statusCoverage: coverage(4, 5),
  timingCoverage: coverage(1, 5),
  categories: [
    {
      id: 'tool-terminal',
      category: 'terminal',
      label: 'Terminal',
      uniqueInvocations: 4,
      statusCoverage: coverage(4, 4),
      successfulInvocations: 3,
      failedInvocations: 1,
      successRate: coverage(3, 4),
      affectedSessions: 2,
      permissionRejections: 1,
      cancellations: null,
      interventionLimitation: 'Only explicitly reported values are shown.',
      repeatInvocations: 1,
      repeatCoverage: coverage(4, 4),
      medianDurationMs: 500,
      p90DurationMs: 1_500,
      timingCoverage: coverage(1, 4),
      evidence: [{ eventId: 'event-1', sessionId: 'session-1', label: 'Build task · exec_command' }],
    },
    {
      id: 'tool-search',
      category: 'search',
      label: 'Search',
      uniqueInvocations: 1,
      statusCoverage: coverage(0, 1),
      successfulInvocations: 0,
      failedInvocations: 0,
      successRate: coverage(0, 0),
      affectedSessions: 1,
      permissionRejections: null,
      cancellations: null,
      interventionLimitation: 'Only explicitly reported values are shown.',
      repeatInvocations: null,
      repeatCoverage: coverage(0, 1),
      medianDurationMs: null,
      p90DurationMs: null,
      timingCoverage: coverage(0, 1),
      evidence: [],
    },
  ],
  dataHealth: {
    importedSessions: 3,
    lastSuccessfulImport: null,
    sources: [],
    tokenUsageCoverage: coverage(0, 3),
    toolStatusCoverage: coverage(4, 5),
    toolTimingCoverage: coverage(1, 5),
    outcomeCoverage: coverage(0, 3),
    activeWarnings: [],
  },
  limitation: 'Exact source identifiers are required; records are never paired by label or timestamp.',
})

const mountView = async (getToolHealth: ApiClient['getToolHealth']) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tool-health', component: ToolHealthView },
      { path: '/sessions/:id', name: 'session', component: { template: '<div />' } },
    ],
  })
  await router.push('/tool-health')
  await router.isReady()
  const wrapper = mount(ToolHealthView, {
    global: {
      plugins: [router],
      provide: {
        [apiKey as symbol]: { getToolHealth } as ApiClient,
        [analyticsRangeKey as symbol]: createAnalyticsRange(),
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('ToolHealthView', () => {
  it('renders rates with denominators, explicit missing values, and evidence links', async () => {
    const getToolHealth = vi.fn(async ({ range = '30d' } = {}) => response(range))
    const wrapper = await mountView(getToolHealth)

    expect(getToolHealth).toHaveBeenCalledWith({ range: '30d' })
    expect(wrapper.text()).toContain('4 of 5')
    expect(wrapper.text()).toContain('3 of 4 known')
    expect(wrapper.text()).toContain('Not reported cancelled')
    expect(wrapper.text()).toContain('Median Not reported')
    expect(wrapper.find('a[href*="/sessions/session-1?event=event-1#event-event-1"]').text()).toContain('exec_command')
    expect(wrapper.find('[aria-label="Scrollable tool health table"]').attributes('tabindex')).toBe('0')
  })

  it('sorts from semantic button controls', async () => {
    const wrapper = await mountView(async () => response('30d'))
    const firstLabels = () => wrapper.findAll('tbody th[scope="row"]').map(cell => cell.text())

    expect(firstLabels()).toEqual(['Terminal', 'Search'])
    const categoryHeader = wrapper.findAll('thead button').find(button => button.text().startsWith('Tool category'))
    expect(categoryHeader?.element.tagName).toBe('BUTTON')
    await categoryHeader?.trigger('click')
    expect(firstLabels()).toEqual(['Search', 'Terminal'])
    expect(categoryHeader?.element.parentElement?.getAttribute('aria-sort')).toBe('ascending')
  })

  it('reloads using the shared range state', async () => {
    const getToolHealth = vi.fn(async ({ range = '30d' } = {}) => response(range))
    const wrapper = await mountView(getToolHealth)
    const allTime = wrapper.findAll('button').find(button => button.text() === 'All time')

    await allTime?.trigger('click')
    await flushPromises()

    expect(getToolHealth).toHaveBeenLastCalledWith({ range: 'all' })
    expect(allTime?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('All time')
  })
})
