// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import type { AnalyticsRange, AnalyticsRangeContext, CoverageValue, OverviewResponse } from '@shared/contracts'

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
  sessionsNeedingAttention: { value: 1, unit: 'count', measurementClass: 'derived', evidence: [] },
  toolReliabilityCoverage: coverage(8, 10),
  outcomeCoverage: coverage(0, 12, 'The source does not report session outcomes.'),
  sessionSpan: {
    medianMs: 164_000,
    p90Ms: 1_800_000,
    coverage: coverage(10, 12),
    definition: 'First-to-last imported event interval. Session span includes idle and resumed gaps; it is not active agent time and is never summed.',
  },
  findings: [{
    id: 'finding-1',
    title: 'Session needs review',
    reason: '1 tool invocation reported a failure in this range.',
    measurementClass: 'derived',
    evidence: [{ eventId: 'event-1', sessionId: 'session-1', label: 'Open representative source event' }],
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
    evidence: [{ eventId: 'event-1', sessionId: 'session-1', label: 'View reported issue' }],
  }],
  dataHealth: {
    importedSessions: 12,
    lastSuccessfulImport: '2026-09-03T12:00:00Z',
    sources: [{
      id: 'codex-home',
      product: 'Codex',
      productVersion: '1.2.3',
      adapterVersion: 'codex-v1',
      compatibility: 'warning',
      warning: 'Some event kinds are not supported.',
      lastImportedAt: '2026-09-03T12:00:00Z',
    }],
    tokenUsageCoverage: coverage(2, 12),
    toolStatusCoverage: coverage(8, 10),
    toolTimingCoverage: coverage(0, 10),
    outcomeCoverage: coverage(0, 12),
    activeWarnings: [{ code: 'compatibility_codex', message: 'Some event kinds are not supported.' }],
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

const mountOverview = async (getOverview: ApiClient['getOverview']) => {
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
      provide: {
        [apiKey as symbol]: { getOverview } as ApiClient,
        [analyticsRangeKey as symbol]: createAnalyticsRange(),
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('OverviewView', () => {
  it('renders evidence-first summaries with visible coverage and real drill-down links', async () => {
    const getOverview = vi.fn(async ({ range = '30d' } = {}) => overviewResponse(range))
    const wrapper = await mountOverview(getOverview)

    expect(getOverview).toHaveBeenCalledWith({ range: '30d' })
    expect(wrapper.text()).toContain('Recent sessions')
    expect(wrapper.text()).toContain('Sessions needing attention')
    expect(wrapper.text()).toContain('Median span')
    expect(wrapper.text()).toContain('P90 span')
    expect(wrapper.text()).toContain('not active agent time')
    expect(wrapper.text()).toContain('8 of 10')
    expect(wrapper.text()).toContain('0 of 12')
    expect(wrapper.text()).not.toContain('Duration')
    expect(wrapper.find('a[href*="/sessions/session-1?event=event-1#event-event-1"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('uses accessible buttons and reloads with the shared selected range', async () => {
    const getOverview = vi.fn(async ({ range = '30d' } = {}) => overviewResponse(range))
    const wrapper = await mountOverview(getOverview)
    const sevenDays = wrapper.get('button[aria-pressed="false"]')

    expect(sevenDays.text()).toBe('7 days')
    await sevenDays.trigger('click')
    await flushPromises()

    expect(getOverview).toHaveBeenLastCalledWith({ range: '7d' })
    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe('7 days')
    expect(wrapper.text()).toContain('7 days')
  })

  it('shows low-coverage limitations and never renders a missing metric as zero', async () => {
    const response = overviewResponse('30d')
    response.sessionsNeedingAttention = {
      value: null,
      unit: 'count',
      measurementClass: 'derived',
      evidence: [],
      missingReason: 'Tool-status coverage is too low.',
    }
    response.findings = []
    response.findingsLimitation = 'Evidence-backed findings are hidden because coverage is 1 of 10.'
    response.sessionSpan.medianMs = null
    const wrapper = await mountOverview(async () => response)

    expect(wrapper.text()).toContain('Tool-status coverage is too low.')
    expect(wrapper.text()).toContain('Evidence-backed findings are hidden because coverage is 1 of 10.')
    expect(wrapper.text()).toContain('Median spanNot reported')
  })
})
