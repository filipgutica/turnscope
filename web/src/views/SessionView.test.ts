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
        { path: '/', name: 'activity', component: { template: '<div />' } },
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
    expect(wrapper.text()).not.toContain('Session drill-down')
    expect(wrapper.text()).toContain('2 events')
    wrapper.get('input[aria-label="Search events"]')
    wrapper.get('select[aria-label="Filter events by actor"]')
    expect(wrapper.find('img').exists()).toBe(false)

    expect(events[0]!.get('button').text()).toBe('View source')
    await events[0]!.get('button').trigger('click')
    await flushPromises()

    expect(getEvidence).toHaveBeenCalledWith('source-1')
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.textContent).toContain('fixture.jsonl:1')
    expect(document.body.querySelector('script')).toBeNull()
    wrapper.unmount()
  })

  it('keeps inferred correction maintenance out of the session evidence workflow', async () => {
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
    const api = {
      getSession: async () => correctionDetail,
    } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
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

    expect(wrapper.text()).not.toContain('Corrections and steering')
    expect(wrapper.text()).not.toContain('Mark as agent correction')
    expect(wrapper.find('.correction-editor').exists()).toBe(false)
  })

  it('keeps filters mounted and focused while filtered results refresh', async () => {
    let resolveRefresh: ((value: SessionDetailResponse) => void) | undefined
    const refresh = new Promise<SessionDetailResponse>((resolve) => {
      resolveRefresh = resolve
    })
    const getSession = vi.fn<ApiClient['getSession']>()
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(refresh)
    const api = { getSession } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
        { path: '/sessions/:id', name: 'session', component: SessionView },
      ],
    })
    await router.push('/sessions/session-1')
    await router.isReady()
    const wrapper = mount(SessionView, {
      attachTo: document.body,
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    const search = wrapper.get<HTMLInputElement>('input[aria-label="Search events"]')
    search.element.focus()
    await search.setValue('tool')
    await new Promise((resolve) => window.setTimeout(resolve, 225))
    await flushPromises()

    expect(getSession).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.session-timeline').attributes('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(search.element)

    resolveRefresh?.(detail)
    await flushPromises()
    expect(wrapper.get('.session-timeline').attributes('aria-busy')).toBe('false')
    wrapper.unmount()
  })

  it('treats a linked event as independent evidence and hides irrelevant filters', async () => {
    const getSession = vi.fn<ApiClient['getSession']>().mockResolvedValue(detail)
    const api = { getSession } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
        { path: '/sessions/:id', name: 'session', component: SessionView },
      ],
    })
    await router.push('/sessions/session-1?event=event-1')
    await router.isReady()
    const wrapper = mount(SessionView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    expect(getSession).toHaveBeenCalledWith('session-1', {
      limit: 100,
      eventId: 'event-1',
    })
    expect(wrapper.text()).toContain('Linked evidence')
    expect(wrapper.find('input[aria-label="Search events"]').exists()).toBe(false)
    expect(wrapper.find('select[aria-label="Filter events by actor"]').exists()).toBe(false)
  })

  it('explains when linked evidence is unavailable', async () => {
    const emptyDetail: SessionDetailResponse = {
      ...detail,
      timeline: { ...detail.timeline, total: 0, rows: [] },
    }
    const api = {
      getSession: vi.fn<ApiClient['getSession']>().mockResolvedValue(emptyDetail),
    } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
        { path: '/sessions/:id', name: 'session', component: SessionView },
      ],
    })
    await router.push('/sessions/session-1?event=missing-event')
    await router.isReady()
    const wrapper = mount(SessionView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Supporting event unavailable')
    expect(wrapper.text()).toContain('The linked source event is unavailable.')
    expect(wrapper.text()).not.toContain('showing the supporting event')
  })

  it('discards a stale pagination response after filters change', async () => {
    const pagedDetail: SessionDetailResponse = {
      ...detail,
      timeline: { ...detail.timeline, total: 200 },
    }
    const filteredDetail: SessionDetailResponse = {
      ...detail,
      timeline: { ...detail.timeline, total: 0, rows: [] },
    }
    let resolvePage: ((value: SessionDetailResponse) => void) | undefined
    const page = new Promise<SessionDetailResponse>((resolve) => {
      resolvePage = resolve
    })
    const getSession = vi.fn<ApiClient['getSession']>()
      .mockResolvedValueOnce(pagedDetail)
      .mockReturnValueOnce(page)
      .mockResolvedValueOnce(filteredDetail)
    const api = { getSession } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
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

    await wrapper.get('.timeline-viewport').trigger('scroll')
    expect(getSession).toHaveBeenCalledTimes(2)

    await wrapper.get('input[aria-label="Search events"]').setValue('no matches')
    await new Promise((resolve) => window.setTimeout(resolve, 225))
    await flushPromises()
    expect(getSession).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('No events match the current search and filters.')

    resolvePage?.(pagedDetail)
    await flushPromises()
    expect(wrapper.text()).toContain('No events match the current search and filters.')
    expect(wrapper.find('.timeline-event').exists()).toBe(false)
  })

  it('ignores a stale pagination error after filters change', async () => {
    const pagedDetail: SessionDetailResponse = {
      ...detail,
      timeline: { ...detail.timeline, total: 200 },
    }
    let rejectPage: ((reason: Error) => void) | undefined
    const page = new Promise<SessionDetailResponse>((_resolve, reject) => {
      rejectPage = reject
    })
    const getSession = vi.fn<ApiClient['getSession']>()
      .mockResolvedValueOnce(pagedDetail)
      .mockReturnValueOnce(page)
      .mockResolvedValueOnce(detail)
    const api = { getSession } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
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

    await wrapper.get('.timeline-viewport').trigger('scroll')
    await wrapper.get('input[aria-label="Search events"]').setValue('updated filter')
    await new Promise((resolve) => window.setTimeout(resolve, 225))
    await flushPromises()

    rejectPage?.(new Error('stale pagination failed'))
    await flushPromises()
    expect(wrapper.find('.error-message').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('stale pagination failed')
  })
})
