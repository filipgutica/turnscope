// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '../api'
import { apiKey } from '../api'
import PatternsView from './PatternsView.vue'

describe('PatternsView', () => {
  it('shows useful observed diagnostics when no repeated pattern signal exists', async () => {
    const getDiagnostics = vi.fn(async () => ({
      signalCount: 0,
      correctionCandidates: 8,
      countedCorrections: 2,
      correctionCategories: [{
        id: 'correction-agent_mistake',
        category: 'agent_mistake' as const,
        candidates: 2,
        countedCorrections: 2,
        userOverrides: 0,
        evidence: [{ eventId: 'event-1', sessionId: 'session-1', label: 'Event #4' }],
      }],
      failedToolEvents: 3,
      toolFailures: [{
        id: 'tool-command',
        toolName: 'command',
        recordedEvents: 10,
        failures: 3,
        affectedSessions: 2,
        averageFailureDurationMs: 250,
        evidence: [{ eventId: 'event-2', sessionId: 'session-2', label: 'Event #7' }],
      }],
      tokenCoverage: {
        usageRecords: 4,
        sessionsWithUsage: 1,
        totalSessions: 10,
        coverageRatio: 0.1,
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 20,
        limitation: 'Token totals are direct, but wasted-token judgments require outcome attribution and a comparison baseline.',
      },
      skillCoverage: {
        status: 'unavailable' as const,
        reason: 'No normalized skill records.',
      },
      signals: [],
    }))
    const api: ApiClient = {
      getDiagnostics,
      getOverview: async () => { throw new Error('Not used') },
      getProject: async () => { throw new Error('Not used') },
      getSession: async () => { throw new Error('Not used') },
      getPatterns: async () => [],
      getEvidence: async () => { throw new Error('Not used') },
      updateCorrection: async () => undefined,
      createCorrection: async () => undefined,
      updateSignal: async () => undefined,
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/patterns', component: PatternsView },
        { path: '/sessions/:id', name: 'session', component: { template: '<div />' } },
      ],
    })
    await router.push('/patterns')
    await router.isReady()

    const wrapper = mount(PatternsView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    expect(getDiagnostics).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Where did the agent need steering?')
    expect(wrapper.text()).toContain('agent mistake')
    expect(wrapper.text()).toContain('command')
    expect(wrapper.text()).toContain('Not reliably yet')
    expect(wrapper.text()).toContain('Not measurable yet')
    expect(wrapper.text()).toContain('No session contains the same normalized tool failure twice')
    expect(wrapper.find('a[href*="/sessions/session-1"]').exists()).toBe(true)
  })
})
