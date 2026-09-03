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
import type {
  NormalizedTheme,
  OpenVsxThemeSearchResult,
  ThemeImportResult,
  ThemeRemovalResult,
} from './theme.js'

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

export interface TurnscopeThemeApi {
  getImportedTheme: () => Promise<NormalizedTheme | null>
  importVsCodeTheme: () => Promise<ThemeImportResult>
  searchOpenVsxThemes: (query: string) => Promise<OpenVsxThemeSearchResult>
  importOpenVsxTheme: (
    extensionId: string,
    preferredAppearance: 'light' | 'dark',
  ) => Promise<ThemeImportResult>
  removeImportedTheme: () => Promise<ThemeRemovalResult>
}

export type TurnscopeDesktopApi = TurnscopeApi & TurnscopeImportApi & TurnscopeThemeApi
