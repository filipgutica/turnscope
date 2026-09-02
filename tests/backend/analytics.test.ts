import { describe, expect, it } from 'vitest'

import {
  classifyCorrection,
  getDiagnostics,
  getOverview,
  getProjectDetail,
  getSessionDetail,
  listPatterns,
  percentile,
} from '../../src/analytics.js'
import { closeDatabase, openDatabase } from '../../src/db.js'

describe('percentile', () => {
  it('uses deterministic linear interpolation and ignores null values', () => {
    expect(percentile([1, 2, null, 4, 8], 0.75)).toBe(5)
    expect(percentile([null], 0.95)).toBeNull()
    expect(() => percentile([1], 1.1)).toThrow('Percentile must be between 0 and 1')
  })
})

describe('overview duration', () => {
  it('sums each session span instead of counting idle time between sessions', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`
      INSERT INTO product_installations (
        id, product, source_root, adapter_version, compatibility
      ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')
    `).run()
    database.prepare(`
      INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')
    `).run()
    const insertSession = database.prepare(`
      INSERT INTO sessions (
        id, installation_id, thread_id, source_session_id, source_file, started_at, ended_at
      ) VALUES (?, 'installation', 'thread', ?, ?, ?, ?)
    `)
    insertSession.run(
      'session-1',
      'thread-1',
      'first.jsonl',
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T10:00:10.000Z',
    )
    insertSession.run(
      'session-2',
      'thread-2',
      'second.jsonl',
      '2026-09-02T10:00:00.000Z',
      '2026-09-02T10:00:20.000Z',
    )

    expect(getOverview(database).duration.value).toBe(30_000)
    closeDatabase(database)
  })
})

describe('project overview', () => {
  it('groups sessions by repository and keeps sessions without one discoverable', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`
      INSERT INTO product_installations (
        id, product, source_root, adapter_version, compatibility
      ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')
    `).run()
    database.prepare(`
      INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')
    `).run()
    const insertSession = database.prepare(`
      INSERT INTO sessions (
        id, installation_id, thread_id, source_session_id, source_file,
        title, started_at, repository
      ) VALUES (?, 'installation', 'thread', ?, ?, ?, ?, ?)
    `)
    insertSession.run(
      'session-alpha-1',
      'source-alpha-1',
      'alpha-1.jsonl',
      'Alpha one',
      '2026-09-01T10:00:00.000Z',
      '/work/alpha',
    )
    insertSession.run(
      'session-alpha-2',
      'source-alpha-2',
      'alpha-2.jsonl',
      'Alpha two',
      '2026-09-02T10:00:00.000Z',
      '/work/alpha',
    )
    insertSession.run(
      'session-unknown',
      'source-unknown',
      'unknown.jsonl',
      'Unknown project',
      '2026-09-03T10:00:00.000Z',
      null,
    )

    expect(getOverview(database).projectRows).toEqual([
      expect.objectContaining({
        id: 'unassigned',
        name: 'Unknown project',
        repository: null,
        sessionCount: 1,
      }),
      expect.objectContaining({
        name: 'alpha',
        repository: '/work/alpha',
        sessionCount: 2,
      }),
    ])
    expect(getOverview(database)).not.toHaveProperty('sessionRows')
    closeDatabase(database)
  })
})

describe('paged drill-down queries', () => {
  it('filters and bounds project sessions before returning them', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`
      INSERT INTO product_installations (
        id, product, source_root, adapter_version, compatibility
      ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')
    `).run()
    database.prepare(`
      INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')
    `).run()
    const insertSession = database.prepare(`
      INSERT INTO sessions (
        id, installation_id, thread_id, source_session_id, source_file,
        title, started_at, repository
      ) VALUES (?, 'installation', 'thread', ?, ?, ?, ?, '/work/alpha')
    `)
    insertSession.run('session-1', 'source-1', 'one.jsonl', 'Needle one', '2026-09-02T10:00:00Z')
    insertSession.run('session-2', 'source-2', 'two.jsonl', 'Needle two', '2026-09-01T10:00:00Z')
    insertSession.run('session-3', 'source-3', 'three.jsonl', 'Unrelated', '2026-08-31T10:00:00Z')

    const projectId = getOverview(database).projectRows[0]!.id
    const firstPage = getProjectDetail({
      database,
      projectId,
      query: { limit: 1, offset: 0, search: 'needle' },
    })

    expect(firstPage?.sessions).toMatchObject({ total: 2, offset: 0, limit: 1 })
    expect(firstPage?.sessions.rows.map(({ id }) => id)).toEqual(['session-1'])
    closeDatabase(database)
  })

  it('filters and bounds a session timeline before returning it', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`
      INSERT INTO product_installations (
        id, product, source_root, adapter_version, compatibility
      ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')
    `).run()
    database.prepare(`
      INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')
    `).run()
    database.prepare(`
      INSERT INTO sessions (
        id, installation_id, thread_id, source_session_id, source_file, title
      ) VALUES ('session', 'installation', 'thread', 'source', 'one.jsonl', 'Session')
    `).run()
    const insertRecord = database.prepare(`
      INSERT INTO source_records (
        id, installation_id, session_id, source_file, source_pointer, source_order,
        imported_at, last_seen_import_id, redacted_payload_gzip
      ) VALUES (?, 'installation', 'session', 'one.jsonl', ?, ?, '2026-09-02T10:00:00Z', 'batch', X'00')
    `)
    const insertEvent = database.prepare(`
      INSERT INTO events (
        id, installation_id, session_id, source_record_id, kind, actor, source_order, summary
      ) VALUES (?, 'installation', 'session', ?, 'message', ?, ?, ?)
    `)
    for (const [index, actor, summary] of [
      [1, 'user', 'Find this'],
      [2, 'agent', 'Find this too'],
      [3, 'tool', 'Ignore this'],
    ] as const) {
      insertRecord.run(`source-${index}`, `one.jsonl:${index}`, index)
      insertEvent.run(`event-${index}`, `source-${index}`, actor, index, summary)
    }

    const detail = getSessionDetail({
      database,
      sessionId: 'session',
      query: { limit: 1, offset: 1, search: 'find' },
    })

    expect(detail?.timeline).toMatchObject({ total: 2, offset: 1, limit: 1 })
    expect(detail?.timeline.rows.map(({ id }) => id)).toEqual(['event-2'])
    const linkedEvent = getSessionDetail({
      database,
      sessionId: 'session',
      query: { eventId: 'event-3' },
    })
    expect(linkedEvent?.timeline.rows.map(({ id }) => id)).toEqual(['event-3'])
    closeDatabase(database)
  })
})

describe('correction classification', () => {
  it.each([
    ['No, that is the wrong file. Revert it and fix the parser.', 'agent_mistake'],
    ['Stop this approach and inspect the schema first.', 'unproductive_steering'],
    ['To clarify, the report only covers local sessions.', 'clarification'],
    ['Also add export support.', 'new_requirement'],
    ['Use SQLite for this POC.', 'product_decision'],
    ['I prefer compact tables.', 'preference'],
    ['Approved, continue.', 'approval'],
    ['Cancel this task.', 'cancellation'],
  ] as const)('classifies %s', (text, expected) => {
    expect(classifyCorrection(text)?.category).toBe(expected)
  })

  it('does not count an ordinary follow-up as a correction', () => {
    expect(classifyCorrection('What tests did you run?')).toBeNull()
  })
})

describe('pattern ordering', () => {
  it('orders severity by diagnostic rank rather than alphabetically', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`
      INSERT INTO product_installations (
        id, product, source_root, adapter_version, compatibility
      ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')
    `).run()
    database.prepare(`
      INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')
    `).run()
    database.prepare(`
      INSERT INTO sessions (
        id, installation_id, thread_id, source_session_id, source_file
      ) VALUES ('session', 'installation', 'thread', 'source-session', 'fixture.jsonl')
    `).run()
    const insert = database.prepare(`
      INSERT INTO signals (
        id, installation_id, session_id, detector, severity, confidence, explanation
      ) VALUES (?, 'installation', 'session', ?, ?, 0.9, 'Sanitized signal')
    `)
    insert.run('low', 'low-detector', 'low')
    insert.run('high', 'high-detector', 'high')
    insert.run('medium', 'medium-detector', 'medium')

    expect(listPatterns(database).map(({ severity }) => severity)).toEqual([
      'high',
      'medium',
      'low',
    ])
    closeDatabase(database)
  })
})

describe('diagnostic coverage', () => {
  it('separates observed counts from claims the imported data cannot support', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`
      INSERT INTO product_installations (
        id, product, source_root, adapter_version, compatibility
      ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')
    `).run()
    database.prepare(`
      INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')
    `).run()
    database.prepare(`
      INSERT INTO sessions (
        id, installation_id, thread_id, source_session_id, source_file, title
      ) VALUES ('session', 'installation', 'thread', 'source', 'one.jsonl', 'Session')
    `).run()
    database.prepare(`
      INSERT INTO source_records (
        id, installation_id, session_id, source_file, source_pointer, source_order,
        imported_at, last_seen_import_id, redacted_payload_gzip
      ) VALUES ('source', 'installation', 'session', 'one.jsonl', 'one.jsonl:1', 1,
        '2026-09-02T10:00:00Z', 'batch', X'00')
    `).run()
    database.prepare(`
      INSERT INTO events (
        id, installation_id, session_id, source_record_id, kind, actor, source_order,
        summary, tool_name, tool_status, duration_ms
      ) VALUES ('event', 'installation', 'session', 'source', 'tool_result', 'tool', 1,
        'Failed command', 'command', 'failed', 250)
    `).run()
    database.prepare(`
      INSERT INTO corrections (
        id, installation_id, session_id, event_id, category, confidence, explanation
      ) VALUES ('correction', 'installation', 'session', 'event', 'agent_mistake', 0.9,
        'The user corrected a likely agent mistake.')
    `).run()
    database.prepare(`
      INSERT INTO usage_records (
        id, installation_id, session_id, event_id, input_tokens, cached_input_tokens,
        output_tokens
      ) VALUES ('usage', 'installation', 'session', 'event', 100, 80, 20)
    `).run()

    const diagnostics = getDiagnostics(database)

    expect(diagnostics).toMatchObject({
      correctionCandidates: 1,
      countedCorrections: 1,
      failedToolEvents: 1,
      tokenCoverage: {
        usageRecords: 1,
        sessionsWithUsage: 1,
        totalSessions: 1,
        coverageRatio: 1,
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 20,
      },
      skillCoverage: { status: 'unavailable' },
    })
    expect(diagnostics.correctionCategories[0]?.evidence).toEqual([
      { eventId: 'event', sessionId: 'session', label: 'Session · event #1' },
    ])
    expect(diagnostics.toolFailures[0]).toMatchObject({
      toolName: 'command',
      recordedEvents: 1,
      failures: 1,
      affectedSessions: 1,
      averageFailureDurationMs: 250,
    })
    closeDatabase(database)
  })
})
