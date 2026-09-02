import type {
  CorrectionOverrideInput,
  DiagnosticsResponse,
  ImportJobStatus,
  OverviewResponse,
  PatternSignal,
  ProjectDetailResponse,
  ProjectSessionsQuery,
  SessionDetailResponse,
  SessionTimelineQuery,
  SignalOverrideInput,
  SourceEvidenceResponse,
} from './contracts.js'

export interface TurnscopeApi {
  getOverview: () => Promise<OverviewResponse>
  getProject: (projectId: string, query?: ProjectSessionsQuery) => Promise<ProjectDetailResponse>
  getSession: (sessionId: string, query?: SessionTimelineQuery) => Promise<SessionDetailResponse>
  getPatterns: () => Promise<PatternSignal[]>
  getDiagnostics: () => Promise<DiagnosticsResponse>
  getEvidence: (sourceRecordId: string) => Promise<SourceEvidenceResponse>
  updateCorrection: (correctionId: string, override: CorrectionOverrideInput) => Promise<void>
  createCorrection: (eventId: string, override: CorrectionOverrideInput) => Promise<void>
  updateSignal: (signalId: string, override: SignalOverrideInput) => Promise<void>
}

export interface TurnscopeImportApi {
  getImportStatus: () => Promise<ImportJobStatus>
  startImport: () => Promise<ImportJobStatus>
  cancelImport: () => Promise<ImportJobStatus>
}

export type TurnscopeDesktopApi = TurnscopeApi & TurnscopeImportApi
