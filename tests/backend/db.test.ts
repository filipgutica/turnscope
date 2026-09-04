import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { closeDatabase, openDatabase } from '../../src/db.js'

describe('database migrations', () => {
  it('applies each migration once when opening a new database repeatedly', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'turnscope-migration-')), 'turnscope.db')
    closeDatabase(openDatabase({ path }))
    const reopened = openDatabase({ path })

    expect(reopened.prepare('SELECT version FROM schema_migrations ORDER BY version').all())
      .toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }])
    expect(reopened.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IN ('source_records_session', 'sessions_thread')
      ORDER BY name
    `).all()).toEqual([
      { name: 'sessions_thread' },
      { name: 'source_records_session' },
    ])
    closeDatabase(reopened)
  })

  it('rejects a database created by a newer Turnscope schema', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'turnscope-future-')), 'turnscope.db')
    const future = new Database(path)
    future.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (version, applied_at) VALUES (99, '2026-09-01T00:00:00Z');
    `)
    future.close()

    expect(() => openDatabase({ path })).toThrow(
      'Database schema version 99 is newer than supported version 7',
    )
  })
})
