// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ImportJobStatus } from '@shared/contracts'

import ImportStatusPanel from './ImportStatusPanel.vue'

const runningStatus: ImportJobStatus = {
  state: 'running',
  phase: 'importing',
  startedAt: '2026-09-02T12:00:00Z',
  completedAt: null,
  progress: {
    filesTotal: 100,
    filesProcessed: 42,
    filesImported: 12,
    filesSkipped: 30,
    recordsInserted: 1200,
    recordsUnchanged: 50,
    currentFile: 'sessions/2026/09/02/rollout.jsonl',
  },
  warningCount: 0,
  warnings: [],
  error: null,
}

describe('ImportStatusPanel', () => {
  it('shows honest progress and exposes one stop action instead of another import', async () => {
    const wrapper = mount(ImportStatusPanel, { props: { status: runningStatus } })

    expect(wrapper.get('[role="progressbar"]').attributes()).toMatchObject({
      'aria-valuemax': '100',
      'aria-valuenow': '42',
    })
    expect(wrapper.text()).toContain('42 of 100 files')
    expect(wrapper.text()).toContain('You can keep using Turnscope while this runs.')
    expect(wrapper.get('button').text()).toBe('Stop import')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('shows completion details and a clear re-import action', () => {
    const wrapper = mount(ImportStatusPanel, {
      props: {
        status: {
          ...runningStatus,
          state: 'completed',
          phase: null,
          completedAt: '2026-09-02T12:05:00Z',
          warningCount: 1,
          warnings: [{ code: 'version', message: 'New source version detected.' }],
          progress: { ...runningStatus.progress, filesProcessed: 100 },
        },
      },
    })

    expect(wrapper.text()).toContain('Import complete')
    expect(wrapper.get('button').text()).toBe('Check for new sessions')
    expect(wrapper.text()).toContain('New source version detected.')
  })
})
