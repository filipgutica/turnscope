import type {
  ImportWarning,
  NormalizedToolStatus,
  ProductInstallationSummary,
  ToolCategory,
} from '../../shared/contracts.js'

export interface SourceFile {
  absolutePath: string
  relativePath: string
  sizeBytes: number
  modifiedAtMs: number
}

export interface SourceRecord {
  sourceOrder: number
  sourcePointer: string
  schemaVersion: string | null
  timestamp: string | null
  type: string
  payload: Record<string, unknown>
  raw: unknown
  normalized: NormalizedSourceEvent
}

export type NormalizedToolPhase = 'request' | 'intermediate' | 'result' | 'completed'

export interface NormalizedToolEvent {
  sourceInvocationId: string
  phase: NormalizedToolPhase
  category: ToolCategory
  rawName: string | null
  signature: string | null
  status: NormalizedToolStatus | null
  rawStatus: string | null
  durationMs: number | null
}

export interface NormalizedSourceEvent {
  kind: string
  actor: 'user' | 'agent' | 'tool' | 'system' | null
  summary: string
  correctionText: string | null
  tool: NormalizedToolEvent | null
  usage: {
    inputTokens: number | null
    cachedInputTokens: number | null
    outputTokens: number | null
    reasoningOutputTokens: number | null
    nominalCost: number | null
    billedCost: number | null
  } | null
}

export interface ParsedSourceFile {
  threadId: string
  sessionId: string
  title: string | null
  productVersion: string | null
  repository: string | null
  model: string | null
  reasoningEffort: string | null
  records: SourceRecord[]
  warnings: ImportWarning[]
}

export interface SourceAdapter {
  readonly adapterVersion: string
  readonly installationId: string
  readonly product: string
  readonly sourceRoot: string
  discover(): Promise<ProductInstallationSummary>
  enumerateFiles(): Promise<SourceFile[]>
  readSourceFile(file: SourceFile): Promise<{ contentHash: string; parsed: ParsedSourceFile }>
}
