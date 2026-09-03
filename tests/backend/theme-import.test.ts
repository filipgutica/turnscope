import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MAX_THEME_FILE_BYTES, createThemeImportService } from '../../electron/theme-import.js'

const validTheme = JSON.stringify({
  name: 'Fixture',
  type: 'dark',
  colors: {
    'editor.background': '#101010',
    'editor.foreground': '#F0F0F0',
  },
})

describe('theme import service', () => {
  it('returns cancellation without reading or persisting', async () => {
    let read = false
    const service = createThemeImportService({
      pickThemeFile: async () => null,
      readThemeFile: async () => {
        read = true
        return validTheme
      },
      storagePath: '/unused/theme.json',
    })

    await expect(service.importTheme()).resolves.toEqual({ status: 'cancelled' })
    expect(read).toBe(false)
  })

  it('returns a useful failure when the selected file cannot be read', async () => {
    const service = createThemeImportService({
      pickThemeFile: async () => '/themes/missing.json',
      readThemeFile: async () => {
        throw new Error('EACCES')
      },
      storagePath: '/unused/theme.json',
    })

    await expect(service.importTheme()).resolves.toEqual({
      status: 'error',
      error: {
        code: 'read-failed',
        message: 'Turnscope could not read the selected theme file.',
      },
    })
  })

  it('rejects unsupported extensions and files over the size limit', async () => {
    const unsupported = createThemeImportService({
      pickThemeFile: async () => '/themes/theme.txt',
      readThemeFile: async () => validTheme,
      storagePath: '/unused/theme.json',
    })
    const oversized = createThemeImportService({
      pickThemeFile: async () => '/themes/theme.jsonc',
      readThemeFile: async () => Buffer.alloc(MAX_THEME_FILE_BYTES + 1, 32),
      storagePath: '/unused/theme.json',
    })

    await expect(unsupported.importTheme()).resolves.toMatchObject({
      status: 'error', error: { code: 'unsupported-file-type' },
    })
    await expect(oversized.importTheme()).resolves.toMatchObject({
      status: 'error', error: { code: 'file-too-large' },
    })
  })

  it('bounds real file reads and rejects non-regular paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'turnscope-theme-input-'))
    const oversizedPath = join(directory, 'oversized.json')
    const directoryPath = join(directory, 'folder.json')
    await writeFile(oversizedPath, Buffer.alloc(MAX_THEME_FILE_BYTES + 1, 32))
    await mkdir(directoryPath)

    const oversized = createThemeImportService({
      pickThemeFile: async () => oversizedPath,
      storagePath: join(directory, 'stored.json'),
    })
    const nonRegular = createThemeImportService({
      pickThemeFile: async () => directoryPath,
      storagePath: join(directory, 'stored.json'),
    })

    await expect(oversized.importTheme()).resolves.toMatchObject({
      status: 'error', error: { code: 'file-too-large' },
    })
    await expect(nonRegular.importTheme()).resolves.toMatchObject({
      status: 'error', error: { code: 'read-failed' },
    })
  })

  it('persists only normalized theme data and restores it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'turnscope-theme-'))
    const storagePath = join(directory, 'imported-theme.json')
    const service = createThemeImportService({
      pickThemeFile: async () => '/themes/fixture.jsonc',
      readThemeFile: async () => `${validTheme.slice(0, -1)}, "semanticTokenColors": { "ignored": true } }`,
      storagePath,
    })

    const result = await service.importTheme()
    expect(result).toMatchObject({ status: 'success', theme: { name: 'Fixture' } })

    const stored = JSON.parse(await readFile(storagePath, 'utf8')) as Record<string, unknown>
    expect(stored).toEqual(result.status === 'success' ? result.theme : undefined)
    expect(stored).not.toHaveProperty('colors')
    expect(stored).not.toHaveProperty('semanticTokenColors')
    await expect(service.getImportedTheme()).resolves.toEqual(stored)
  })

  it('returns validation and persistence failures without replacing the stored theme', async () => {
    const malformed = createThemeImportService({
      pickThemeFile: async () => '/themes/broken.jsonc',
      readThemeFile: async () => '{ "colors": {',
      storagePath: '/unused/theme.json',
    })
    const unwritable = createThemeImportService({
      pickThemeFile: async () => '/themes/fixture.json',
      readThemeFile: async () => validTheme,
      storagePath: '/dev/null/imported-theme.json',
    })

    await expect(malformed.importTheme()).resolves.toMatchObject({
      status: 'error', error: { code: 'malformed-json' },
    })
    await expect(unwritable.importTheme()).resolves.toEqual({
      status: 'error',
      error: {
        code: 'persistence-failed',
        message: 'The theme was valid, but Turnscope could not save it.',
      },
    })
  })

  it('ignores invalid persisted data and removes a stored theme', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'turnscope-theme-'))
    const storagePath = join(directory, 'imported-theme.json')
    const service = createThemeImportService({
      pickThemeFile: async () => null,
      readThemeFile: async () => validTheme,
      storagePath,
    })

    await writeFile(storagePath, '{ "tokens": { "pageBackground": "red" } }')
    await expect(service.getImportedTheme()).resolves.toBeNull()

    await writeFile(storagePath, validTheme)
    await expect(service.removeImportedTheme()).resolves.toEqual({ status: 'success' })
    await expect(service.getImportedTheme()).resolves.toBeNull()
  })
})
