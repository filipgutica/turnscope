import { describe, expect, it } from 'vitest'

import { closeDatabase, openDatabase } from '../../src/db.js'
import { rebuildToolInvocations } from '../../src/tool-invocations.js'

describe('tool invocation normalization', () => {
  it('keeps conflicting statuses unknown and uses the best available occurrence time', () => {
    const database = openDatabase({ path: ':memory:' })
    database.prepare(`INSERT INTO product_installations (
      id, product, source_root, adapter_version, compatibility
    ) VALUES ('installation', 'codex', '/sanitized', 'fixture', 'warning')`).run()
    database.prepare(`INSERT INTO threads (id, installation_id, source_thread_id)
      VALUES ('thread', 'installation', 'source-thread')`).run()
    database.prepare(`INSERT INTO sessions (
      id, installation_id, thread_id, source_session_id, source_file, title
    ) VALUES ('session', 'installation', 'thread', 'source-session', 'session.jsonl', 'Fixture')`).run()

    const insertRecord = database.prepare(`INSERT INTO source_records (
      id, installation_id, session_id, source_file, source_pointer, source_order,
      imported_at, last_seen_import_id, redacted_payload_gzip
    ) VALUES (?, 'installation', 'session', 'session.jsonl', ?, ?,
      '2026-09-01T00:00:00Z', 'batch', X'00')`)
    const insertEvent = database.prepare(`INSERT INTO events (
      id, installation_id, session_id, source_record_id, kind, actor, occurred_at,
      source_order, summary, tool_name, tool_signature, tool_status,
      tool_invocation_source_id, tool_phase, tool_category, tool_raw_status
    ) VALUES (?, 'installation', 'session', ?, 'tool_call', 'tool', ?, ?, 'Tool event',
      'command', 'sanitized', ?, ?, ?, 'terminal', ?)`)
    const addEvent = ({
      id,
      order,
      invocationId,
      phase,
      status,
      occurredAt,
    }: {
      id: string
      order: number
      invocationId: string
      phase: 'request' | 'intermediate' | 'result'
      status: 'success' | 'failure' | null
      occurredAt: string | null
    }): void => {
      insertRecord.run(`source-${id}`, `session.jsonl#${order}`, order)
      insertEvent.run(id, `source-${id}`, occurredAt, order, status, invocationId, phase, status)
    }

    addEvent({ id: 'conflict-request', order: 1, invocationId: 'conflict', phase: 'request', status: null, occurredAt: null })
    addEvent({ id: 'conflict-failure', order: 2, invocationId: 'conflict', phase: 'intermediate', status: 'failure', occurredAt: '2026-09-01T10:00:01Z' })
    addEvent({ id: 'conflict-success', order: 3, invocationId: 'conflict', phase: 'result', status: 'success', occurredAt: '2026-09-01T10:00:02Z' })
    addEvent({ id: 'dated-request', order: 4, invocationId: 'dated', phase: 'request', status: null, occurredAt: null })
    addEvent({ id: 'dated-failure', order: 5, invocationId: 'dated', phase: 'intermediate', status: 'failure', occurredAt: '2026-09-01T10:00:03Z' })
    addEvent({ id: 'dated-result', order: 6, invocationId: 'dated', phase: 'result', status: null, occurredAt: null })

    rebuildToolInvocations({ database, sessionId: 'session' })

    expect(database.prepare(`SELECT status, status_event_id AS statusEventId,
      occurred_at AS occurredAt FROM tool_invocations WHERE source_invocation_id = 'conflict'`).get())
      .toEqual({ status: null, statusEventId: null, occurredAt: '2026-09-01T10:00:02Z' })
    expect(database.prepare(`SELECT status, status_event_id AS statusEventId,
      occurred_at AS occurredAt FROM tool_invocations WHERE source_invocation_id = 'dated'`).get())
      .toEqual({ status: 'failure', statusEventId: 'dated-failure', occurredAt: '2026-09-01T10:00:03Z' })
    closeDatabase(database)
  })
})
