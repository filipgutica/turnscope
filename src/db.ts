import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

export type TurnscopeDatabase = Database.Database

const migration1 = `
  CREATE TABLE IF NOT EXISTS product_installations (
    id TEXT PRIMARY KEY,
    product TEXT NOT NULL,
    product_version TEXT,
    source_root TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    compatibility TEXT NOT NULL CHECK (compatibility IN ('supported', 'warning', 'unsupported')),
    warning TEXT,
    last_imported_at TEXT
  );

  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    source_thread_id TEXT NOT NULL,
    UNIQUE (installation_id, source_thread_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    source_session_id TEXT NOT NULL,
    source_file TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Untitled session',
    started_at TEXT,
    ended_at TEXT,
    repository TEXT,
    model TEXT,
    reasoning_effort TEXT,
    UNIQUE (installation_id, source_session_id),
    UNIQUE (installation_id, source_file)
  );

  CREATE TABLE IF NOT EXISTS source_files (
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    modified_at_ms REAL NOT NULL,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (installation_id, relative_path)
  );

  CREATE TABLE IF NOT EXISTS source_records (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_file TEXT NOT NULL,
    source_pointer TEXT NOT NULL,
    source_schema_version TEXT,
    source_order INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    last_seen_import_id TEXT NOT NULL,
    redacted_payload_gzip BLOB NOT NULL,
    UNIQUE (installation_id, source_pointer)
  );

  CREATE INDEX IF NOT EXISTS source_records_file
    ON source_records(installation_id, source_file);

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    source_record_id TEXT NOT NULL UNIQUE REFERENCES source_records(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    actor TEXT CHECK (actor IN ('user', 'agent', 'tool', 'system') OR actor IS NULL),
    occurred_at TEXT,
    source_order INTEGER NOT NULL,
    summary TEXT NOT NULL,
    tool_name TEXT,
    tool_signature TEXT,
    tool_status TEXT,
    duration_ms INTEGER
  );

  CREATE INDEX IF NOT EXISTS events_session_order
    ON events(session_id, occurred_at, source_order);

  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    input_tokens INTEGER,
    cached_input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_output_tokens INTEGER,
    nominal_cost REAL,
    billed_cost REAL
  );

  CREATE TABLE IF NOT EXISTS corrections (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    classification_method TEXT NOT NULL DEFAULT 'heuristic'
      CHECK (classification_method IN ('heuristic', 'user')),
    category TEXT NOT NULL,
    confidence REAL NOT NULL,
    explanation TEXT NOT NULL,
    user_category TEXT,
    user_counts_as_correction INTEGER CHECK (user_counts_as_correction IN (0, 1) OR user_counts_as_correction IS NULL),
    user_updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    detector TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    confidence REAL NOT NULL,
    explanation TEXT NOT NULL,
    estimated_impact_ms INTEGER,
    user_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (user_dismissed IN (0, 1)),
    user_updated_at TEXT,
    UNIQUE (session_id, detector)
  );

  CREATE TABLE IF NOT EXISTS signal_evidence (
    signal_id TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    PRIMARY KEY (signal_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS import_audits (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES product_installations(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    files_scanned INTEGER NOT NULL,
    files_imported INTEGER NOT NULL,
    records_inserted INTEGER NOT NULL,
    warnings_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
    error_text TEXT
  );
`

const migration2 = `
  CREATE INDEX IF NOT EXISTS source_records_session
    ON source_records(session_id);
  CREATE INDEX IF NOT EXISTS sessions_thread
    ON sessions(thread_id);
`

const migration3 = `
  CREATE INDEX IF NOT EXISTS sessions_repository_started
    ON sessions(repository, started_at DESC, id);
  CREATE INDEX IF NOT EXISTS corrections_session
    ON corrections(session_id);
  CREATE INDEX IF NOT EXISTS usage_records_session
    ON usage_records(session_id);
  CREATE INDEX IF NOT EXISTS events_status
    ON events(tool_status);

  CREATE TABLE IF NOT EXISTS session_metrics (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    event_count INTEGER NOT NULL,
    user_turn_count INTEGER NOT NULL,
    input_tokens INTEGER,
    cached_input_tokens INTEGER,
    output_tokens INTEGER,
    corrections INTEGER NOT NULL,
    errors INTEGER NOT NULL
  );

  INSERT INTO session_metrics (
    session_id, event_count, user_turn_count, input_tokens, cached_input_tokens,
    output_tokens, corrections, errors
  )
  SELECT
    s.id,
    (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id),
    (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id AND e.kind = 'user_turn'),
    (SELECT CASE WHEN COUNT(*) = 0 OR COUNT(input_tokens) < COUNT(*)
      THEN NULL ELSE SUM(input_tokens) END FROM usage_records u WHERE u.session_id = s.id),
    (SELECT CASE WHEN COUNT(*) = 0 OR COUNT(cached_input_tokens) < COUNT(*)
      THEN NULL ELSE SUM(cached_input_tokens) END FROM usage_records u WHERE u.session_id = s.id),
    (SELECT CASE WHEN COUNT(*) = 0 OR COUNT(output_tokens) < COUNT(*)
      THEN NULL ELSE SUM(output_tokens) END FROM usage_records u WHERE u.session_id = s.id),
    (SELECT COUNT(*) FROM corrections c WHERE c.session_id = s.id AND
      CASE
        WHEN c.user_counts_as_correction IS NOT NULL THEN c.user_counts_as_correction
        WHEN c.category IN ('agent_mistake', 'unproductive_steering') THEN 1
        ELSE 0
      END = 1),
    (SELECT COUNT(*) FROM events e
      WHERE e.session_id = s.id AND e.tool_status IN ('failed', 'error'))
  FROM sessions s
  WHERE true
  ON CONFLICT(session_id) DO NOTHING;
`

const migration4 = `
  CREATE INDEX IF NOT EXISTS events_tool_name
    ON events(tool_name);
`

const migration5 = `
  CREATE INDEX IF NOT EXISTS corrections_effective_category_confidence
    ON corrections(COALESCE(user_category, category), confidence DESC, event_id);
  CREATE INDEX IF NOT EXISTS events_failed_tool_recent
    ON events(tool_name, occurred_at DESC, source_order DESC)
    WHERE tool_status IN ('failed', 'error');
`

const bootstrapSchema = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`

const migrations = [
  { version: 1, up: migration1 },
  { version: 2, up: migration2 },
  { version: 3, up: migration3 },
  { version: 4, up: migration4 },
  { version: 5, up: migration5 },
] as const
const currentSchemaVersion = migrations.at(-1)?.version ?? 0

export const openDatabase = ({ path }: { path: string }): TurnscopeDatabase => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const database = new Database(path)
  try {
    database.pragma('journal_mode = WAL')
    database.pragma('secure_delete = ON')
    database.pragma('foreign_keys = ON')
    database.exec(bootstrapSchema)
    const current = database.prepare(`
      SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations
    `).get() as { version: number }
    if (current.version > currentSchemaVersion) {
      throw new Error(
        `Database schema version ${current.version} is newer than supported version ${currentSchemaVersion}`,
      )
    }
    for (const migration of migrations) {
      if (migration.version <= current.version) continue
      database.transaction(() => {
        database.exec(migration.up)
        database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString())
      })()
    }
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export const closeDatabase = (database: TurnscopeDatabase): void => {
  database.close()
}

export const deleteInstallationData = ({
  database,
  installationId,
}: {
  database: TurnscopeDatabase
  installationId: string
}): boolean => {
  const result = database.prepare('DELETE FROM product_installations WHERE id = ?').run(installationId)
  if (result.changes === 0) return false
  database.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')
  return true
}
