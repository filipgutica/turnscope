import { describe, expect, it } from 'vitest'

import {
  applyImportWorkerMessage,
  cancelImportStatus,
  createRunningImportStatus,
} from '../../electron/import-state.js'

describe('import job state', () => {
  it('maps worker progress and completion into renderer status', () => {
    const running = createRunningImportStatus('2026-09-02T12:00:00Z')
    const importing = applyImportWorkerMessage({
      status: running,
      message: {
        type: 'progress',
        progress: {
          phase: 'importing',
          filesTotal: 10,
          filesProcessed: 4,
          filesImported: 2,
          filesSkipped: 2,
          recordsInserted: 40,
          recordsUnchanged: 3,
          warningCount: 1,
          currentFile: 'sessions/four.jsonl',
        },
      },
    })
    const completed = applyImportWorkerMessage({
      status: importing,
      message: {
        type: 'completed',
        completedAt: '2026-09-02T12:01:00Z',
        result: {
          installationId: 'codex-fixture',
          filesScanned: 10,
          filesImported: 3,
          filesSkipped: 7,
          recordsInserted: 50,
          recordsUnchanged: 3,
          warningCount: 1,
          warnings: [{ code: 'version', message: 'Version warning' }],
        },
      },
    })

    expect(importing).toMatchObject({
      state: 'running',
      phase: 'importing',
      warningCount: 1,
      progress: { filesProcessed: 4, currentFile: 'sessions/four.jsonl' },
    })
    expect(completed).toMatchObject({
      state: 'completed',
      phase: null,
      startedAt: '2026-09-02T12:00:00Z',
      completedAt: '2026-09-02T12:01:00Z',
      progress: { filesProcessed: 10, filesImported: 3, filesSkipped: 7 },
      warningCount: 1,
      error: null,
    })
  })

  it('preserves progress when the worker reports a failure', () => {
    const running = createRunningImportStatus('2026-09-02T12:00:00Z')
    const failed = applyImportWorkerMessage({
      status: running,
      message: {
        type: 'failed',
        completedAt: '2026-09-02T12:00:30Z',
        error: 'Unable to read a session file.',
      },
    })

    expect(failed).toMatchObject({
      state: 'failed',
      phase: null,
      completedAt: '2026-09-02T12:00:30Z',
      error: 'Unable to read a session file.',
    })
  })

  it('keeps completed-file progress when the user stops the worker', () => {
    const running = createRunningImportStatus('2026-09-02T12:00:00Z')
    const cancelled = cancelImportStatus({
      ...running,
      progress: { ...running.progress, filesProcessed: 8, filesImported: 8 },
    })

    expect(cancelled).toMatchObject({
      state: 'cancelled',
      phase: null,
      progress: { filesProcessed: 8, filesImported: 8 },
      error: null,
    })
  })
})
