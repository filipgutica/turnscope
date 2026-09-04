import { createHash } from 'node:crypto'

import type { NormalizedToolStatus, ToolCategory } from '../shared/contracts.js'
import type { NormalizedToolPhase } from './adapters/types.js'
import type { TurnscopeDatabase } from './db.js'

interface ToolEventRow {
  id: string
  installationId: string
  sourceInvocationId: string
  phase: NormalizedToolPhase
  category: ToolCategory
  rawName: string | null
  signature: string | null
  status: NormalizedToolStatus | null
  rawStatus: string | null
  durationMs: number | null
  occurredAt: string | null
  sourceOrder: number
}

const invocationId = (sessionId: string, sourceInvocationId: string): string =>
  `tool_${createHash('sha256').update(`${sessionId}:${sourceInvocationId}`).digest('hex').slice(0, 32)}`

const preferredStatusEvent = (events: ToolEventRow[]): ToolEventRow | undefined => {
  const statusEvents = events
    .filter((event): event is ToolEventRow & { status: NormalizedToolStatus } => event.status !== null)
  if (new Set(statusEvents.map(({ status }) => status)).size !== 1) return undefined
  return statusEvents.sort((left, right) => right.sourceOrder - left.sourceOrder)[0]
}

const preferredMetadataEvent = (events: ToolEventRow[]): ToolEventRow | undefined =>
  events.find(({ phase, rawName }) => phase === 'request' && rawName !== null)
  ?? events.find(({ phase, rawName }) => phase === 'completed' && rawName !== null)
  ?? events.find(({ rawName }) => rawName !== null)
  ?? events[0]

export const rebuildToolInvocations = ({
  database,
  sessionId,
}: {
  database: TurnscopeDatabase
  sessionId: string
}): void => {
  const rows = database.prepare(`
    SELECT
      id,
      installation_id AS installationId,
      tool_invocation_source_id AS sourceInvocationId,
      tool_phase AS phase,
      tool_category AS category,
      tool_name AS rawName,
      tool_signature AS signature,
      tool_status AS status,
      tool_raw_status AS rawStatus,
      duration_ms AS durationMs,
      occurred_at AS occurredAt,
      source_order AS sourceOrder
    FROM events
    WHERE session_id = ? AND tool_invocation_source_id IS NOT NULL AND tool_phase IS NOT NULL
    ORDER BY source_order
  `).all(sessionId) as ToolEventRow[]

  database.prepare('DELETE FROM tool_invocations WHERE session_id = ?').run(sessionId)
  const grouped = new Map<string, ToolEventRow[]>()
  for (const row of rows) grouped.set(row.sourceInvocationId, [...(grouped.get(row.sourceInvocationId) ?? []), row])

  const insertInvocation = database.prepare(`
    INSERT INTO tool_invocations (
      id, installation_id, session_id, source_invocation_id, category, raw_tool_name,
      signature, status, raw_status, duration_ms, occurred_at, status_event_id,
      timing_event_id, pairing_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertEvidence = database.prepare(`
    INSERT INTO tool_invocation_evidence (invocation_id, event_id, phase) VALUES (?, ?, ?)
  `)

  for (const [sourceInvocationId, events] of grouped) {
    const metadata = preferredMetadataEvent(events)
    if (!metadata) continue
    const statusEvent = preferredStatusEvent(events)
    const durationEvents = events.filter(({ durationMs }) => durationMs !== null)
    const durations = new Set(durationEvents.map(({ durationMs }) => durationMs))
    const timingEvent = durations.size === 1 ? durationEvents[0] : undefined
    const phases = new Set(events.map(({ phase }) => phase))
    const pairingState = phases.has('request') && (phases.has('result') || phases.has('intermediate'))
      ? 'paired'
      : phases.has('completed')
        ? 'single_record'
        : 'unpaired'
    const id = invocationId(sessionId, sourceInvocationId)
    insertInvocation.run(
      id,
      metadata.installationId,
      sessionId,
      sourceInvocationId,
      metadata.category,
      metadata.rawName,
      metadata.signature,
      statusEvent?.status ?? null,
      statusEvent?.rawStatus ?? null,
      timingEvent?.durationMs ?? null,
      statusEvent?.occurredAt
        ?? [...events].reverse().find(({ occurredAt }) => occurredAt !== null)?.occurredAt
        ?? null,
      statusEvent?.id ?? null,
      timingEvent?.id ?? null,
      pairingState,
    )
    for (const event of events) insertEvidence.run(id, event.id, event.phase)
  }
}
