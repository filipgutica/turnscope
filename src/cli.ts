#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

import { createCodexAdapter } from './adapters/codex.js'
import { closeDatabase, deleteInstallationData, openDatabase } from './db.js'
import { importFromAdapter } from './importer.js'
import { defaultDatabasePath, defaultSourceRoot } from './paths.js'
import { createServer } from './server.js'

const printJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export const createCli = (): Command => {
  const program = new Command()
    .name('turnscope')
    .description('Local-first observability for development agents')

  program.command('discover')
    .description('Discover the local Codex installation without changing it')
    .option('--source-root <path>', 'Codex data root', defaultSourceRoot())
    .action(async ({ sourceRoot }: { sourceRoot: string }) => {
      printJson(await createCodexAdapter({ sourceRoot }).discover())
    })

  program.command('import')
    .description('Import new or changed Codex rollout files read-only')
    .option('--source-root <path>', 'Codex data root', defaultSourceRoot())
    .option('--database <path>', 'Turnscope database', defaultDatabasePath())
    .action(async ({ sourceRoot, database: databasePath }: { sourceRoot: string; database: string }) => {
      const database = openDatabase({ path: databasePath })
      try {
        printJson(await importFromAdapter({ database, adapter: createCodexAdapter({ sourceRoot }) }))
      } finally {
        closeDatabase(database)
      }
    })

  program.command('serve')
    .description('Serve the local dashboard and API')
    .option('--database <path>', 'Turnscope database', defaultDatabasePath())
    .option('--host <host>', 'Listen host', '127.0.0.1')
    .option('--port <port>', 'Listen port', '4177')
    .option('--token <token>', 'API bearer token')
    .option('--dev', 'Run the API for the Vite development server')
    .action(async ({
      database: databasePath,
      host,
      port,
      token,
      dev,
    }: {
      database: string
      host: string
      port: string
      token?: string
      dev?: boolean
    }) => {
      const database = openDatabase({ path: databasePath })
      const apiToken = token ?? randomBytes(24).toString('base64url')
      const server = createServer({ database, apiToken, ...(dev ? { staticRoot: '/nonexistent' } : {}) })
      server.addHook('onClose', async () => closeDatabase(database))
      await server.listen({ host, port: Number.parseInt(port, 10) })
      process.stdout.write(`Turnscope API: http://${host}:${port}\n`)
      if (dev) {
        process.stdout.write('Dashboard: http://127.0.0.1:5173/?token=turnscope-local-dev\n')
      } else {
        process.stdout.write(`Dashboard: http://${host}:${port}/?token=${encodeURIComponent(apiToken)}\n`)
      }
    })

  program.command('delete')
    .description('Delete one imported installation from Turnscope; source data is untouched')
    .requiredOption('--installation <id>', 'Installation identifier')
    .option('--database <path>', 'Turnscope database', defaultDatabasePath())
    .action(({ installation, database: databasePath }: { installation: string; database: string }) => {
      const database = openDatabase({ path: databasePath })
      try {
        const deleted = deleteInstallationData({ database, installationId: installation })
        printJson({ installationId: installation, deleted })
      } finally {
        closeDatabase(database)
      }
    })

  return program
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntrypoint) await createCli().parseAsync(process.argv)
