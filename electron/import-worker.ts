import { parentPort } from 'node:worker_threads'

import { createCodexAdapter } from '../src/adapters/codex.js'
import { closeDatabase, openDatabase } from '../src/db.js'
import { importFromAdapter } from '../src/importer.js'
import { redactText } from '../src/redaction.js'
import {
  isImportWorkerStartMessage,
  type ImportWorkerMessage,
} from './import-worker-messages.js'

const port = parentPort
if (!port) throw new Error('Turnscope import worker requires a parent port.')

const send = (message: ImportWorkerMessage): void => port.postMessage(message)

let started = false

port.on('message', (message: unknown) => {
  if (started || !isImportWorkerStartMessage(message)) return
  started = true

  void (async () => {
    const database = openDatabase({ path: message.databasePath })
    try {
      const result = await importFromAdapter({
        database,
        adapter: createCodexAdapter({ sourceRoot: message.sourceRoot }),
        onProgress: (progress) => send({ type: 'progress', progress }),
      })
      send({
        type: 'completed',
        completedAt: new Date().toISOString(),
        result: {
          ...result,
          warningCount: result.warnings.length,
          warnings: result.warnings.slice(0, 20),
        },
      })
      process.exitCode = 0
    } catch (error) {
      send({
        type: 'failed',
        completedAt: new Date().toISOString(),
        error: redactText(error instanceof Error ? error.message : String(error)),
      })
      process.exitCode = 1
    } finally {
      closeDatabase(database)
      port.close()
    }
  })()
})
