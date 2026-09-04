// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import type {
  AnalyticsRange,
  AnalyticsRangeContext,
  CoverageValue,
  OverviewResponse,
  ToolHealthResponse,
} from '@shared/contracts'

import { analyticsRangeKey, createAnalyticsRange } from '../analytics-range'
import { apiKey, type ApiClient } from '../api'
import OverviewView from './OverviewView.vue'

const coverage = (numerator: number, denominator: number, limitation = 'Missing source field limits this result.'): CoverageValue => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? null : numerator / denominator,
  measurementClass: 'derived',
  limitation,
})

const rangeContext = (range: AnalyticsRange): AnalyticsRangeContext => ({
  range,
  label: range === '7d' ? '7 days' : range === '30d' ? '30 days' : 'All time',
  from: range === 'all' ? null : '2026-08-04T00:00:00.000Z',
  to: '2026-09-03T00:00:00.000Z',
  boundaryDescription: 'Inclusive last-activity boundary.',
})

const overviewResponse = (range: AnalyticsRange): OverviewResponse => ({
  range: rangeContext(range),
  recentSessions: { value: 12, unit: 'count', measurementClass: 'direct', evidence: [] },
  sessionsNeedingAttention: { value: null, unit: 'count', measurementClass: 'derived', evidence: [] },
  toolReliabilityCoverage: coverage(4, 5),
  outcomeCoverage: coverage(0, 12, 'The source does not report session outcomes.'),
  sessionSpan: {
    medianMs: 164_000,
    p90Ms: 1_800_000,
    coverage: coverage(10, 12),
    definition: 'First-to-last imported event interval. It is not active agent time.',
  },
  findings: [{
    id: 'finding-1',
    title: 'Fix import workflow',
    sessionTitle: 'Fix import workflow',
    toolCategory: 'terminal',
    toolLabel: 'Terminal',
    status: 'failure',
    occurredAt: '2026-09-03T10:42:00Z',
    reason: 'Source reported this invocation as failed.',
    measurementClass: 'direct',
    evidence: [{ eventId: 'event-1', sessionId: 'session-1', label: 'Open event' }],
  }],
  findingsLimitation: null,
  recentSessionRows: [{
    id: 'session-1',
    threadId: 'thread-1',
    title: 'Fix import workflow',
    startedAt: '2026-09-01T10:00:00Z',
    endedAt: '2026-09-01T10:10:00Z',
    repository: '/work/example',
    model: 'codex',
    eventCount: 3,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    corrections: 0,
    errors: 1,
    attentionStatus: 'needs_attention',
    attentionReason: '1 reported tool issue',
    evidence: [{ eventId: 'event-1', sessionId: 'session-1', label: 'Open event' }],
  }],
  dataHealth: {
    importedSessions: 12,
    lastSuccessfulImport: '2026-09-03T12:00:00Z',
    sources: [],
    tokenUsageCoverage: coverage(2, 12),
    toolStatusCoverage: coverage(4, 5),
    toolTimingCoverage: coverage(0, 5),
    outcomeCoverage: coverage(0, 12),
    activeWarnings: [],
  },
  projectRows: [{
    id: 'project-1',
    name: '<img src=x onerror=alert(1)>',
    repository: '/work/example',
    sessionCount: 1,
    eventCount: 3,
    corrections: 0,
    errors: 1,
    lastActiveAt: '2026-09-01T10:00:00Z',
  }],
})

const toolHealthResponse = (range: AnalyticsRange): ToolHealthResponse => ({
  range: rangeContext(range),
  totalInvocations: 6,
  statusCoverage: coverage(4, 6),
  timingCoverage: coverage(0, 6),
  categories: [
    {
      id: 'tool-terminal',
      category: 'terminal',
      label: 'Terminal',
      rawNames: [{ name: 'exec', invocations: 5 }],
      uniqueInvocations: 5,
      statusCoverage: coverage(4, 5),
      successfulInvocations: 3,
      failedInvocations: 1,
      successRate: coverage(3, 4),
      affectedSessions: 2,
      permissionRejections: 0,
      cancellations: 0,
      interventionLimitation: 'Only reported values contribute.',
      repeatInvocations: null,
      repeatCoverage: coverage(0, 5),
      medianDurationMs: null,
      p90DurationMs: null,
      timingCoverage: coverage(0, 5),
      evidence: [{
        eventId: 'event-1',
        sessionId: 'session-1',
        label: 'Fix import workflow · exec',
        sessionTitle: 'Fix import workflow',
        rawToolName: 'exec',
        sourceStatus: 'failed',
        status: 'failure',
        occurredAt: '2026-09-03T10:42:00Z',
      }],
    },
    {
      id: 'tool-other',
      category: 'other',
      label: 'Unclassified',
      rawNames: [{ name: 'dynamic_tool_call', invocations: 1 }],
      uniqueInvocations: 1,
      statusCoverage: coverage(0, 1),
      successfulInvocations: 0,
      failedInvocations: 0,
      successRate: coverage(0, 0),
      affectedSessions: 1,
      permissionRejections: null,
      cancellations: null,
      interventionLimitation: 'Only reported values contribute.',
      repeatInvocations: null,
      repeatCoverage: coverage(0, 1),
      medianDurationMs: null,
      p90DurationMs: null,
      timingCoverage: coverage(0, 1),
      evidence: [],
    },
  ],
  dataHealth: overviewResponse(range).dataHealth,
  limitation: 'Exact source identifiers are required.',
})

const mountOverview = async ({
  getOverview,
  getToolHealth,
}: {
  getOverview: ApiClient['getOverview']
  getToolHealth: ApiClient['getToolHealth']
}) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'activity', component: OverviewView },
      { path: '/tools/:category', name: 'tool-detail', component: { template: '<div />' } },
      { path: '/sessions/:id', name: 'session', component: { template: '<div />' } },
      { path: '/settings', name: 'settings', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(OverviewView, {
    global: {
      plugins: [router],
      provide: {
        [apiKey as symbol]: { getOverview, getToolHealth } as ApiClient,
        [analyticsRangeKey as symbol]: createAnalyticsRange(),
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('Activity view', () => {
  it('renders the approved evidence and tool-use hierarchy without dashboard noise', async () => {
    const wrapper = await mountOverview({
      getOverview: async ({ range = '30d' } = {}) => overviewResponse(range),
      getToolHealth: async ({ range = '30d' } = {}) => toolHealthResponse(range),
    })

    expect(wrapper.get('h1').text()).toBe('Activity')
    expect(wrapper.text()).toContain('Observed friction')
    expect(wrapper.text()).toContain('Failed')
    expect(wrapper.text()).toContain('Tool usage')
    expect(wrapper.text()).toContain('3 / 4 · 75%')
    expect(wrapper.text()).toContain('Status known for 4 of 6 invocations (66.7%).')
    expect(wrapper.text()).toContain('Timing and outcomes unavailable.')
    expect(wrapper.text()).toContain('Recent sessions')
    expect(wrapper.find('a[href*="/sessions/session-1?event=event-1#event-event-1"]').exists()).toBe(true)
    expect(wrapper.find('a[href*="/tools/terminal"]').exists()).toBe(true)
    expect(wrapper.find('[data-tool-category="other"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Session span')
    expect(wrapper.text()).not.toContain('Sessions needing attention')
    expect(wrapper.text()).not.toContain('Projects')
    expect(wrapper.text()).not.toContain('Data Health')
    expect(wrapper.text()).not.toContain('Refresh')
  })

  it('reloads both aggregate groups from the shared accessible range control', async () => {
    const getOverview = vi.fn(async ({ range = '30d' } = {}) => overviewResponse(range))
    const getToolHealth = vi.fn(async ({ range = '30d' } = {}) => toolHealthResponse(range))
    const wrapper = await mountOverview({ getOverview, getToolHealth })

    expect(getOverview).toHaveBeenCalledWith({ range: '30d' })
    expect(getToolHealth).toHaveBeenCalledWith({ range: '30d' })
    const sevenDays = wrapper.findAll('button').find(button => button.text() === '7 days')
    await sevenDays?.trigger('click')
    await flushPromises()

    expect(getOverview).toHaveBeenLastCalledWith({ range: '7d' })
    expect(getToolHealth).toHaveBeenLastCalledWith({ range: '7d' })
    expect(sevenDays?.attributes('aria-pressed')).toBe('true')
  })

  it('keeps direct friction visible under partial coverage and never renders unknown as zero', async () => {
    const tools = toolHealthResponse('30d')
    tools.statusCoverage = coverage(1, 6)
    tools.categories[0]!.statusCoverage = coverage(1, 5)
    tools.categories[0]!.successRate = coverage(0, 1)
    const wrapper = await mountOverview({
      getOverview: async () => overviewResponse('30d'),
      getToolHealth: async () => tools,
    })

    expect(wrapper.text()).toContain('Failed')
    expect(wrapper.text()).toContain('Status known for 1 of 6 invocations (16.7%).')
    expect(wrapper.text()).toContain('0 / 1 · 0%')
    expect(wrapper.text()).not.toContain('0 / 0 · 0%')
  })

  it('sorts tool rows from keyboard-operable column buttons', async () => {
    const tools = toolHealthResponse('30d')
    tools.categories.splice(1, 0, {
      ...tools.categories[0]!,
      id: 'tool-web',
      category: 'web',
      label: 'Web',
      rawNames: [{ name: 'web', invocations: 8 }],
      uniqueInvocations: 8,
      affectedSessions: 3,
    })
    const wrapper = await mountOverview({
      getOverview: async () => overviewResponse('30d'),
      getToolHealth: async () => tools,
    })

    expect(wrapper.findAll('[data-tool-category]').map(row => row.attributes('data-tool-category')))
      .toEqual(['web', 'terminal'])
    await wrapper.get('button[aria-label="Sort tools by name"]').trigger('click')
    expect(wrapper.findAll('[data-tool-category]').map(row => row.attributes('data-tool-category')))
      .toEqual(['terminal', 'web'])
    expect(wrapper.get('th[aria-sort="ascending"]').text()).toContain('Tool')
  })
})
