import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'

import type {
  NormalizedTheme,
  ThemeImportResult,
  ThemeRemovalResult,
} from '../shared/theme.js'
import {
  ThemeValidationError,
  isNormalizedTheme,
  parseVsCodeTheme,
} from '../shared/theme.js'

export const MAX_THEME_FILE_BYTES = 1024 * 1024

interface ThemeImportServiceDependencies {
  pickThemeFile: () => Promise<string | null>
  readThemeFile?: (path: string) => Promise<string | Uint8Array>
  storagePath: string
}

export interface ThemeImportService {
  getImportedTheme: () => Promise<NormalizedTheme | null>
  importTheme: () => Promise<ThemeImportResult>
  saveTheme: (theme: NormalizedTheme) => Promise<ThemeImportResult>
  removeImportedTheme: () => Promise<ThemeRemovalResult>
}

const isFileSystemError = (error: unknown, code: string): boolean =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === code

class ThemeFileTooLargeError extends Error {}

const readBoundedThemeFile = async (path: string): Promise<Uint8Array> => {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error('The selected path is not a regular file.')
    if (metadata.size > MAX_THEME_FILE_BYTES) throw new ThemeFileTooLargeError()

    const buffer = Buffer.alloc(MAX_THEME_FILE_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.byteLength) {
      const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    if (bytesRead > MAX_THEME_FILE_BYTES) throw new ThemeFileTooLargeError()
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const persistTheme = async (storagePath: string, theme: NormalizedTheme): Promise<void> => {
  await mkdir(dirname(storagePath), { recursive: true })
  const temporaryPath = `${storagePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(theme, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, storagePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

const readPersistedTheme = async (storagePath: string): Promise<NormalizedTheme | null> => {
  let source: string
  try {
    source = await readFile(storagePath, 'utf8')
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) return null
    throw error
  }

  try {
    const parsed: unknown = JSON.parse(source)
    return isNormalizedTheme(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const createThemeImportService = ({
  pickThemeFile,
  readThemeFile = readBoundedThemeFile,
  storagePath,
}: ThemeImportServiceDependencies): ThemeImportService => {
  const saveTheme = async (theme: NormalizedTheme): Promise<ThemeImportResult> => {
    if (!isNormalizedTheme(theme)) {
      return {
        status: 'error',
        error: { code: 'invalid-shape', message: 'The imported theme is not valid.' },
      }
    }
    try {
      await persistTheme(storagePath, theme)
      return { status: 'success', theme }
    } catch {
      return {
        status: 'error',
        error: {
          code: 'persistence-failed',
          message: 'The theme was valid, but Turnscope could not save it.',
        },
      }
    }
  }

  return {
  getImportedTheme: () => readPersistedTheme(storagePath),

  importTheme: async () => {
    const selectedPath = await pickThemeFile()
    if (!selectedPath) return { status: 'cancelled' }

    const extension = extname(selectedPath).toLowerCase()
    if (extension !== '.json' && extension !== '.jsonc') {
      return {
        status: 'error',
        error: {
          code: 'unsupported-file-type',
          message: 'Choose a VS Code color theme with a .json or .jsonc extension.',
        },
      }
    }

    let contents: string | Uint8Array
    try {
      contents = await readThemeFile(selectedPath)
    } catch (error) {
      return {
        status: 'error',
        error: {
          code: error instanceof ThemeFileTooLargeError ? 'file-too-large' : 'read-failed',
          message: error instanceof ThemeFileTooLargeError
            ? 'The selected theme is larger than the 1 MB import limit.'
            : 'Turnscope could not read the selected theme file.',
        },
      }
    }
    const contentsSize = typeof contents === 'string' ? Buffer.byteLength(contents) : contents.byteLength
    if (contentsSize > MAX_THEME_FILE_BYTES) {
      return {
        status: 'error',
        error: {
          code: 'file-too-large',
          message: 'The selected theme is larger than the 1 MB import limit.',
        },
      }
    }

    let theme: NormalizedTheme
    try {
      theme = parseVsCodeTheme({
        source: typeof contents === 'string' ? contents : Buffer.from(contents).toString('utf8'),
        fileName: basename(selectedPath),
      })
    } catch (error) {
      if (error instanceof ThemeValidationError) {
        return { status: 'error', error: { code: error.code, message: error.message } }
      }
      return {
        status: 'error',
        error: { code: 'invalid-shape', message: 'The selected file is not a supported VS Code color theme.' },
      }
    }

    return saveTheme(theme)
  },

  saveTheme,

  removeImportedTheme: async () => {
    try {
      await rm(storagePath, { force: true })
      return { status: 'success' }
    } catch {
      return {
        status: 'error',
        error: {
          code: 'persistence-failed',
          message: 'Turnscope could not remove the imported theme.',
        },
      }
    }
  },
  }
}
