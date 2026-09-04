// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'

import type { SessionDetailResponse } from '@shared/contracts'

import { apiKey, type ApiClient } from '../api'
import SessionView from './SessionView.vue'

const detail: SessionDetailResponse = {
  session: {
    id: 'session-1',
    threadId: 'thread-1',
    title: 'Imported session',
    startedAt: '2026-09-01T10:00:00Z',
    endedAt: '2026-09-01T10:00:05Z',
    repository: null,
    model: 'gpt-test',
    eventCount: 2,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    corrections: 0,
    errors: 0,
  },
  timeline: {
    total: 2,
    offset: 0,
    limit: 100,
    rows: [
    {
      id: 'event-2',
      sourceRecordId: 'source-2',
      kind: 'agent_turn',
      actor: 'agent',
      occurredAt: '2026-09-01T10:00:02Z',
      sourceOrder: 2,
      summary: '<img src=x onerror=alert(1)>',
      toolName: null,
      toolStatus: null,
      durationMs: null,
      labels: [],
    },
    {
      id: 'event-1',
      sourceRecordId: 'source-1',
      kind: 'user_turn',
      actor: 'user',
      occurredAt: '2026-09-01T10:00:01Z',
      sourceOrder: 1,
      summary: 'First event',
      toolName: null,
      toolStatus: null,
      durationMs: null,
      labels: [],
    },
    ],
  },
  corrections: [],
  signals: [],
}

describe('SessionView', () => {
  it('orders events by source order and opens their redacted evidence', async () => {
    const getEvidence = vi.fn<ApiClient['getEvidence']>().mockResolvedValue({
      sourceRecordId: 'source-1',
      sourcePointer: 'fixture.jsonl:1',
      sourceSchemaVersion: 'fixture-v1',
      importedAt: '2026-09-01T10:01:00Z',
      redactedPayload: { type: 'message', text: '<script>alert(1)</script>' },
    })
    const api = {
      getSession: async () => detail,
      getEvidence,
    } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'overview', component: { template: '<div />' } },
        { path: '/sessions/:id', name: 'session', component: SessionView },
      ],
    })
    await router.push('/sessions/session-1')
    await router.isReady()

    const wrapper = mount(SessionView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    const events = wrapper.findAll('.timeline-event')
    expect(events.map((event) => event.find('.event-summary').text())).toEqual([
      'First event',
      '<img src=x onerror=alert(1)>',
    ])
    expect(wrapper.find('img').exists()).toBe(false)

    await events[0]!.get('button').trigger('click')
    await flushPromises()

    expect(getEvidence).toHaveBeenCalledWith('source-1')
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.textContent).toContain('fixture.jsonl:1')
    expect(document.body.querySelector('script')).toBeNull()
    wrapper.unmount()
  })

  it('lets the user override an inferred correction classification', async () => {
    const correctionDetail: SessionDetailResponse = {
      ...detail,
      corrections: [{
        id: 'correction-1',
        eventId: 'event-1',
        classificationMethod: 'heuristic',
        inferredCategory: 'agent_mistake',
        category: 'agent_mistake',
        confidence: 0.92,
        explanation: 'The user corrected a likely agent mistake.',
        countsAsCorrection: true,
        hasUserOverride: false,
      }],
    }
    const updateCorrection = vi.fn<ApiClient['updateCorrection']>().mockResolvedValue()
    const api = {
      getSession: async () => correctionDetail,
      updateCorrection,
    } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'overview', component: { template: '<div />' } },
        { path: '/sessions/:id', name: 'session', component: SessionView },
      ],
    })
    await router.push('/sessions/session-1')
    await router.isReady()
    const wrapper = mount(SessionView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    await wrapper.get('.correction-editor select').setValue('approval')
    await wrapper.get('.correction-editor [role="checkbox"]').trigger('click')
    await wrapper.get('.correction-editor').trigger('submit')
    await flushPromises()

    expect(updateCorrection).toHaveBeenCalledWith('correction-1', {
      category: 'approval',
      countsAsCorrection: false,
    })
  })
})
