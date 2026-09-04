// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import type { ProjectDetailResponse } from '@shared/contracts'

import { apiKey, type ApiClient } from '../api'
import ProjectView from './ProjectView.vue'

const detail: ProjectDetailResponse = {
  project: {
    id: 'project-1',
    name: 'alpha',
    repository: '/work/alpha',
    sessionCount: 2,
    eventCount: 7,
    corrections: 1,
    errors: 2,
    lastActiveAt: '2026-09-02T10:00:00Z',
  },
  sessions: {
    total: 2,
    offset: 0,
    limit: 100,
    rows: [
    {
      id: 'session-2',
      threadId: 'thread-2',
      title: '<img src=x onerror=alert(1)>',
      startedAt: '2026-09-02T10:00:00Z',
      endedAt: '2026-09-02T10:00:05Z',
      repository: '/work/alpha',
      model: 'gpt-test',
      eventCount: 4,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      corrections: 1,
      errors: 1,
    },
    {
      id: 'session-1',
      threadId: 'thread-1',
      title: 'Earlier session',
      startedAt: '2026-09-01T10:00:00Z',
      endedAt: '2026-09-01T10:00:05Z',
      repository: '/work/alpha',
      model: 'gpt-test',
      eventCount: 3,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      corrections: 0,
      errors: 1,
    },
    ],
  },
}

describe('ProjectView', () => {
  it('shows project context before its session list', async () => {
    const api = { getProject: async () => detail } as unknown as ApiClient
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'activity', component: { template: '<div />' } },
        { path: '/projects/:id', name: 'project', component: ProjectView },
        { path: '/sessions/:id', name: 'session', component: { template: '<div />' } },
      ],
    })
    await router.push('/projects/project-1')
    await router.isReady()

    const wrapper = mount(ProjectView, {
      global: {
        plugins: [router],
        provide: { [apiKey as symbol]: api },
      },
    })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('alpha')
    expect(wrapper.text()).toContain('/work/alpha')
    expect(wrapper.text()).toContain('7')
    expect(wrapper.findAll('a[href^="/sessions/"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
  })
})
