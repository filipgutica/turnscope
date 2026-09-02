import type { ImportWarning, ProductInstallationSummary } from '../../shared/contracts.js'

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
}

export interface ParsedSourceFile {
  threadId: string
  sessionId: string
  productVersion: string | null
  repository: string | null
  model: string | null
  reasoningEffort: string | null
  usageCompatible: boolean
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
