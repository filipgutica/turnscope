import type { ImportJobStatus } from '../shared/contracts.js'
import type { ImportWorkerMessage } from './import-worker-messages.js'

const emptyProgress = (): ImportJobStatus['progress'] => ({
  filesTotal: 0,
  filesProcessed: 0,
  filesImported: 0,
  filesSkipped: 0,
  recordsInserted: 0,
  recordsUnchanged: 0,
  currentFile: null,
})

export const createIdleImportStatus = (): ImportJobStatus => ({
  state: 'idle',
  phase: null,
  startedAt: null,
  completedAt: null,
  progress: emptyProgress(),
  warningCount: 0,
  warnings: [],
  error: null,
})

export const createRunningImportStatus = (startedAt: string): ImportJobStatus => ({
  ...createIdleImportStatus(),
  state: 'running',
  phase: 'discovering',
  startedAt,
})

export const failImportStatus = ({
  status,
  error,
  completedAt = new Date().toISOString(),
}: {
  status: ImportJobStatus
  error: string
  completedAt?: string
}): ImportJobStatus => ({
  ...status,
  state: 'failed',
  phase: null,
  completedAt,
  error,
})

export const cancelImportStatus = (status: ImportJobStatus): ImportJobStatus => ({
  ...status,
  state: 'cancelled',
  phase: null,
  completedAt: new Date().toISOString(),
  error: null,
})

export const applyImportWorkerMessage = ({
  status,
  message,
}: {
  status: ImportJobStatus
  message: ImportWorkerMessage
}): ImportJobStatus => {
  if (message.type === 'progress') {
    const { phase, warningCount, ...progress } = message.progress
    return { ...status, phase, progress, warningCount }
  }

  if (message.type === 'failed') {
    return failImportStatus({
      status,
      error: message.error,
      completedAt: message.completedAt,
    })
  }

  return {
    state: 'completed',
    phase: null,
    startedAt: status.startedAt,
    completedAt: message.completedAt,
    progress: {
      filesTotal: message.result.filesScanned,
      filesProcessed: message.result.filesImported + message.result.filesSkipped,
      filesImported: message.result.filesImported,
      filesSkipped: message.result.filesSkipped,
      recordsInserted: message.result.recordsInserted,
      recordsUnchanged: message.result.recordsUnchanged,
      currentFile: null,
    },
    warningCount: message.result.warningCount,
    warnings: message.result.warnings,
    error: null,
  }
}
