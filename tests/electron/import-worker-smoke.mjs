import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'turnscope-electron-import-'))
const workerPath = join(projectRoot, 'dist-electron/main/import-worker.js')
const sourceRoot = join(projectRoot, 'tests/fixtures/codex')
const databasePath = join(temporaryRoot, 'turnscope.db')

const run = async () => new Promise((resolve, reject) => {
  const worker = new Worker(workerPath)
  let sawProgress = false
  const timeout = setTimeout(() => {
    void worker.terminate()
    reject(new Error('Import worker did not complete within 15 seconds.'))
  }, 15_000)

  worker.postMessage({
    type: 'start',
    databasePath,
    sourceRoot,
  })
  worker.on('message', (message) => {
    if (message?.type === 'progress') sawProgress = true
    if (message?.type === 'failed') {
      clearTimeout(timeout)
      reject(new Error(message.error))
    }
    if (message?.type !== 'completed') return
    clearTimeout(timeout)
    if (!sawProgress) {
      reject(new Error('Import worker completed without reporting progress.'))
      return
    }
    if (message.result.filesScanned !== 1 || message.result.recordsInserted !== 10) {
      reject(new Error(`Unexpected import result: ${JSON.stringify(message.result)}`))
      return
    }
    resolve()
  })
  worker.on('error', (error) => {
    clearTimeout(timeout)
    reject(error)
  })
  worker.on('exit', (code) => {
    if (code !== 0) {
      clearTimeout(timeout)
      reject(new Error(`Import worker exited with code ${code}.`))
    }
  })
})

try {
  await run()
  process.stdout.write('Electron import worker smoke test passed.\n')
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
