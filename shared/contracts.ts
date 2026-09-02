import type { CorrectionCategory } from './corrections.js'

export type MeasurementClass = 'direct' | 'derived' | 'inferred'

export interface EvidenceRef {
  eventId: string
  sessionId: string
  label: string
}

export interface MetricValue {
  value: number | null
  unit: 'count' | 'tokens' | 'milliseconds' | 'ratio' | 'currency'
  measurementClass: MeasurementClass
  evidence: EvidenceRef[]
  missingReason?: string
}

export interface ImportWarning {
  code: string
  message: string
  source?: string
}

export interface ImportResult {
  installationId: string
  filesScanned: number
  filesImported: number
  filesSkipped: number
  recordsInserted: number
  recordsUnchanged: number
  warnings: ImportWarning[]
}

export type ImportPhase = 'discovering' | 'importing' | 'analyzing'

export interface ImportProgress {
  phase: ImportPhase
  filesTotal: number
  filesProcessed: number
  filesImported: number
  filesSkipped: number
  recordsInserted: number
  recordsUnchanged: number
  warningCount: number
  currentFile: string | null
}

export interface ImportJobStatus {
  state: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  phase: ImportPhase | null
  startedAt: string | null
  completedAt: string | null
  progress: Omit<ImportProgress, 'phase' | 'warningCount'>
  warningCount: number
  warnings: ImportWarning[]
  error: string | null
}

export interface ProductInstallationSummary {
  id: string
  product: string
  productVersion: string | null
  sourceRoot: string
  compatibility: 'supported' | 'warning' | 'unsupported'
  warning: string | null
  lastImportedAt: string | null
}

export interface SessionSummary {
  id: string
  threadId: string
  title: string
  startedAt: string | null
  endedAt: string | null
  repository: string | null
  model: string | null
  eventCount: number
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  corrections: number
  errors: number
}

export interface ProjectSummary {
  id: string
  name: string
  repository: string | null
  sessionCount: number
  eventCount: number
  corrections: number
  errors: number
  lastActiveAt: string | null
}

export interface PageResult<T> {
  rows: T[]
  total: number
  offset: number
  limit: number
}

export interface ProjectSessionsQuery {
  offset?: number
  limit?: number
  search?: string
  issue?: 'corrections' | 'errors'
}

export interface SessionTimelineQuery {
  offset?: number
  limit?: number
  search?: string
  actor?: Exclude<TimelineEvent['actor'], null>
  eventId?: string
}

export interface OverviewResponse {
  projects: MetricValue
  sessions: MetricValue
  inputTokens: MetricValue
  cachedInputTokens: MetricValue
  outputTokens: MetricValue
  cacheRatio: MetricValue
  duration: MetricValue
  corrections: MetricValue
  correctionRate: MetricValue
  errors: MetricValue
  projectRows: ProjectSummary[]
}

export interface ProjectDetailResponse {
  project: ProjectSummary
  sessions: PageResult<SessionSummary>
}

export interface TimelineEvent {
  id: string
  sourceRecordId: string
  kind: string
  actor: 'user' | 'agent' | 'tool' | 'system' | null
  occurredAt: string | null
  sourceOrder: number
  summary: string
  toolName: string | null
  toolStatus: string | null
  durationMs: number | null
  labels: string[]
}

export interface CorrectionView {
  id: string
  eventId: string
  classificationMethod: 'heuristic' | 'user'
  inferredCategory: CorrectionCategory
  category: CorrectionCategory
  confidence: number
  explanation: string
  countsAsCorrection: boolean
  hasUserOverride: boolean
}

export interface CorrectionOverrideInput {
  category: CorrectionView['category']
  countsAsCorrection: boolean
}

export interface PatternSignal {
  id: string
  sessionId: string
  detector: string
  severity: 'low' | 'medium' | 'high'
  confidence: number
  explanation: string
  dismissed: boolean
  hasUserOverride: boolean
  estimatedImpact: MetricValue
  evidence: EvidenceRef[]
}

export interface CorrectionDiagnostic {
  id: string
  category: CorrectionView['category']
  candidates: number
  countedCorrections: number
  userOverrides: number
  evidence: EvidenceRef[]
}

export interface ToolFailureDiagnostic {
  id: string
  toolName: string
  recordedEvents: number
  failures: number
  affectedSessions: number
  averageFailureDurationMs: number | null
  evidence: EvidenceRef[]
}

export interface DiagnosticsResponse {
  signalCount: number
  correctionCandidates: number
  countedCorrections: number
  correctionCategories: CorrectionDiagnostic[]
  failedToolEvents: number
  toolFailures: ToolFailureDiagnostic[]
  tokenCoverage: {
    usageRecords: number
    sessionsWithUsage: number
    totalSessions: number
    coverageRatio: number
    inputTokens: number | null
    cachedInputTokens: number | null
    outputTokens: number | null
    limitation: string
  }
  skillCoverage: {
    status: 'unavailable'
    reason: string
  }
  signals: PatternSignal[]
}

export interface SignalOverrideInput {
  dismissed: boolean
}

export interface SessionDetailResponse {
  session: SessionSummary
  timeline: PageResult<TimelineEvent>
  corrections: CorrectionView[]
  signals: PatternSignal[]
}

export interface SourceEvidenceResponse {
  sourceRecordId: string
  sourcePointer: string
  sourceSchemaVersion: string | null
  importedAt: string
  redactedPayload: unknown
}
