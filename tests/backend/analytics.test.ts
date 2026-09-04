import { describe, expect, it } from 'vitest'

import {
  classifyCorrection,
  getDiagnostics,
  getOverview,
  getProjectDetail,
  getSessionDetail,
  getToolHealth,
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

describe('overview session span', () => {
  it('reports covered median and P90 spans without summing sessions', () => {
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
    for (const [id, start, end] of [
      ['session-1', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:10.000Z'],
      ['session-2', '2026-09-02T10:00:00.000Z', '2026-09-02T10:00:20.000Z'],
      ['session-3', '2026-09-03T10:00:00.000Z', '2026-09-03T10:00:30.000Z'],
      ['session-outlier', '2026-09-04T10:00:00.000Z', '2026-09-04T10:16:40.000Z'],
      ['session-missing', null, null],
    ] as const) insertSession.run(id, `source-${id}`, `${id}.jsonl`, start, end)

    const overview = getOverview(database, { range: 'all' }, new Date('2026-09-05T00:00:00Z'))
    expect(overview).not.toHaveProperty('duration')
    expect(overview.sessionSpan).toMatchObject({
      medianMs: 25_000,
      coverage: { numerator: 4, denominator: 5, ratio: 0.8 },
    })
    expect(overview.sessionSpan.p90Ms).toBeCloseTo(709_000)
    expect(overview.sessionSpan.definition).toContain('not active agent time')
    closeDatabase(database)
  })

  it('uses inclusive rolling boundaries and excludes future or unplaceable sessions', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`INSERT INTO product_installations (
      id, product, source_root, adapter_version, compatibility
    ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')`).run()
    database.prepare(`INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')`).run()
    const insert = database.prepare(`INSERT INTO sessions (
      id, installation_id, thread_id, source_session_id, source_file, started_at, ended_at
    ) VALUES (?, 'installation', 'thread', ?, ?, ?, ?)`)
    insert.run('boundary', 'boundary', 'boundary.jsonl', '2026-08-31T12:00:00.000Z', '2026-08-31T12:00:00.000Z')
    insert.run('before', 'before', 'before.jsonl', '2026-08-31T11:59:59.999Z', '2026-08-31T11:59:59.999Z')
    insert.run('future', 'future', 'future.jsonl', '2026-09-30T12:00:00.001Z', '2026-09-30T12:00:00.001Z')
    insert.run('missing', 'missing', 'missing.jsonl', null, null)
    const insertInvocation = database.prepare(`INSERT INTO tool_invocations (
      id, installation_id, session_id, source_invocation_id, category, occurred_at, pairing_state
    ) VALUES (?, 'installation', ?, ?, 'terminal', ?, 'single_record')`)
    insertInvocation.run('tool-boundary', 'boundary', 'source-tool-boundary', '2026-08-31T12:00:00.000Z')
    insertInvocation.run('tool-before', 'boundary', 'source-tool-before', '2026-08-31T11:59:59.999Z')
    insertInvocation.run('tool-future', 'boundary', 'source-tool-future', '2026-09-30T12:00:00.001Z')
    insertInvocation.run('tool-missing', 'boundary', 'source-tool-missing', null)

    const now = new Date('2026-09-30T12:00:00.000Z')
    const rollingOverview = getOverview(database, { range: '30d' }, now)
    expect(rollingOverview.recentSessions.value).toBe(1)
    expect(rollingOverview.dataHealth.toolStatusCoverage.denominator).toBe(1)
    expect(getOverview(database, { range: 'all' }, now).recentSessions.value).toBe(4)
    expect(getToolHealth(database, { range: '30d' }, now).totalInvocations).toBe(1)
    expect(getToolHealth(database, { range: 'all' }, now).totalInvocations).toBe(4)
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

describe('tool health coverage', () => {
  it('counts normalized invocations and keeps partial or unknown fields explicit', () => {
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
    database.prepare(`INSERT INTO tool_invocations (
      id, installation_id, session_id, source_invocation_id, category, raw_tool_name,
      signature, status, raw_status, duration_ms, occurred_at, status_event_id, pairing_state
    ) VALUES ('tool-1', 'installation', 'session', 'source-tool-1', 'terminal', 'command',
      'same command', 'failure', 'failed', 250, '2026-09-02T10:00:00Z', 'event', 'single_record')`).run()
    database.prepare(`INSERT INTO tool_invocations (
      id, installation_id, session_id, source_invocation_id, category, raw_tool_name,
      signature, status, raw_status, duration_ms, occurred_at, pairing_state
    ) VALUES ('tool-2', 'installation', 'session', 'source-tool-2', 'terminal', 'exec',
      'same command', NULL, NULL, NULL, '2026-09-02T10:00:01Z', 'unpaired')`).run()

    const health = getToolHealth(database, { range: 'all' }, new Date('2026-09-03T00:00:00Z'))
    expect(health).toMatchObject({
      totalInvocations: 2,
      statusCoverage: { numerator: 1, denominator: 2, ratio: 0.5 },
      timingCoverage: { numerator: 1, denominator: 2, ratio: 0.5 },
    })
    expect(health.categories[0]).toMatchObject({
      category: 'terminal',
      uniqueInvocations: 2,
      successfulInvocations: 0,
      failedInvocations: 1,
      successRate: { numerator: 0, denominator: 1, ratio: 0 },
      repeatInvocations: 0,
      medianDurationMs: 250,
      p90DurationMs: 250,
      permissionRejections: null,
      cancellations: null,
    })
    expect(health.categories[0]?.evidence[0]).toMatchObject({ eventId: 'event', sessionId: 'session' })
    closeDatabase(database)
  })
})

describe('attention findings', () => {
  it('hides findings below the status-coverage threshold and links evidence once coverage is sufficient', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`INSERT INTO product_installations (
      id, product, source_root, adapter_version, compatibility
    ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')`).run()
    database.prepare(`INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')`).run()
    database.prepare(`INSERT INTO sessions (
      id, installation_id, thread_id, source_session_id, source_file, title, started_at, ended_at
    ) VALUES ('session', 'installation', 'thread', 'source', 'one.jsonl', 'Needs review',
      '2026-09-01T10:00:00Z', '2026-09-01T10:05:00Z')`).run()
    const insertRecord = database.prepare(`INSERT INTO source_records (
      id, installation_id, session_id, source_file, source_pointer, source_order,
      imported_at, last_seen_import_id, redacted_payload_gzip
    ) VALUES (?, 'installation', 'session', 'one.jsonl', ?, ?, '2026-09-01T10:00:00Z', 'batch', X'00')`)
    const insertEvent = database.prepare(`INSERT INTO events (
      id, installation_id, session_id, source_record_id, kind, actor, occurred_at,
      source_order, summary, tool_name, tool_status
    ) VALUES (?, 'installation', 'session', ?, 'tool_completion', 'tool',
      '2026-09-01T10:00:00Z', ?, 'Tool result', 'command', ?)`)
    const insertInvocation = database.prepare(`INSERT INTO tool_invocations (
      id, installation_id, session_id, source_invocation_id, category, raw_tool_name,
      status, occurred_at, status_event_id, pairing_state
    ) VALUES (?, 'installation', 'session', ?, 'terminal', 'command', ?,
      '2026-09-01T10:00:00Z', ?, 'single_record')`)
    for (let index = 1; index <= 4; index += 1) {
      const status = index === 1 ? 'failure' : null
      insertRecord.run(`source-${index}`, `one.jsonl#${index}`, index)
      insertEvent.run(`event-${index}`, `source-${index}`, index, status)
      insertInvocation.run(`tool-${index}`, `source-tool-${index}`, status, status ? `event-${index}` : null)
    }

    const now = new Date('2026-09-02T00:00:00Z')
    const lowCoverage = getOverview(database, { range: 'all' }, now)
    expect(lowCoverage.sessionsNeedingAttention.value).toBeNull()
    expect(lowCoverage.sessionsNeedingAttention.evidence).toEqual([])
    expect(lowCoverage.findings).toEqual([])
    expect(lowCoverage.findingsLimitation).toContain('1 of 4')
    expect(lowCoverage.recentSessionRows[0]).toMatchObject({
      attentionStatus: 'coverage_limited',
      evidence: [],
    })

    database.prepare(`UPDATE tool_invocations
      SET status = 'success', status_event_id = CASE id WHEN 'tool-2' THEN 'event-2' ELSE 'event-3' END
      WHERE id IN ('tool-2', 'tool-3')`).run()
    const sufficientCoverage = getOverview(database, { range: 'all' }, now)
    expect(sufficientCoverage.sessionsNeedingAttention.value).toBe(1)
    expect(sufficientCoverage.findings[0]).toMatchObject({
      title: 'Needs review',
      evidence: [{ eventId: 'event-1', sessionId: 'session' }],
    })
    closeDatabase(database)
  })
})

describe('data health states', () => {
  it('keeps empty coverage unknown and exposes active compatibility warnings', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`INSERT INTO product_installations (
      id, product, product_version, source_root, adapter_version, compatibility, warning
    ) VALUES ('installation', 'codex', '9.9.9', '/sanitized', 'fixture-v1', 'unsupported',
      'This source version has not been validated.')`).run()
    database.prepare(`INSERT INTO import_audits (
      id, installation_id, started_at, completed_at, files_scanned, files_imported,
      records_inserted, warnings_json, status
    ) VALUES ('audit', 'installation', '2026-09-01T00:00:00Z', '2026-09-01T00:00:01Z',
      2, 2, 0, ?, 'success')`).run(JSON.stringify([
      { code: 'unsupported_source_version', message: 'Source schema is newer than supported.', source: 'one.jsonl' },
      { code: 'unsupported_source_version', message: 'Source schema is newer than supported.', source: 'two.jsonl' },
    ]))
    database.prepare(`INSERT INTO source_files (
      installation_id, relative_path, content_hash, size_bytes, modified_at_ms,
      imported_at, adapter_version, warnings_json
    ) VALUES ('installation', 'one.jsonl', 'hash', 1, 1, '2026-09-01T00:00:01Z',
      'fixture-v1', ?)`).run(JSON.stringify([
      { code: 'unsupported_source_version', message: 'Source schema is newer than supported.', source: 'one.jsonl' },
      { code: 'unsupported_source_version', message: 'Source schema is newer than supported.', source: 'two.jsonl' },
    ]))

    const overview = getOverview(database, { range: 'all' }, new Date('2026-09-02T00:00:00Z'))
    expect(overview.dataHealth).toMatchObject({
      importedSessions: 0,
      tokenUsageCoverage: { numerator: 0, denominator: 0, ratio: null },
      toolStatusCoverage: { numerator: 0, denominator: 0, ratio: null },
      outcomeCoverage: { numerator: 0, denominator: 0, ratio: null },
      sources: [{ productVersion: '9.9.9', adapterVersion: 'fixture-v1', compatibility: 'unsupported' }],
    })
    expect(overview.dataHealth.activeWarnings[0]).toMatchObject({
      code: 'unsupported_source_version',
      message: 'Source schema is newer than supported. Reported by 2 source files.',
      source: 'one.jsonl',
    })
    closeDatabase(database)
  })

  it('does not count an all-null usage row as token-usage coverage', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`INSERT INTO product_installations (
      id, product, source_root, adapter_version, compatibility
    ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')`).run()
    database.prepare(`INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')`).run()
    database.prepare(`INSERT INTO sessions (
      id, installation_id, thread_id, source_session_id, source_file, title, started_at
    ) VALUES ('session', 'installation', 'thread', 'source-session', 'session.jsonl',
      'Fixture', '2026-09-01T10:00:00Z')`).run()
    database.prepare(`INSERT INTO source_records (
      id, installation_id, session_id, source_file, source_pointer, source_order,
      imported_at, last_seen_import_id, redacted_payload_gzip
    ) VALUES ('source', 'installation', 'session', 'session.jsonl', 'session.jsonl#1', 1,
      '2026-09-01T10:00:00Z', 'batch', X'00')`).run()
    database.prepare(`INSERT INTO events (
      id, installation_id, session_id, source_record_id, kind, occurred_at, source_order, summary
    ) VALUES ('event', 'installation', 'session', 'source', 'usage',
      '2026-09-01T10:00:00Z', 1, 'Usage unavailable')`).run()
    database.prepare(`INSERT INTO usage_records (
      id, installation_id, session_id, event_id
    ) VALUES ('usage', 'installation', 'session', 'event')`).run()

    const overview = getOverview(database, { range: 'all' }, new Date('2026-09-02T00:00:00Z'))
    expect(overview.dataHealth.tokenUsageCoverage).toMatchObject({ numerator: 0, denominator: 1, ratio: 0 })
    expect(getDiagnostics(database).tokenCoverage).toMatchObject({
      usageRecords: 0,
      sessionsWithUsage: 0,
      totalSessions: 1,
      coverageRatio: 0,
    })
    closeDatabase(database)
  })

  it('reports when pre-normalization source files require reimport', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`INSERT INTO product_installations (
      id, product, source_root, adapter_version, compatibility
    ) VALUES ('installation', 'codex', '/sanitized', 'legacy-adapter', 'warning')`).run()
    database.prepare(`INSERT INTO source_files (
      installation_id, relative_path, content_hash, size_bytes, modified_at_ms, imported_at
    ) VALUES ('installation', 'legacy.jsonl', 'hash', 1, 1, '2026-09-01T00:00:00Z')`).run()

    const overview = getOverview(database, { range: 'all' }, new Date('2026-09-02T00:00:00Z'))
    expect(overview.dataHealth.activeWarnings).toContainEqual({
      code: 'normalization_reimport_required',
      message: '1 imported source file must be reimported before normalized tool health is available.',
      source: 'Database upgrade',
    })
    closeDatabase(database)
  })
})
