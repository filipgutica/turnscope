import { homedir } from 'node:os'
import { join } from 'node:path'

export const defaultSourceRoot = (): string => process.env.CODEX_HOME ?? join(homedir(), '.codex')

export const defaultDataDirectory = (): string => process.env.TURNSCOPE_DATA_DIR
  ?? (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'turnscope')
    : join(homedir(), '.local', 'share', 'turnscope'))

export const defaultDatabasePath = (): string => join(defaultDataDirectory(), 'turnscope.db')
