import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDiagnostics, getOverview, getToolHealth, listPatterns } from '../../src/analytics.js'
import { createCodexAdapter } from '../../src/adapters/codex.js'
import type { SourceAdapter } from '../../src/adapters/types.js'
import { closeDatabase, openDatabase } from '../../src/db.js'
import { importFromAdapter } from '../../src/importer.js'

const databases: ReturnType<typeof openDatabase>[] = []

const createFixtureSource = () => {
  const root = mkdtempSync(join(tmpdir(), 'turnscope-source-'))
  cpSync(join(import.meta.dirname, '../fixtures/codex'), root, { recursive: true })
  return root
}

const createTestDatabase = () => {
  const root = mkdtempSync(join(tmpdir(), 'turnscope-db-'))
  const database = openDatabase({ path: join(root, 'turnscope.db') })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database)
})

describe('Codex import', () => {
  it('reports deterministic progress as files are processed', async () => {
    const sourceRoot = createFixtureSource()
    const database = createTestDatabase()
    const progress: {
      phase: string
      filesTotal: number
      filesProcessed: number
      filesImported: number
      filesSkipped: number
      recordsInserted: number
    }[] = []

    await importFromAdapter({
      database,
      adapter: createCodexAdapter({ sourceRoot }),
      onProgress: (update) => progress.push(update),
    })

    expect(progress.map(({ phase }) => phase)).toEqual([
      'discovering',
      'importing',
      'importing',
      'analyzing',
    ])
    expect(progress.at(-2)).toMatchObject({
      filesTotal: 1,
      filesProcessed: 1,
      filesImported: 1,
      filesSkipped: 0,
      recordsInserted: 10,
    })
  })

  it('imports incrementally, preserves stable identities, and computes evidence-backed metrics', async () => {
    const sourceRoot = createFixtureSource()
    const database = createTestDatabase()
    const adapter = createCodexAdapter({ sourceRoot })
    const readSourceFile = vi.spyOn(adapter, 'readSourceFile')

    const first = await importFromAdapter({ database, adapter })
    const firstEventIds = database
      .prepare('SELECT id FROM events ORDER BY source_order')
      .all() as { id: string }[]
    const second = await importFromAdapter({ database, adapter })
    const secondEventIds = database
      .prepare('SELECT id FROM events ORDER BY source_order')
      .all() as { id: string }[]

    expect(first.filesImported).toBe(1)
    expect(first.recordsInserted).toBe(10)
    expect(second.filesImported).toBe(0)
    expect(second.filesSkipped).toBe(1)
    expect(second.recordsInserted).toBe(0)
    expect(secondEventIds).toEqual(firstEventIds)
    expect(readSourceFile).toHaveBeenCalledTimes(1)
    expect(getOverview(database, { range: 'all' }).dataHealth.activeWarnings)
      .toContainEqual(expect.objectContaining({ code: 'undocumented_source_format' }))
    const normalizedIdentity = database.prepare(`
      SELECT s.id AS sessionId, s.thread_id AS threadId, t.source_thread_id AS sourceThreadId
      FROM sessions s INNER JOIN threads t ON t.id = s.thread_id
    `).get() as { sessionId: string; threadId: string; sourceThreadId: string }
    expect(normalizedIdentity.sessionId).not.toBe(normalizedIdentity.threadId)
    expect(normalizedIdentity.sourceThreadId).toBe('fixture-thread-001')

    const storedText = database.prepare(`
      SELECT GROUP_CONCAT(summary, ' ') AS value FROM events
    `).get() as { value: string }
    const storedTitle = database.prepare('SELECT title FROM sessions LIMIT 1').get() as { title: string }
    expect(storedText.value).not.toContain('sk-example-secret')
    expect(storedText.value).toContain('[REDACTED]')
    expect(storedTitle.title).not.toContain('sk-example-secret')

    const overview = getOverview(database)
    expect(overview.recentSessions.value).toBe(1)
    expect(overview.sessionSpan.medianMs).toBe(9000)
    expect(overview.sessionSpan.p90Ms).toBe(9000)
    expect(overview.dataHealth.tokenUsageCoverage).toMatchObject({ numerator: 1, denominator: 1, ratio: 1 })
    const diagnostics = getDiagnostics(database)
    expect(diagnostics.tokenCoverage).toMatchObject({ inputTokens: 1300, cachedInputTokens: 500, outputTokens: 300 })
    expect(diagnostics.countedCorrections).toBe(1)

    const patterns = listPatterns(database)
    expect(patterns).toHaveLength(1)
    expect(patterns[0]).toMatchObject({
      detector: 'repeated_failing_tool_calls',
      severity: 'medium',
    })
    expect(patterns[0]?.evidence).toHaveLength(2)
  })

  it('keeps absent usage explicit instead of treating it as zero', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'turnscope-empty-source-'))
    cpSync(join(import.meta.dirname, '../fixtures/codex'), sourceRoot, { recursive: true })
    const fixturePath = join(sourceRoot, 'sessions/2026/08/31/rollout-fixture.jsonl')
    const database = createTestDatabase()
    const adapter = createCodexAdapter({ sourceRoot })

    const content = await import('node:fs/promises').then(({ readFile }) =>
      readFile(fixturePath, 'utf8'),
    )
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        fixturePath,
        content
          .split('\n')
          .filter((line) => !line.includes('token_count'))
          .join('\n'),
      ),
    )
    await importFromAdapter({ database, adapter })

    const overview = getOverview(database)
    expect(overview.dataHealth.tokenUsageCoverage).toMatchObject({ numerator: 0, denominator: 1, ratio: 0 })
  })

  it('normalizes completed Codex items without mislabeling non-tools as tool calls', async () => {
    const database = createTestDatabase()
    const sourceRoot = join(import.meta.dirname, '../fixtures/codex-item-types')

    await importFromAdapter({
      database,
      adapter: createCodexAdapter({ sourceRoot }),
    })

    const kinds = database.prepare(`
      SELECT kind FROM events WHERE kind <> 'session_meta' ORDER BY source_order
    `).all() as { kind: string }[]
    expect(kinds.map(({ kind }) => kind)).toEqual([
      'user_message_completed',
      'agent_message_completed',
      'reasoning',
      'file_change',
      'extension',
      'subagent_activity',
      'subagent_activity',
      'tool_completion',
      'reasoning',
      'agent_turn',
      'system_message',
      'tool_call',
      'tool_result',
      'user_turn',
    ])
    expect(database.prepare("SELECT COUNT(*) AS count FROM events WHERE kind = 'tool_call'").get())
      .toEqual({ count: 1 })
    expect(database.prepare('SELECT category FROM corrections').get()).toEqual({ category: 'approval' })
    expect(getDiagnostics(database).countedCorrections).toBe(0)
    const toolHealth = getToolHealth(database, { range: 'all' })
    expect(toolHealth.totalInvocations).toBe(2)
    expect(toolHealth.statusCoverage).toMatchObject({ numerator: 1, denominator: 2 })
    expect(database.prepare(`
      SELECT category, signature, duration_ms AS durationMs
      FROM tool_invocations WHERE raw_tool_name = 'command'
    `).get()).toEqual({ category: 'terminal', signature: 'sanitized command', durationMs: null })
    expect(database.prepare('SELECT COUNT(*) AS count FROM tool_invocation_evidence').get())
      .toEqual({ count: 3 })
  })

  it('pairs duplicate tool phases by exact source invocation id without increasing invocation counts', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'turnscope-tool-pairing-'))
    cpSync(join(import.meta.dirname, '../fixtures/codex-item-types'), sourceRoot, { recursive: true })
    const fixturePath = join(sourceRoot, 'sessions/rollout-item-types.jsonl')
    const lines = readFileSync(fixturePath, 'utf8').trim().split('\n')
    const duplicate = lines.find((line) => line.includes('custom_tool_call_output'))
    if (!duplicate) throw new Error('Tool output fixture is missing')
    writeFileSync(fixturePath, `${lines.join('\n')}\n${duplicate}\n`)
    const database = createTestDatabase()

    await importFromAdapter({ database, adapter: createCodexAdapter({ sourceRoot }) })

    expect(getToolHealth(database, { range: 'all' }).totalInvocations).toBe(2)
    expect(database.prepare('SELECT COUNT(*) AS count FROM tool_invocation_evidence').get())
      .toEqual({ count: 4 })
  })

  it('excludes injected instructions, plugin catalogs, and host metadata from correction classification', async () => {
    const sourceRoot = createFixtureSource()
    const fixturePath = join(sourceRoot, 'sessions/2026/08/31/rollout-fixture.jsonl')
    const content = readFileSync(fixturePath, 'utf8').replace(
      'No, do not change the fixture. Fix the parser implementation instead.',
      '<recommended_plugins>Wrong: fix this instead.</recommended_plugins>\n# AGENTS.md instructions\n<INSTRUCTIONS>No, wrong file. Revert it.</INSTRUCTIONS>\n<environment_context>Stop this approach.</environment_context>\nWhat tests did you run?',
    )
    writeFileSync(fixturePath, content)
    const database = createTestDatabase()

    await importFromAdapter({ database, adapter: createCodexAdapter({ sourceRoot }) })

    expect(database.prepare('SELECT COUNT(*) AS count FROM corrections').get()).toEqual({ count: 0 })
    const title = database.prepare('SELECT title FROM sessions LIMIT 1').get() as { title: string }
    expect(title.title).not.toContain('AGENTS.md')
    expect(title.title).not.toContain('INSTRUCTIONS')
  })

  it('keeps event identities stable across adapter parser upgrades', async () => {
    const sourceRoot = createFixtureSource()
    const database = createTestDatabase()
    const firstAdapter = createCodexAdapter({ sourceRoot })
    await importFromAdapter({ database, adapter: firstAdapter })
    const before = database.prepare('SELECT id FROM events ORDER BY source_order').all() as { id: string }[]
    const fixturePath = join(sourceRoot, 'sessions/2026/08/31/rollout-fixture.jsonl')
    writeFileSync(fixturePath, `${readFileSync(fixturePath, 'utf8')}\n`)

    await expect(importFromAdapter({
      database,
      adapter: {
        ...createCodexAdapter({ sourceRoot }),
        adapterVersion: 'codex-rollout-jsonl-v5',
      },
    })).resolves.toMatchObject({ recordsInserted: 0 })

    const after = database.prepare('SELECT id FROM events ORDER BY source_order').all() as { id: string }[]
    expect(after).toEqual(before)
  })

  it('removes stale normalized records when a changed source file is truncated', async () => {
    const sourceRoot = createFixtureSource()
    const database = createTestDatabase()
    const adapter = createCodexAdapter({ sourceRoot })
    await importFromAdapter({ database, adapter })
    const fixturePath = join(sourceRoot, 'sessions/2026/08/31/rollout-fixture.jsonl')
    const lines = readFileSync(fixturePath, 'utf8').trim().split('\n')
    writeFileSync(fixturePath, `${lines.slice(0, -1).join('\n')}\n`)

    await importFromAdapter({ database, adapter })

    expect(database.prepare('SELECT COUNT(*) AS count FROM source_records').get()).toEqual({ count: 9 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 9 })
  })

  it('marks aggregate usage missing when any imported session lacks usage records', async () => {
    const sourceRoot = createFixtureSource()
    cpSync(
      join(import.meta.dirname, '../fixtures/codex-item-types/sessions/rollout-item-types.jsonl'),
      join(sourceRoot, 'sessions/rollout-without-usage.jsonl'),
    )
    const database = createTestDatabase()

    await importFromAdapter({ database, adapter: createCodexAdapter({ sourceRoot }) })

    const overview = getOverview(database, { range: 'all' })
    expect(overview.dataHealth.tokenUsageCoverage).toMatchObject({ numerator: 1, denominator: 2, ratio: 0.5 })
  })

  it('preserves a user correction override when an active rollout is reimported', async () => {
    const sourceRoot = createFixtureSource()
    const database = createTestDatabase()
    const adapter = createCodexAdapter({ sourceRoot })
    await importFromAdapter({ database, adapter })
    database.prepare(`
      UPDATE corrections
      SET user_category = 'approval', user_counts_as_correction = 0,
        user_updated_at = '2026-09-01T00:00:00Z'
    `).run()
    database.prepare(`
      UPDATE signals SET user_dismissed = 1, user_updated_at = '2026-09-01T00:00:00Z'
    `).run()
    const fixturePath = join(sourceRoot, 'sessions/2026/08/31/rollout-fixture.jsonl')
    writeFileSync(fixturePath, `${readFileSync(fixturePath, 'utf8')}\n`)

    await importFromAdapter({ database, adapter })

    expect(database.prepare(`
      SELECT user_category AS category, user_counts_as_correction AS countsAsCorrection
      FROM corrections
    `).get()).toEqual({ category: 'approval', countsAsCorrection: 0 })
    expect(getDiagnostics(database).countedCorrections).toBe(0)
    expect(database.prepare(`
      SELECT user_dismissed AS dismissed FROM signals
    `).get()).toEqual({ dismissed: 1 })
  })

  it('records a redacted failed-import audit without corrupting prior installations', async () => {
    const database = createTestDatabase()
    const sourceRoot = createFixtureSource()
    await importFromAdapter({ database, adapter: createCodexAdapter({ sourceRoot }) })
    const failingAdapter: SourceAdapter = {
      adapterVersion: 'fixture-v1',
      installationId: 'failing-installation',
      product: 'fixture-agent',
      sourceRoot: '/sanitized/failing-source',
      discover: async () => ({
        id: 'failing-installation',
        product: 'fixture-agent',
        productVersion: '1.0.0',
        adapterVersion: 'fixture-v1',
        sourceRoot: '/sanitized/failing-source',
        compatibility: 'supported',
        warning: null,
        lastImportedAt: null,
      }),
      enumerateFiles: async () => [{
        absolutePath: '/sanitized/failing-source/session.jsonl',
        relativePath: 'sessions/session.jsonl',
        sizeBytes: 10,
        modifiedAtMs: 1,
      }],
      readSourceFile: async () => {
        throw new Error('Bearer sanitized-failure-secret')
      },
    }

    await expect(importFromAdapter({ database, adapter: failingAdapter })).rejects.toThrow()

    expect(database.prepare(`
      SELECT status, error_text AS errorText FROM import_audits
      WHERE installation_id = 'failing-installation'
    `).get()).toEqual({ status: 'failure', errorText: '[REDACTED]' })
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM sessions
      WHERE installation_id <> 'failing-installation'
    `).get()).toEqual({ count: 1 })
  })
})
