import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import type { ImportJobStatus } from '../shared/contracts.js'
import { defaultDatabasePath, defaultSourceRoot } from '../src/paths.js'
import {
  applyImportWorkerMessage,
  cancelImportStatus,
  createIdleImportStatus,
  createRunningImportStatus,
  failImportStatus,
} from './import-state.js'
import {
  isImportWorkerMessage,
  type ImportWorkerStartMessage,
} from './import-worker-messages.js'

export interface ImportManager {
  getStatus: () => ImportJobStatus
  start: () => ImportJobStatus
  cancel: () => ImportJobStatus
  stop: () => void
}

export const createImportManager = (): ImportManager => {
  let worker: Worker | undefined
  let status = createIdleImportStatus()

  const start = (): ImportJobStatus => {
    if (status.state === 'running') return status

    const startedAt = new Date().toISOString()
    status = createRunningImportStatus(startedAt)

    let child: Worker
    try {
      child = new Worker(join(__dirname, 'import-worker.js'))
      worker = child
    } catch (error) {
      status = failImportStatus({
        status,
        error: error instanceof Error ? error.message : 'Unable to start the import process.',
      })
      return status
    }

    const message: ImportWorkerStartMessage = {
      type: 'start',
      databasePath: defaultDatabasePath(),
      sourceRoot: defaultSourceRoot(),
    }
    child.postMessage(message)
    child.on('message', (message: unknown) => {
      if (worker !== child || !isImportWorkerMessage(message)) return

      status = applyImportWorkerMessage({ status, message })
    })
    child.on('error', (error) => {
      if (worker !== child || status.state !== 'running') return
      status = failImportStatus({
        status,
        error: `Import worker failed: ${error instanceof Error ? error.message : String(error)}`,
      })
    })
    child.on('exit', (code) => {
      if (worker !== child) return
      worker = undefined
      if (status.state !== 'running') return
      status = failImportStatus({
        status,
        error: `Import process exited unexpectedly (code ${code}).`,
      })
    })

    return status
  }

  return {
    getStatus: () => status,
    start,
    cancel: () => {
      if (status.state !== 'running' || !worker) return status
      const runningWorker = worker
      worker = undefined
      status = cancelImportStatus(status)
      void runningWorker.terminate()
      return status
    },
    stop: () => {
      void worker?.terminate()
      worker = undefined
    },
  }
}
