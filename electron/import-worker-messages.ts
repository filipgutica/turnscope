import type { ImportProgress, ImportResult, ImportWarning } from '../shared/contracts.js'

export interface ImportWorkerStartMessage {
  type: 'start'
  databasePath: string
  sourceRoot: string
}

export type ImportWorkerMessage =
  | { type: 'progress'; progress: ImportProgress }
  | {
    type: 'completed'
    completedAt: string
    result: Omit<ImportResult, 'warnings'> & {
      warningCount: number
      warnings: ImportWarning[]
    }
  }
  | { type: 'failed'; completedAt: string; error: string }

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const isImportWorkerStartMessage = (value: unknown): value is ImportWorkerStartMessage =>
  isObject(value)
  && value.type === 'start'
  && typeof value.databasePath === 'string'
  && typeof value.sourceRoot === 'string'

export const isImportWorkerMessage = (value: unknown): value is ImportWorkerMessage =>
  isObject(value)
  && (
    (value.type === 'progress' && isObject(value.progress))
    || (value.type === 'completed' && isObject(value.result) && typeof value.completedAt === 'string')
    || (value.type === 'failed' && typeof value.completedAt === 'string' && typeof value.error === 'string')
  )
