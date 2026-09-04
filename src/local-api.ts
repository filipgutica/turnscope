import { gunzipSync } from 'node:zlib'

import type { TurnscopeApi } from '../shared/api.js'
import type {
  CorrectionOverrideInput,
  AnalyticsRangeQuery,
  ProjectSessionsQuery,
  SessionTimelineQuery,
  SignalOverrideInput,
  SourceEvidenceResponse,
} from '../shared/contracts.js'
import { correctionCategories } from '../shared/corrections.js'
import {
  getDiagnostics,
  getOverview,
  getToolHealth,
  getProjectDetail,
  getSessionDetail,
  listPatterns,
  refreshSessionMetrics,
} from './analytics.js'
import type { TurnscopeDatabase } from './db.js'

export class LocalApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404,
  ) {
    super(message)
    this.name = 'LocalApiError'
  }
}

const correctionCategorySet = new Set<string>(correctionCategories)
const timelineActors = new Set(['user', 'agent', 'tool', 'system'])
const projectIssues = new Set(['corrections', 'errors'])
const analyticsRanges = new Set(['7d', '30d', 'all'])

const requireAnalyticsQuery = (value: unknown): AnalyticsRangeQuery => {
  const query = requirePageQuery(value)
  if (query.range !== undefined && (typeof query.range !== 'string' || !analyticsRanges.has(query.range))) {
    throw new LocalApiError('Invalid analytics range', 400)
  }
  return query.range === '7d' || query.range === '30d' || query.range === 'all'
    ? { range: query.range }
    : {}
}

const requireId = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LocalApiError('Invalid identifier', 400)
  }
  return value
}

const requireCorrectionOverride = (value: unknown): CorrectionOverrideInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalApiError('Invalid correction override', 400)
  }
  const body = value as Record<string, unknown>
  if (typeof body.category !== 'string' || !correctionCategorySet.has(body.category)) {
    throw new LocalApiError('Invalid correction override', 400)
  }
  if (typeof body.countsAsCorrection !== 'boolean') {
    throw new LocalApiError('Invalid correction override', 400)
  }
  return {
    category: body.category as CorrectionOverrideInput['category'],
    countsAsCorrection: body.countsAsCorrection,
  }
}

const requireSignalOverride = (value: unknown): SignalOverrideInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalApiError('Invalid signal override', 400)
  }
  const body = value as Record<string, unknown>
  if (typeof body.dismissed !== 'boolean') {
    throw new LocalApiError('Invalid signal override', 400)
  }
  return { dismissed: body.dismissed }
}

const requirePageQuery = (value: unknown): Record<string, unknown> => {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalApiError('Invalid page query', 400)
  }
  return value as Record<string, unknown>
}

const optionalPageNumber = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new LocalApiError(`Invalid ${name}`, 400)
  }
  if (name === 'limit' && (value < 1 || value > 200)) {
    throw new LocalApiError('Invalid limit', 400)
  }
  return value
}

const optionalSearch = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 200) {
    throw new LocalApiError('Invalid search', 400)
  }
  return value
}

const requireProjectQuery = (value: unknown): ProjectSessionsQuery => {
  const query = requirePageQuery(value)
  if (query.issue !== undefined && (typeof query.issue !== 'string' || !projectIssues.has(query.issue))) {
    throw new LocalApiError('Invalid issue filter', 400)
  }
  const offset = optionalPageNumber(query.offset, 'offset')
  const limit = optionalPageNumber(query.limit, 'limit')
  const search = optionalSearch(query.search)
  const issue = query.issue === 'corrections' || query.issue === 'errors' ? query.issue : undefined
  return {
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
    ...(search === undefined ? {} : { search }),
    ...(issue === undefined ? {} : { issue }),
  }
}

const requireTimelineQuery = (value: unknown): SessionTimelineQuery => {
  const query = requirePageQuery(value)
  if (query.actor !== undefined && (typeof query.actor !== 'string' || !timelineActors.has(query.actor))) {
    throw new LocalApiError('Invalid actor filter', 400)
  }
  const offset = optionalPageNumber(query.offset, 'offset')
  const limit = optionalPageNumber(query.limit, 'limit')
  const search = optionalSearch(query.search)
  const eventId = query.eventId === undefined ? undefined : requireId(query.eventId)
  const actor = query.actor === 'user'
    || query.actor === 'agent'
    || query.actor === 'tool'
    || query.actor === 'system'
    ? query.actor
    : undefined
  return {
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
    ...(search === undefined ? {} : { search }),
    ...(actor === undefined ? {} : { actor }),
    ...(eventId === undefined ? {} : { eventId }),
  }
}

export const createLocalApi = ({ database }: { database: TurnscopeDatabase }): TurnscopeApi => ({
  getDiagnostics: async () => getDiagnostics(database),
  getOverview: async (query) => getOverview(database, requireAnalyticsQuery(query)),
  getToolHealth: async (query) => getToolHealth(database, requireAnalyticsQuery(query)),
  getProject: async (projectId, query) => {
    const detail = getProjectDetail({
      database,
      projectId: requireId(projectId),
      query: requireProjectQuery(query),
    })
    if (!detail) throw new LocalApiError('Project not found', 404)
    return detail
  },
  getPatterns: async () => listPatterns(database),
  getSession: async (sessionId, query) => {
    const detail = getSessionDetail({
      database,
      sessionId: requireId(sessionId),
      query: requireTimelineQuery(query),
    })
    if (!detail) throw new LocalApiError('Session not found', 404)
    return detail
  },
  getEvidence: async (sourceRecordId) => {
    const row = database.prepare(`
      SELECT
        id AS sourceRecordId,
        source_pointer AS sourcePointer,
        source_schema_version AS sourceSchemaVersion,
        imported_at AS importedAt,
        redacted_payload_gzip AS payload
      FROM source_records WHERE id = ?
    `).get(requireId(sourceRecordId)) as {
      sourceRecordId: string
      sourcePointer: string
      sourceSchemaVersion: string | null
      importedAt: string
      payload: Buffer
    } | undefined
    if (!row) throw new LocalApiError('Evidence not found', 404)
    const response: SourceEvidenceResponse = {
      sourceRecordId: row.sourceRecordId,
      sourcePointer: row.sourcePointer,
      sourceSchemaVersion: row.sourceSchemaVersion,
      importedAt: row.importedAt,
      redactedPayload: JSON.parse(gunzipSync(row.payload).toString('utf8')),
    }
    return response
  },
  updateCorrection: async (correctionId, value) => {
    const override = requireCorrectionOverride(value)
    const validCorrectionId = requireId(correctionId)
    const correction = database.prepare('SELECT session_id AS sessionId FROM corrections WHERE id = ?')
      .get(validCorrectionId) as { sessionId: string } | undefined
    if (!correction) throw new LocalApiError('Correction not found', 404)
    const result = database.prepare(`
      UPDATE corrections
      SET user_category = ?, user_counts_as_correction = ?, user_updated_at = ?
      WHERE id = ?
    `).run(
      override.category,
      override.countsAsCorrection ? 1 : 0,
      new Date().toISOString(),
      validCorrectionId,
    )
    if (result.changes === 0) throw new LocalApiError('Correction not found', 404)
    refreshSessionMetrics({ database, sessionId: correction.sessionId })
  },
  createCorrection: async (eventId, value) => {
    const override = requireCorrectionOverride(value)
    const validEventId = requireId(eventId)
    const now = new Date().toISOString()
    const result = database.prepare(`
      INSERT INTO corrections (
        id, installation_id, session_id, event_id, classification_method, category,
        confidence, explanation, user_category, user_counts_as_correction, user_updated_at
      )
      SELECT ?, e.installation_id, e.session_id, e.id, 'user', ?, 1,
        'Classification added by the user.', ?, ?, ?
      FROM events e
      WHERE e.id = ? AND e.actor = 'user'
      ON CONFLICT(event_id) DO UPDATE SET
        user_category = excluded.user_category,
        user_counts_as_correction = excluded.user_counts_as_correction,
        user_updated_at = excluded.user_updated_at
    `).run(
      `correction_user_${validEventId}`,
      override.category,
      override.category,
      override.countsAsCorrection ? 1 : 0,
      now,
      validEventId,
    )
    if (result.changes === 0) throw new LocalApiError('User event not found', 404)
    const event = database.prepare('SELECT session_id AS sessionId FROM events WHERE id = ?')
      .get(validEventId) as { sessionId: string }
    refreshSessionMetrics({ database, sessionId: event.sessionId })
  },
  updateSignal: async (signalId, value) => {
    const override = requireSignalOverride(value)
    const result = database.prepare(`
      UPDATE signals SET user_dismissed = ?, user_updated_at = ? WHERE id = ?
    `).run(override.dismissed ? 1 : 0, new Date().toISOString(), requireId(signalId))
    if (result.changes === 0) throw new LocalApiError('Signal not found', 404)
  },
})
