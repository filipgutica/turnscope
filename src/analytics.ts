import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import type {
  AnalyticsRange,
  AnalyticsRangeContext,
  AnalyticsRangeQuery,
  CorrectionView,
  CoverageValue,
  DataHealthSummary,
  DiagnosticsResponse,
  EvidenceRef,
  ImportWarning,
  MetricValue,
  OverviewResponse,
  OverviewFinding,
  PatternSignal,
  PageResult,
  ProjectDetailResponse,
  ProjectSessionsQuery,
  ProjectSummary,
  SessionDetailResponse,
  SessionSummary,
  SessionTimelineQuery,
  TimelineEvent,
  ToolCategory,
  ToolHealthCategory,
  ToolHealthResponse,
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

const rangeLabels: Record<AnalyticsRange, AnalyticsRangeContext['label']> = {
  '7d': '7 days',
  '30d': '30 days',
  all: 'All time',
}

export const analyticsRangeContext = ({
  range = '30d',
  now = new Date(),
}: {
  range?: AnalyticsRange
  now?: Date
} = {}): AnalyticsRangeContext => {
  const to = now.toISOString()
  const days = range === '7d' ? 7 : range === '30d' ? 30 : null
  const from = days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString()
  return {
    range,
    label: rangeLabels[range],
    from,
    to,
    boundaryDescription: from === null
      ? 'Includes every imported session and invocation, including records without timestamps.'
      : 'Inclusive boundaries: sessions use their last imported activity and tool invocations use their reported occurrence time. Records without timestamps are excluded.',
  }
}

const coverage = ({
  numerator,
  denominator,
  limitation,
}: {
  numerator: number
  denominator: number
  limitation: string
}): CoverageValue => ({
  numerator,
  denominator,
  ratio: denominator > 0 ? numerator / denominator : null,
  measurementClass: 'derived',
  limitation,
})

const rangeSql = (
  context: AnalyticsRangeContext,
  alias = 's',
): { clause: string; parameters: string[] } => context.from === null
  ? { clause: '1 = 1', parameters: [] }
  : {
      clause: `julianday(COALESCE(${alias}.ended_at, ${alias}.started_at)) >= julianday(?)
        AND julianday(COALESCE(${alias}.ended_at, ${alias}.started_at)) <= julianday(?)`,
      parameters: [context.from, context.to],
    }

const timestampRangeSql = (
  context: AnalyticsRangeContext,
  expression: string,
): { clause: string; parameters: string[] } => context.from === null
  ? { clause: '1 = 1', parameters: [] }
  : {
      clause: `julianday(${expression}) >= julianday(?) AND julianday(${expression}) <= julianday(?)`,
      parameters: [context.from, context.to],
    }

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
      (SELECT COUNT(*) FROM tool_invocations ti
        WHERE ti.session_id = s.id AND ti.status = 'failure')
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

const listProjectRows = (
  database: TurnscopeDatabase,
  context = analyticsRangeContext({ range: 'all' }),
): ProjectSummary[] => {
  ensureSessionMetrics(database)
  const range = rangeSql(context)
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
    WHERE ${range.clause}
    GROUP BY s.repository
  `).all(...range.parameters) as Omit<ProjectSummary, 'id' | 'name'>[]
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

export const getDataHealth = ({
  database,
  context,
}: {
  database: TurnscopeDatabase
  context: AnalyticsRangeContext
}): DataHealthSummary => {
  const range = rangeSql(context)
  const toolRange = timestampRangeSql(context, 'ti.occurred_at')
  const sessions = database.prepare(`SELECT COUNT(*) AS count FROM sessions s WHERE ${range.clause}`)
    .get(...range.parameters) as { count: number }
  const tokenUsage = database.prepare(`
    SELECT COUNT(DISTINCT u.session_id) AS count
    FROM usage_records u INNER JOIN sessions s ON s.id = u.session_id
    WHERE ${range.clause}
      AND (u.input_tokens IS NOT NULL OR u.cached_input_tokens IS NOT NULL
        OR u.output_tokens IS NOT NULL OR u.reasoning_output_tokens IS NOT NULL)
  `).get(...range.parameters) as { count: number }
  const toolCoverage = database.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(status) AS statuses,
      COUNT(duration_ms) AS timings
    FROM tool_invocations ti INNER JOIN sessions s ON s.id = ti.session_id
    WHERE ${toolRange.clause}
  `).get(...toolRange.parameters) as { total: number; statuses: number; timings: number }
  const sources = database.prepare(`
    SELECT
      id, product, product_version AS productVersion, adapter_version AS adapterVersion,
      compatibility, warning, last_imported_at AS lastImportedAt
    FROM product_installations
    ORDER BY product, id
  `).all() as DataHealthSummary['sources']
  const lastImport = database.prepare(`
    SELECT MAX(completed_at) AS completedAt FROM import_audits WHERE status = 'success'
  `).get() as { completedAt: string | null }
  const sourceFileRows = database.prepare(`
    SELECT warnings_json AS warningsJson FROM source_files
  `).all() as { warningsJson: string }[]
  const sourceFileWarnings = sourceFileRows.flatMap(({ warningsJson }) => {
    try {
      const parsed = JSON.parse(warningsJson) as unknown
      return Array.isArray(parsed)
        ? parsed.filter((warning): warning is ImportWarning => {
          if (warning === null || typeof warning !== 'object') return false
          const value = warning as Partial<ImportWarning>
          return typeof value.code === 'string' && typeof value.message === 'string'
        })
        : []
    } catch {
      return []
    }
  })
  const warningGroups = new Map<string, { warning: ImportWarning; count: number; messages: Set<string> }>()
  for (const warning of sourceFileWarnings) {
    const existing = warningGroups.get(warning.code)
    warningGroups.set(warning.code, {
      warning: existing?.warning ?? warning,
      count: (existing?.count ?? 0) + 1,
      messages: new Set([...(existing?.messages ?? []), warning.message]),
    })
  }
  const reimportRequired = database.prepare(`
    SELECT COUNT(*) AS count FROM source_files WHERE adapter_version IS NULL
  `).get() as { count: number }
  const activeWarnings = [
    ...(reimportRequired.count > 0 ? [{
      code: 'normalization_reimport_required',
      message: `${reimportRequired.count} imported source file${reimportRequired.count === 1 ? '' : 's'} must be reimported before normalized tool health is available.`,
      source: 'Database upgrade',
    }] : []),
    ...[...warningGroups.values()].map(({ warning, count, messages }) => ({
      ...warning,
      message: messages.size > 1
        ? `${count} source files report ${messages.size} distinct ${warning.code.replaceAll('_', ' ')} conditions; inspect the representative source for details.`
        : count > 1 ? `${warning.message} Reported by ${count} source files.` : warning.message,
    })),
  ]

  return {
    importedSessions: sessions.count,
    lastSuccessfulImport: lastImport.completedAt,
    sources,
    tokenUsageCoverage: coverage({
      numerator: tokenUsage.count,
      denominator: sessions.count,
      limitation: 'Sessions without compatible source usage records cannot contribute to token totals.',
    }),
    toolStatusCoverage: coverage({
      numerator: toolCoverage.statuses,
      denominator: toolCoverage.total,
      limitation: 'Invocations without an explicit terminal status are excluded from success-rate calculations.',
    }),
    toolTimingCoverage: coverage({
      numerator: toolCoverage.timings,
      denominator: toolCoverage.total,
      limitation: 'Execution percentiles require an explicit adapter-normalized duration; event timestamps are not substituted.',
    }),
    outcomeCoverage: coverage({
      numerator: 0,
      denominator: sessions.count,
      limitation: 'The Codex rollout adapter does not expose a defensible session outcome, so outcome judgments are unavailable.',
    }),
    activeWarnings,
  }
}

const attentionThreshold = 0.5

export const getOverview = (
  database: TurnscopeDatabase,
  query: AnalyticsRangeQuery = {},
  now = new Date(),
): OverviewResponse => {
  ensureSessionMetrics(database)
  const context = analyticsRangeContext({ range: query.range ?? '30d', now })
  const range = rangeSql(context)
  const toolRange = timestampRangeSql(context, 'ti.occurred_at')
  const dataHealth = getDataHealth({ database, context })
  const spanRows = database.prepare(`
    SELECT started_at AS startedAt, ended_at AS endedAt
    FROM sessions s WHERE ${range.clause}
  `).all(...range.parameters) as { startedAt: string | null; endedAt: string | null }[]
  const spans = spanRows.map(({ startedAt, endedAt }) => {
    if (!startedAt || !endedAt) return null
    const value = new Date(endedAt).getTime() - new Date(startedAt).getTime()
    return Number.isFinite(value) && value >= 0 ? value : null
  })
  const validSpanCount = spans.filter((value): value is number => value !== null).length
  const statusCoverage = dataHealth.toolStatusCoverage.ratio
  const canShowAttention = statusCoverage !== null && statusCoverage >= attentionThreshold
  const attentionRows = database.prepare(`
    SELECT
      s.id AS sessionId,
      s.title,
      COUNT(*) AS issueCount,
      MIN(ti.status_event_id) AS eventId
    FROM tool_invocations ti
    INNER JOIN sessions s ON s.id = ti.session_id
    WHERE ${toolRange.clause} AND ti.status IN ('failure', 'rejected', 'cancelled')
    GROUP BY s.id, s.title
    ORDER BY issueCount DESC, COALESCE(s.ended_at, s.started_at) DESC
  `).all(...toolRange.parameters) as { sessionId: string; title: string; issueCount: number; eventId: string | null }[]
  const evidenceForAttention = attentionRows.flatMap((row) => row.eventId ? [{
    eventId: row.eventId,
    sessionId: row.sessionId,
    label: `${row.title} · reported tool issue`,
  }] : []).slice(0, 5)
  const findings: OverviewFinding[] = canShowAttention
    ? attentionRows.slice(0, 5).flatMap((row) => row.eventId === null ? [] : [{
        id: `attention-${row.sessionId}`,
        title: row.title,
        reason: `${row.issueCount} tool invocation${row.issueCount === 1 ? '' : 's'} reported failure, rejection, or cancellation in this range.`,
        measurementClass: 'derived' as const,
        evidence: [{
          eventId: row.eventId,
          sessionId: row.sessionId,
          label: 'Open representative source event',
        }],
      }])
    : []
  const recentRows = database.prepare(`
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
    WHERE ${range.clause}
    ORDER BY COALESCE(s.ended_at, s.started_at) DESC, s.id
    LIMIT 12
  `).all(...range.parameters) as SessionSummary[]
  const attentionBySession = new Map(attentionRows.map((row) => [row.sessionId, row]))

  return {
    range: context,
    recentSessions: metric({
      value: dataHealth.importedSessions,
      unit: 'count',
      measurementClass: 'direct',
      evidence: [],
    }),
    sessionsNeedingAttention: metric({
      value: canShowAttention ? attentionRows.length : null,
      unit: 'count',
      measurementClass: 'derived',
      evidence: canShowAttention ? evidenceForAttention : [],
      ...(!canShowAttention ? {
        missingReason: `Tool-status coverage must reach ${attentionThreshold * 100}% before Turnscope presents an attention aggregate.`,
      } : {}),
    }),
    toolReliabilityCoverage: dataHealth.toolStatusCoverage,
    outcomeCoverage: dataHealth.outcomeCoverage,
    sessionSpan: {
      medianMs: percentile(spans, 0.5),
      p90Ms: percentile(spans, 0.9),
      coverage: coverage({
        numerator: validSpanCount,
        denominator: spanRows.length,
        limitation: 'A session needs valid first and last imported event timestamps to contribute.',
      }),
      definition: 'First-to-last imported event interval. Session span includes idle and resumed gaps; it is not active agent time and is never summed.',
    },
    findings,
    findingsLimitation: canShowAttention
      ? findings.length === 0 ? 'No failure, rejection, or cancellation was reported for a normalized invocation in this range.' : null
      : `Evidence-backed attention findings are hidden because tool-status coverage is ${dataHealth.toolStatusCoverage.numerator} of ${dataHealth.toolStatusCoverage.denominator}.`,
    recentSessionRows: recentRows.map((session) => {
      const attention = attentionBySession.get(session.id)
      if (!canShowAttention) return {
        ...session,
        attentionStatus: 'coverage_limited' as const,
        attentionReason: `Status coverage is ${dataHealth.toolStatusCoverage.numerator} of ${dataHealth.toolStatusCoverage.denominator}; attention classification is unavailable.`,
        evidence: [],
      }
      return {
        ...session,
        attentionStatus: attention ? 'needs_attention' : 'no_observed_issue',
        attentionReason: attention
          ? `${attention.issueCount} reported tool issue${attention.issueCount === 1 ? '' : 's'}`
          : 'No issue was reported in normalized tool status data.',
        evidence: attention?.eventId ? [{
          eventId: attention.eventId,
          sessionId: attention.sessionId,
          label: 'View reported issue',
        }] : [],
      }
    }),
    dataHealth,
    projectRows: listProjectRows(database, context),
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
  const totals = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM corrections) AS correctionCandidates,
      (SELECT COALESCE(SUM(corrections), 0) FROM session_metrics) AS countedCorrections,
      (SELECT COUNT(*) FROM usage_records
        WHERE input_tokens IS NOT NULL OR cached_input_tokens IS NOT NULL
          OR output_tokens IS NOT NULL OR reasoning_output_tokens IS NOT NULL) AS usageRecords,
      (SELECT COUNT(DISTINCT session_id) FROM usage_records
        WHERE input_tokens IS NOT NULL OR cached_input_tokens IS NOT NULL
          OR output_tokens IS NOT NULL OR reasoning_output_tokens IS NOT NULL) AS sessionsWithUsage,
      (SELECT COUNT(*) FROM session_metrics) AS totalSessions,
      (SELECT SUM(input_tokens) FROM usage_records) AS inputTokens,
      (SELECT SUM(cached_input_tokens) FROM usage_records) AS cachedInputTokens,
      (SELECT SUM(output_tokens) FROM usage_records) AS outputTokens
  `).get() as {
    correctionCandidates: number
    countedCorrections: number
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
    tokenCoverage: {
      usageRecords: totals.usageRecords,
      sessionsWithUsage: totals.sessionsWithUsage,
      totalSessions: totals.totalSessions,
      coverageRatio: totals.totalSessions > 0
        ? totals.sessionsWithUsage / totals.totalSessions
        : null,
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

const toolCategoryLabels: Record<ToolCategory, string> = {
  terminal: 'Terminal',
  file_read: 'File read',
  file_change: 'File change',
  search: 'Search',
  web: 'Web',
  browser: 'Browser',
  subagent: 'Subagent',
  mcp: 'MCP tool',
  other: 'Other tool',
}

interface ToolHealthRow {
  id: string
  sessionId: string
  category: ToolCategory
  rawName: string | null
  signature: string | null
  status: 'success' | 'failure' | 'rejected' | 'cancelled' | null
  durationMs: number | null
  occurredAt: string | null
  evidenceEventId: string | null
  sessionTitle: string
}

export const getToolHealth = (
  database: TurnscopeDatabase,
  query: AnalyticsRangeQuery = {},
  now = new Date(),
): ToolHealthResponse => {
  const context = analyticsRangeContext({ range: query.range ?? '30d', now })
  const range = timestampRangeSql(context, 'ti.occurred_at')
  const rows = database.prepare(`
    SELECT
      ti.id,
      ti.session_id AS sessionId,
      ti.category,
      ti.raw_tool_name AS rawName,
      ti.signature,
      ti.status,
      ti.duration_ms AS durationMs,
      ti.occurred_at AS occurredAt,
      COALESCE(ti.status_event_id, MIN(tie.event_id)) AS evidenceEventId,
      s.title AS sessionTitle
    FROM tool_invocations ti
    INNER JOIN sessions s ON s.id = ti.session_id
    LEFT JOIN tool_invocation_evidence tie ON tie.invocation_id = ti.id
    WHERE ${range.clause}
    GROUP BY ti.id
    ORDER BY ti.occurred_at DESC, ti.id
  `).all(...range.parameters) as ToolHealthRow[]
  const dataHealth = getDataHealth({ database, context })
  const byCategory = new Map<ToolCategory, ToolHealthRow[]>()
  for (const row of rows) byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row])

  const categories: ToolHealthCategory[] = [...byCategory.entries()].map(([category, invocations]) => {
    const knownStatuses = invocations.filter(({ status }) => status !== null)
    const successes = knownStatuses.filter(({ status }) => status === 'success').length
    const failures = knownStatuses.filter(({ status }) => status === 'failure').length
    const rejected = knownStatuses.filter(({ status }) => status === 'rejected').length
    const cancelled = knownStatuses.filter(({ status }) => status === 'cancelled').length
    const signatures = invocations.filter((row): row is ToolHealthRow & { signature: string } => row.signature !== null)
    const signatureGroups = new Map<string, number>()
    for (const row of signatures) {
      const key = `${row.sessionId}:${row.category}:${row.rawName ?? ''}:${row.signature}`
      signatureGroups.set(key, (signatureGroups.get(key) ?? 0) + 1)
    }
    const repeats = [...signatureGroups.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
    const timings = invocations.map(({ durationMs }) => durationMs)
    const evidence = invocations
      .sort((left, right) => {
        const leftIssue = left.status === 'failure' || left.status === 'rejected' || left.status === 'cancelled' ? 1 : 0
        const rightIssue = right.status === 'failure' || right.status === 'rejected' || right.status === 'cancelled' ? 1 : 0
        return rightIssue - leftIssue || (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')
      })
      .slice(0, 3)
      .flatMap((row) => row.evidenceEventId === null ? [] : [{
        eventId: row.evidenceEventId,
        sessionId: row.sessionId,
        label: `${row.sessionTitle} · ${row.rawName ?? toolCategoryLabels[category]}`,
      }])
    return {
      id: `tool-${category}`,
      category,
      label: toolCategoryLabels[category],
      uniqueInvocations: invocations.length,
      statusCoverage: coverage({
        numerator: knownStatuses.length,
        denominator: invocations.length,
        limitation: 'Only invocations with an explicit terminal status contribute to success and failure rates.',
      }),
      successfulInvocations: successes,
      failedInvocations: failures,
      successRate: coverage({
        numerator: successes,
        denominator: knownStatuses.length,
        limitation: 'Success rate uses known terminal statuses only; rejected and cancelled invocations remain in the denominator.',
      }),
      affectedSessions: new Set(invocations.map(({ sessionId }) => sessionId)).size,
      permissionRejections: rejected > 0 ? rejected : null,
      cancellations: cancelled > 0 ? cancelled : null,
      interventionLimitation: 'Codex does not provide complete permission-decision telemetry; only explicit rejection or cancellation results are shown.',
      repeatInvocations: signatures.length > 0 ? repeats : null,
      repeatCoverage: coverage({
        numerator: signatures.length,
        denominator: invocations.length,
        limitation: 'Repeat counts compare stable, redacted invocation signatures within one session and are not labeled as retries.',
      }),
      medianDurationMs: percentile(timings, 0.5),
      p90DurationMs: percentile(timings, 0.9),
      timingCoverage: coverage({
        numerator: timings.filter((value) => value !== null).length,
        denominator: invocations.length,
        limitation: 'Timing requires an explicit, usable operation duration from the source adapter.',
      }),
      evidence,
    }
  }).sort((left, right) => right.uniqueInvocations - left.uniqueInvocations || left.label.localeCompare(right.label))

  return {
    range: context,
    totalInvocations: rows.length,
    statusCoverage: dataHealth.toolStatusCoverage,
    timingCoverage: dataHealth.toolTimingCoverage,
    categories,
    dataHealth,
    limitation: 'Codex rollout JSONL is undocumented and can expose independently identified tool layers. Turnscope pairs exact source IDs only and never merges by timestamp, label, or command text.',
  }
}

export const rebuildSignals = ({ database, sessionId }: { database: TurnscopeDatabase; sessionId: string }): void => {
  const failures = database.prepare(`
    SELECT
      ti.status_event_id AS id,
      ti.installation_id AS installationId,
      ti.signature AS toolSignature,
      COALESCE(e.summary, ti.raw_tool_name, ti.category) AS summary,
      ti.duration_ms AS durationMs
    FROM tool_invocations ti
    LEFT JOIN events e ON e.id = ti.status_event_id
    WHERE ti.session_id = ? AND ti.status = 'failure'
      AND ti.signature IS NOT NULL AND ti.status_event_id IS NOT NULL
    ORDER BY ti.occurred_at, ti.id
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
