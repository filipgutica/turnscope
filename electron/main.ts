import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'

import type { TurnscopeApi } from '../shared/api.js'
import type {
  CorrectionOverrideInput,
  ProjectSessionsQuery,
  SessionTimelineQuery,
  SignalOverrideInput,
} from '../shared/contracts.js'
import { turnscopeIpcChannels } from '../shared/ipc.js'
import { closeDatabase, openDatabase, type TurnscopeDatabase } from '../src/db.js'
import { createLocalApi } from '../src/local-api.js'
import { defaultDatabasePath } from '../src/paths.js'
import { createImportManager, type ImportManager } from './import-manager.js'
import { createOpenVsxThemeService, type OpenVsxThemeService } from './open-vsx-theme.js'
import { createThemeImportService, type ThemeImportService } from './theme-import.js'

let database: TurnscopeDatabase | undefined
let importManager: ImportManager | undefined

const requireString = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('Expected a string identifier')
  return value
}

const requirePreferredAppearance = (value: unknown): 'light' | 'dark' => {
  if (value !== 'light' && value !== 'dark') throw new TypeError('Expected a theme appearance')
  return value
}

const isSafeExternalUrl = (targetUrl: string): boolean => {
  try {
    const { protocol } = new URL(targetUrl)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

const registerIpcHandlers = (
  api: TurnscopeApi,
  manager: ImportManager,
  themeService: ThemeImportService,
  openVsxThemeService: OpenVsxThemeService,
): void => {
  ipcMain.handle(turnscopeIpcChannels.getDiagnostics, () => api.getDiagnostics())
  ipcMain.handle(turnscopeIpcChannels.getOverview, () => api.getOverview())
  ipcMain.handle(turnscopeIpcChannels.getProject, (
    _event,
    projectId: unknown,
    query: ProjectSessionsQuery | undefined,
  ) => api.getProject(requireString(projectId), query))
  ipcMain.handle(turnscopeIpcChannels.getPatterns, () => api.getPatterns())
  ipcMain.handle(turnscopeIpcChannels.getSession, (
    _event,
    sessionId: unknown,
    query: SessionTimelineQuery | undefined,
  ) => api.getSession(requireString(sessionId), query))
  ipcMain.handle(turnscopeIpcChannels.getEvidence, (_event, sourceRecordId: unknown) =>
    api.getEvidence(requireString(sourceRecordId)))
  ipcMain.handle(turnscopeIpcChannels.getImportStatus, () => manager.getStatus())
  ipcMain.handle(turnscopeIpcChannels.startImport, () => manager.start())
  ipcMain.handle(turnscopeIpcChannels.cancelImport, () => manager.cancel())
  ipcMain.handle(turnscopeIpcChannels.getImportedTheme, () => themeService.getImportedTheme())
  ipcMain.handle(turnscopeIpcChannels.importVsCodeTheme, () => themeService.importTheme())
  ipcMain.handle(turnscopeIpcChannels.searchOpenVsxThemes, (_event, query: unknown) =>
    openVsxThemeService.search(requireString(query)))
  ipcMain.handle(
    turnscopeIpcChannels.importOpenVsxTheme,
    async (_event, extensionId: unknown, preferredAppearance: unknown) => {
      const result = await openVsxThemeService.importTheme(
        requireString(extensionId),
        requirePreferredAppearance(preferredAppearance),
      )
      return result.status === 'success' ? themeService.saveTheme(result.theme) : result
    },
  )
  ipcMain.handle(turnscopeIpcChannels.removeImportedTheme, () => themeService.removeImportedTheme())
  ipcMain.handle(
    turnscopeIpcChannels.updateCorrection,
    (_event, correctionId: unknown, override: CorrectionOverrideInput) =>
      api.updateCorrection(requireString(correctionId), override),
  )
  ipcMain.handle(
    turnscopeIpcChannels.createCorrection,
    (_event, eventId: unknown, override: CorrectionOverrideInput) =>
      api.createCorrection(requireString(eventId), override),
  )
  ipcMain.handle(
    turnscopeIpcChannels.updateSignal,
    (_event, signalId: unknown, override: SignalOverrideInput) =>
      api.updateSignal(requireString(signalId), override),
  )
}

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#eff1f5',
    show: false,
    title: 'Turnscope',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../../web-dist/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  database = openDatabase({ path: defaultDatabasePath() })
  importManager = createImportManager()
  const themeService = createThemeImportService({
    pickThemeFile: async () => {
      const options: OpenDialogOptions = {
        title: 'Import VS Code theme',
        buttonLabel: 'Import theme',
        properties: ['openFile'],
        filters: [{ name: 'VS Code color themes', extensions: ['json', 'jsonc'] }],
      }
      const parent = BrowserWindow.getFocusedWindow()
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    storagePath: join(app.getPath('userData'), 'imported-theme.json'),
  })
  registerIpcHandlers(
    createLocalApi({ database }),
    importManager,
    themeService,
    createOpenVsxThemeService(),
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  console.error(error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  importManager?.stop()
  importManager = undefined
  if (!database) return
  closeDatabase(database)
  database = undefined
})
