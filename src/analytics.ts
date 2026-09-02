import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import type {
  CorrectionView,
  DiagnosticsResponse,
  EvidenceRef,
  MetricValue,
  OverviewResponse,
  PatternSignal,
  PageResult,
  ProjectDetailResponse,
  ProjectSessionsQuery,
  ProjectSummary,
  SessionDetailResponse,
  SessionSummary,
  SessionTimelineQuery,
  TimelineEvent,
  ToolFailureDiagnostic,
} from '../shared/contracts.js'
import type { TurnscopeDatabase } from './db.js'

type CorrectionCategory = CorrectionView['category']

export interface ClassifiedCorrection {
  category: CorrectionCategory
  confidence: number
  explanation: string
}

const correctionRules: { category: CorrectionCategory; pattern: RegExp; confidence: number; explanation: string }[] = [
  { category: 'cancellation', pattern: /\b(cancel|stop (?:the |this )?task|do not continue)\b/i, confidence: 0.98, explanation: 'The user explicitly cancelled the task.' },
  { category: 'approval', pattern: /\b(approved?|confirmed?|go ahead|continue)\b/i, confidence: 0.96, explanation: 'The user explicitly approved or confirmed proceeding.' },
  { category: 'product_decision', pattern: /\b(use|choose|select|decision)\b.*\b(sqlite|electron|cli|database|architecture|poc)\b/i, confidence: 0.87, explanation: 'The user selected a product or architecture direction.' },
  { category: 'preference', pattern: /\b(i prefer|my preference|please prefer)\b/i, confidence: 0.94, explanation: 'The user stated a preference.' },
  { category: 'new_requirement', pattern: /\b(also (?:add|include|support)|new requirement|in addition)\b/i, confidence: 0.9, explanation: 'The user added a requirement beyond the prior request.' },
  { category: 'clarification', pattern: /\b(to clarify|clarification|what i meant|only covers?)\b/i, confidence: 0.9, explanation: 'The user clarified the original request.' },
  { category: 'unproductive_steering', pattern: /\b(stop this approach|different approach|inspect .* first|this approach is not working)\b/i, confidence: 0.9, explanation: 'The user redirected an unproductive approach.' },
  { category: 'agent_mistake', pattern: /(?:\bno\b.*\b(?:wrong|do not|instead|revert|fix)\b)|(?:\bwrong\b.*\b(?:fix|file|implementation|parser)\b)/i, confidence: 0.92, explanation: 'The user corrected a likely agent mistake.' },
]

export const classifyCorrection = (text: string): ClassifiedCorrection | null => {
  const rule = correctionRules.find(({ pattern }) => pattern.test(text))
  return rule ? { category: rule.category, confidence: rule.confidence, explanation: rule.explanation } : null
}

/** Uses the inclusive linear interpolation definition at index (n - 1) * p. */
export const percentile = (values: (number | null)[], p: number): number | null => {
  if (p < 0 || p > 1) throw new RangeError('Percentile must be between 0 and 1')
  const sorted = values.filter((value): value is number => value !== null).sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const index = (sorted.length - 1) * p
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lower = sorted[lowerIndex]
  const upper = sorted[upperIndex]
  if (lower === undefined || upper === undefined) return null
  return lower + (upper - lower) * (index - lowerIndex)
}

const metric = ({
  value,
  unit,
  measurementClass,
  evidence,
  missingReason,
}: MetricValue): MetricValue => ({
  value,
  unit,
  measurementClass,
  evidence,
  ...(missingReason ? { missingReason } : {}),
})

const countedCorrectionCategories = "('agent_mistake', 'unproductive_steering')"
const effectiveCorrectionCount = `
  CASE
    WHEN c.user_counts_as_correction IS NOT NULL THEN c.user_counts_as_correction
    WHEN c.category IN ${countedCorrectionCategories} THEN 1
    ELSE 0
  END
`

const defaultPageLimit = 100
const maximumPageLimit = 200

const pageValues = ({
  offset = 0,
  limit = defaultPageLimit,
}: {
  offset?: number
  limit?: number
}): { offset: number; limit: number } => ({
  offset: Math.max(0, Math.floor(offset)),
  limit: Math.min(maximumPageLimit, Math.max(1, Math.floor(limit))),
})

const likePattern = (value: string): string =>
  `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`

export const refreshSessionMetrics = ({
  database,
  sessionId,
}: {
  database: TurnscopeDatabase
  sessionId: string
}): void => {
  database.prepare(`
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
      (SELECT COUNT(*) FROM corrections c WHERE c.session_id = s.id
        AND ${effectiveCorrectionCount} = 1),
      (SELECT COUNT(*) FROM events e
        WHERE e.session_id = s.id AND e.tool_status IN ('failed', 'error'))
    FROM sessions s
    WHERE s.id = ?
    ON CONFLICT(session_id) DO UPDATE SET
      event_count = excluded.event_count,
      user_turn_count = excluded.user_turn_count,
      input_tokens = excluded.input_tokens,
      cached_input_tokens = excluded.cached_input_tokens,
      output_tokens = excluded.output_tokens,
      corrections = excluded.corrections,
      errors = excluded.errors
  `).run(sessionId)
}

const ensureSessionMetrics = (database: TurnscopeDatabase): void => {
  const missing = database.prepare(`
    SELECT s.id
    FROM sessions s
    LEFT JOIN session_metrics m ON m.session_id = s.id
    WHERE m.session_id IS NULL
  `).all() as { id: string }[]
  for (const { id } of missing) refreshSessionMetrics({ database, sessionId: id })
}

interface SessionRowsQuery extends ProjectSessionsQuery {
  repository?: string | null
  sessionId?: string
}

const listSessionRows = (
  database: TurnscopeDatabase,
  query: SessionRowsQuery = {},
): PageResult<SessionSummary> => {
  ensureSessionMetrics(database)
  const { offset, limit } = pageValues(query)
  const conditions: string[] = []
  const parameters: unknown[] = []
  if (query.repository !== undefined) {
    conditions.push('s.repository IS ?')
    parameters.push(query.repository)
  }
  if (query.sessionId !== undefined) {
    conditions.push('s.id = ?')
    parameters.push(query.sessionId)
  }
  const search = query.search?.trim()
  if (search) {
    const pattern = likePattern(search)
    conditions.push(`(
      s.title LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(s.model, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`)
    parameters.push(pattern, pattern)
  }
  if (query.issue === 'corrections') conditions.push('m.corrections > 0')
  if (query.issue === 'errors') conditions.push('m.errors > 0')
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = database.prepare(`
    SELECT COUNT(*) AS count
    FROM sessions s
    INNER JOIN session_metrics m ON m.session_id = s.id
    ${where}
  `).get(...parameters) as { count: number }
  const rows = database.prepare(`
    SELECT
      s.id,
      t.source_thread_id AS threadId,
      s.title,
      s.started_at AS startedAt,
      s.ended_at AS endedAt,
      s.repository,
      s.model,
      m.event_count AS eventCount,
      m.input_tokens AS inputTokens,
      m.cached_input_tokens AS cachedInputTokens,
      m.output_tokens AS outputTokens,
      m.corrections,
      m.errors
    FROM sessions s
    INNER JOIN threads t ON t.id = s.thread_id
    INNER JOIN session_metrics m ON m.session_id = s.id
    ${where}
    ORDER BY s.started_at DESC, s.id
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset) as SessionSummary[]
  return { rows, total: total.count, offset, limit }
}

const projectId = (repository: string | null): string => repository === null
  ? 'unassigned'
  : `project_${createHash('sha256').update(repository).digest('hex').slice(0, 20)}`

const listProjectRows = (database: TurnscopeDatabase): ProjectSummary[] => {
  ensureSessionMetrics(database)
  const rows = database.prepare(`
    SELECT
      s.repository,
      COUNT(*) AS sessionCount,
      COALESCE(SUM(m.event_count), 0) AS eventCount,
      COALESCE(SUM(m.corrections), 0) AS corrections,
      COALESCE(SUM(m.errors), 0) AS errors,
      MAX(s.started_at) AS lastActiveAt
    FROM sessions s
    INNER JOIN session_metrics m ON m.session_id = s.id
    GROUP BY s.repository
  `).all() as Omit<ProjectSummary, 'id' | 'name'>[]
  const projects = rows.map((row) => ({
    ...row,
    id: projectId(row.repository),
    name: row.repository ? basename(row.repository) || row.repository : 'Unknown project',
  }))
  return projects.sort((left, right) => {
    const timeDifference = (right.lastActiveAt ? new Date(right.lastActiveAt).getTime() : 0)
      - (left.lastActiveAt ? new Date(left.lastActiveAt).getTime() : 0)
    return timeDifference || left.name.localeCompare(right.name)
  })
}

export const getOverview = (database: TurnscopeDatabase): OverviewResponse => {
  ensureSessionMetrics(database)
  const projectRows = listProjectRows(database)
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(user_turn_count), 0) AS userTurnCount,
      COALESCE(SUM(corrections), 0) AS corrections,
      COALESCE(SUM(errors), 0) AS errors,
      CASE WHEN COUNT(*) = 0 OR COUNT(input_tokens) < COUNT(*)
        THEN NULL ELSE SUM(input_tokens) END AS inputTokens,
      CASE WHEN COUNT(*) = 0 OR COUNT(cached_input_tokens) < COUNT(*)
        THEN NULL ELSE SUM(cached_input_tokens) END AS cachedInputTokens,
      CASE WHEN COUNT(*) = 0 OR COUNT(output_tokens) < COUNT(*)
        THEN NULL ELSE SUM(output_tokens) END AS outputTokens
    FROM session_metrics
  `).get() as {
    count: number
    userTurnCount: number
    corrections: number
    errors: number
    inputTokens: number | null
    cachedInputTokens: number | null
    outputTokens: number | null
  }
  const usageCount = database.prepare('SELECT COUNT(*) AS count FROM usage_records').get() as { count: number }
  const durationRows = database.prepare(`
    SELECT started_at AS startedAt, ended_at AS endedAt FROM sessions
  `).all() as { startedAt: string | null; endedAt: string | null }[]
  const sessionDurations = durationRows.map(({ startedAt, endedAt }) => {
    if (!startedAt || !endedAt) return null
    const duration = new Date(endedAt).getTime() - new Date(startedAt).getTime()
    return Number.isFinite(duration) && duration >= 0 ? duration : null
  })
  const duration = sessionDurations.length > 0
    && sessionDurations.every((value): value is number => value !== null)
    ? sessionDurations.reduce<number>((sum, value) => sum + value, 0)
    : null
  const completeInputTokens = totals.count > 0 && totals.inputTokens !== null
  const completeCachedInputTokens = totals.count > 0 && totals.cachedInputTokens !== null
  const completeOutputTokens = totals.count > 0 && totals.outputTokens !== null
  const inputTokens = completeInputTokens ? totals.inputTokens : null
  const cachedInputTokens = completeCachedInputTokens ? totals.cachedInputTokens : null
  const outputTokens = completeOutputTokens ? totals.outputTokens : null
  const cacheRatio = inputTokens !== null && inputTokens > 0 && cachedInputTokens !== null
    ? cachedInputTokens / inputTokens
    : null
  const correctionRate = totals.userTurnCount > 0
    ? totals.corrections / totals.userTurnCount
    : null

  return {
    projects: metric({ value: projectRows.length, unit: 'count', measurementClass: 'derived', evidence: [] }),
    sessions: metric({ value: totals.count, unit: 'count', measurementClass: 'direct', evidence: [] }),
    inputTokens: metric({ value: inputTokens, unit: 'tokens', measurementClass: 'direct', evidence: [], ...(usageCount.count === 0 ? { missingReason: 'No source usage records' } : !completeInputTokens ? { missingReason: 'Some imported sessions lack complete input-token data' } : {}) }),
    cachedInputTokens: metric({ value: cachedInputTokens, unit: 'tokens', measurementClass: 'direct', evidence: [], ...(usageCount.count === 0 ? { missingReason: 'No source usage records' } : !completeCachedInputTokens ? { missingReason: 'Some imported sessions lack complete cached-input-token data' } : {}) }),
    outputTokens: metric({ value: outputTokens, unit: 'tokens', measurementClass: 'direct', evidence: [], ...(usageCount.count === 0 ? { missingReason: 'No source usage records' } : !completeOutputTokens ? { missingReason: 'Some imported sessions lack complete output-token data' } : {}) }),
    cacheRatio: metric({ value: cacheRatio, unit: 'ratio', measurementClass: 'derived', evidence: [], ...(cacheRatio === null ? { missingReason: 'Input and cached-input token data are required' } : {}) }),
    duration: metric({ value: duration, unit: 'milliseconds', measurementClass: 'derived', evidence: [], ...(duration === null ? { missingReason: 'Every session requires start and end timestamps' } : {}) }),
    corrections: metric({ value: totals.corrections, unit: 'count', measurementClass: 'inferred', evidence: [] }),
    correctionRate: metric({ value: correctionRate, unit: 'ratio', measurementClass: 'derived', evidence: [], ...(correctionRate === null ? { missingReason: 'At least one user turn is required' } : {}) }),
    errors: metric({ value: totals.errors, unit: 'count', measurementClass: 'direct', evidence: [] }),
    projectRows,
  }
}

export const getProjectDetail = ({
  database,
  projectId: requestedProjectId,
  query = {},
}: {
  database: TurnscopeDatabase
  projectId: string
  query?: ProjectSessionsQuery
}): ProjectDetailResponse | null => {
  const project = listProjectRows(database).find(({ id }) => id === requestedProjectId)
  if (!project) return null
  return {
    project,
    sessions: listSessionRows(database, { ...query, repository: project.repository }),
  }
}

interface SignalRow {
  id: string
  sessionId: string
  detector: string
  severity: 'low' | 'medium' | 'high'
  confidence: number
  explanation: string
  estimatedImpactMs: number | null
  userDismissed: 0 | 1
  userUpdatedAt: string | null
}

const signalFromRow = (database: TurnscopeDatabase, row: SignalRow): PatternSignal => {
  const evidence = database.prepare(`
    SELECT se.event_id AS eventId, e.session_id AS sessionId, se.label
    FROM signal_evidence se
    INNER JOIN events e ON e.id = se.event_id
    WHERE se.signal_id = ?
    ORDER BY se.event_id
  `).all(row.id) as EvidenceRef[]
  return {
    id: row.id,
    sessionId: row.sessionId,
    detector: row.detector,
    severity: row.severity,
    confidence: row.confidence,
    explanation: row.explanation,
    dismissed: row.userDismissed === 1,
    hasUserOverride: row.userUpdatedAt !== null,
    estimatedImpact: metric({
      value: row.estimatedImpactMs,
      unit: 'milliseconds',
      measurementClass: 'inferred',
      evidence,
      ...(row.estimatedImpactMs === null ? { missingReason: 'Source tool durations are unavailable' } : {}),
    }),
    evidence,
  }
}

export const listPatterns = (
  database: TurnscopeDatabase,
  sessionId?: string,
): PatternSignal[] => {
  const where = sessionId === undefined ? '' : 'WHERE session_id = ?'
  const rows = database.prepare(`
    SELECT id, session_id AS sessionId, detector, severity, confidence, explanation,
      estimated_impact_ms AS estimatedImpactMs,
      user_dismissed AS userDismissed,
      user_updated_at AS userUpdatedAt
    FROM signals
    ${where}
    ORDER BY CASE severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, id
  `).all(...(sessionId === undefined ? [] : [sessionId])) as SignalRow[]
  return rows.map((row) => signalFromRow(database, row))
}

export const getDiagnostics = (database: TurnscopeDatabase): DiagnosticsResponse => {
  ensureSessionMetrics(database)
  const signals = listPatterns(database)
  const correctionCategories = (database.prepare(`
    SELECT
      COALESCE(user_category, category) AS category,
      COUNT(*) AS candidates,
      SUM(${effectiveCorrectionCount}) AS countedCorrections,
      SUM(CASE WHEN user_category IS NOT NULL OR user_counts_as_correction IS NOT NULL
        THEN 1 ELSE 0 END) AS userOverrides
    FROM corrections c
    GROUP BY COALESCE(user_category, category)
    ORDER BY countedCorrections DESC, candidates DESC, category
  `).all() as Omit<DiagnosticsResponse['correctionCategories'][number], 'id' | 'evidence'>[])
    .map((row) => {
      const evidence = database.prepare(`
        SELECT c.event_id AS eventId, c.session_id AS sessionId,
          SUBSTR(COALESCE(NULLIF(s.title, ''), 'Untitled session'), 1, 44)
            || ' · event #' || e.source_order AS label
        FROM corrections c
        INNER JOIN events e ON e.id = c.event_id
        INNER JOIN sessions s ON s.id = c.session_id
        WHERE COALESCE(c.user_category, c.category) = ?
        ORDER BY c.confidence DESC, c.event_id
        LIMIT 3
      `).all(row.category) as EvidenceRef[]
      return {
        ...row,
        id: `correction-${row.category}`,
        evidence,
      }
    })
  const toolFailureRows = database.prepare(`
    SELECT
      tool_name AS toolName,
      COUNT(*) AS failures,
      COUNT(DISTINCT session_id) AS affectedSessions,
      AVG(duration_ms) AS averageFailureDurationMs
    FROM events
    WHERE tool_name IS NOT NULL AND tool_status IN ('failed', 'error')
    GROUP BY tool_name
    ORDER BY failures DESC, toolName
    LIMIT 25
  `).all() as Omit<ToolFailureDiagnostic, 'id' | 'evidence' | 'recordedEvents'>[]
  const toolFailures = toolFailureRows.map((row) => {
    const total = database.prepare(`
      SELECT COUNT(*) AS count FROM events WHERE tool_name = ?
    `).get(row.toolName) as { count: number }
    const evidence = database.prepare(`
      SELECT e.id AS eventId, e.session_id AS sessionId,
        SUBSTR(COALESCE(NULLIF(s.title, ''), 'Untitled session'), 1, 44)
          || ' · event #' || e.source_order AS label
      FROM events e
      INNER JOIN sessions s ON s.id = e.session_id
      WHERE e.tool_name = ? AND e.tool_status IN ('failed', 'error')
      ORDER BY e.occurred_at DESC, e.source_order DESC
      LIMIT 3
    `).all(row.toolName) as EvidenceRef[]
    return {
      ...row,
      id: `tool-${createHash('sha256').update(row.toolName).digest('hex').slice(0, 12)}`,
      recordedEvents: total.count,
      evidence,
    }
  })
  const totals = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM corrections) AS correctionCandidates,
      (SELECT COALESCE(SUM(corrections), 0) FROM session_metrics) AS countedCorrections,
      (SELECT COALESCE(SUM(errors), 0) FROM session_metrics) AS failedToolEvents,
      (SELECT COUNT(*) FROM usage_records) AS usageRecords,
      (SELECT COUNT(DISTINCT session_id) FROM usage_records) AS sessionsWithUsage,
      (SELECT COUNT(*) FROM session_metrics) AS totalSessions,
      (SELECT SUM(input_tokens) FROM usage_records) AS inputTokens,
      (SELECT SUM(cached_input_tokens) FROM usage_records) AS cachedInputTokens,
      (SELECT SUM(output_tokens) FROM usage_records) AS outputTokens
  `).get() as {
    correctionCandidates: number
    countedCorrections: number
    failedToolEvents: number
    usageRecords: number
    sessionsWithUsage: number
    totalSessions: number
    inputTokens: number | null
    cachedInputTokens: number | null
    outputTokens: number | null
  }

  return {
    signalCount: signals.length,
    correctionCandidates: totals.correctionCandidates,
    countedCorrections: totals.countedCorrections,
    correctionCategories,
    failedToolEvents: totals.failedToolEvents,
    toolFailures,
    tokenCoverage: {
      usageRecords: totals.usageRecords,
      sessionsWithUsage: totals.sessionsWithUsage,
      totalSessions: totals.totalSessions,
      coverageRatio: totals.totalSessions > 0
        ? totals.sessionsWithUsage / totals.totalSessions
        : 0,
      inputTokens: totals.inputTokens,
      cachedInputTokens: totals.cachedInputTokens,
      outputTokens: totals.outputTokens,
      limitation: 'Token totals are direct, but wasted-token judgments require outcome attribution and a comparison baseline.',
    },
    skillCoverage: {
      status: 'unavailable',
      reason: 'Imported events do not yet contain normalized skill invocation and outcome records, so skill efficiency cannot be measured reliably.',
    },
    signals,
  }
}

export const rebuildSignals = ({ database, sessionId }: { database: TurnscopeDatabase; sessionId: string }): void => {
  const failures = database.prepare(`
    SELECT id, installation_id AS installationId, tool_signature AS toolSignature,
      summary, duration_ms AS durationMs
    FROM events
    WHERE session_id = ? AND tool_status IN ('failed', 'error') AND tool_signature IS NOT NULL
    ORDER BY occurred_at, source_order
  `).all(sessionId) as {
    id: string
    installationId: string
    toolSignature: string
    summary: string
    durationMs: number | null
  }[]

  const bySignature = new Map<string, typeof failures>()
  for (const failure of failures) {
    bySignature.set(failure.toolSignature, [...(bySignature.get(failure.toolSignature) ?? []), failure])
  }
  const repeated = [...bySignature.entries()]
    .filter(([, events]) => events.length >= 2)
    .sort((left, right) => right[1].length - left[1].length)[0]
  if (!repeated) {
    database.prepare(`
      DELETE FROM signals WHERE session_id = ? AND detector = 'repeated_failing_tool_calls'
    `).run(sessionId)
    return
  }

  const [signature, events] = repeated
  const installationId = events[0]?.installationId
  if (!installationId) return
  const signalId = `signal_${sessionId.slice(-20)}_repeated_failures`
  const durations = events.map(({ durationMs }) => durationMs)
  const estimatedImpact = durations.every((duration): duration is number => duration !== null)
    ? durations.reduce((sum, duration) => sum + duration, 0)
    : null
  const severity = events.length >= 4 ? 'high' : events.length === 3 ? 'medium' : 'medium'
  database.prepare(`
    INSERT INTO signals (
      id, installation_id, session_id, detector, severity, confidence,
      explanation, estimated_impact_ms
    ) VALUES (?, ?, ?, 'repeated_failing_tool_calls', ?, ?, ?, ?)
    ON CONFLICT(session_id, detector) DO UPDATE SET
      severity = excluded.severity,
      confidence = excluded.confidence,
      explanation = excluded.explanation,
      estimated_impact_ms = excluded.estimated_impact_ms
  `).run(
    signalId,
    installationId,
    sessionId,
    severity,
    0.95,
    `The same tool action failed ${events.length} times: ${signature}`,
    estimatedImpact,
  )
  database.prepare('DELETE FROM signal_evidence WHERE signal_id = ?').run(signalId)
  const insertEvidence = database.prepare(`
    INSERT INTO signal_evidence (signal_id, event_id, label) VALUES (?, ?, ?)
  `)
  for (const event of events) insertEvidence.run(signalId, event.id, event.summary)
}

export const getSessionDetail = ({
  database,
  sessionId,
  query = {},
}: {
  database: TurnscopeDatabase
  sessionId: string
  query?: SessionTimelineQuery
}): SessionDetailResponse | null => {
  const session = listSessionRows(database, { sessionId, limit: 1 }).rows[0]
  if (!session) return null
  const { offset, limit } = pageValues(query)
  const conditions = ['e.session_id = ?']
  const parameters: unknown[] = [sessionId]
  const search = query.search?.trim()
  if (search) {
    const pattern = likePattern(search)
    conditions.push(`(
      e.summary LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(e.tool_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`)
    parameters.push(pattern, pattern)
  }
  if (query.actor) {
    conditions.push('e.actor = ?')
    parameters.push(query.actor)
  }
  if (query.eventId) {
    conditions.push('e.id = ?')
    parameters.push(query.eventId)
  }
  const where = conditions.join(' AND ')
  const timelineTotal = database.prepare(`
    SELECT COUNT(*) AS count FROM events e WHERE ${where}
  `).get(...parameters) as { count: number }
  const timeline = database.prepare(`
    SELECT
      e.id,
      e.source_record_id AS sourceRecordId,
      e.kind,
      e.actor,
      e.occurred_at AS occurredAt,
      e.source_order AS sourceOrder,
      e.summary,
      e.tool_name AS toolName,
      e.tool_status AS toolStatus,
      e.duration_ms AS durationMs
    FROM events e
    WHERE ${where}
    ORDER BY e.occurred_at IS NULL, e.occurred_at, e.source_order
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset) as Omit<TimelineEvent, 'labels'>[]
  const correctionRows = database.prepare(`
    SELECT
      id,
      event_id AS eventId,
      classification_method AS classificationMethod,
      category AS inferredCategory,
      COALESCE(user_category, category) AS category,
      confidence,
      explanation,
      ${effectiveCorrectionCount} = 1 AS countsAsCorrection,
      user_counts_as_correction IS NOT NULL OR user_category IS NOT NULL AS hasUserOverride
    FROM corrections c WHERE c.session_id = ? ORDER BY event_id
  `).all(sessionId) as (Omit<CorrectionView, 'countsAsCorrection' | 'hasUserOverride'> & {
    countsAsCorrection: 0 | 1
    hasUserOverride: 0 | 1
  })[]
  const corrections: CorrectionView[] = correctionRows.map((correction) => ({
    ...correction,
    countsAsCorrection: correction.countsAsCorrection === 1,
    hasUserOverride: correction.hasUserOverride === 1,
  }))
  const correctionEvents = new Set(corrections.map(({ eventId }) => eventId))
  const signals = listPatterns(database, sessionId)
  const signalEvents = new Map<string, string[]>()
  for (const signal of signals) {
    for (const evidence of signal.evidence) {
      signalEvents.set(evidence.eventId, [...(signalEvents.get(evidence.eventId) ?? []), signal.detector])
    }
  }

  return {
    session,
    timeline: {
      rows: timeline.map((event) => ({
        ...event,
        labels: [
          ...(correctionEvents.has(event.id) ? ['correction'] : []),
          ...(signalEvents.get(event.id) ?? []),
        ],
      })),
      total: timelineTotal.count,
      offset,
      limit,
    },
    corrections,
    signals,
  }
}
