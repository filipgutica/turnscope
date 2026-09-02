import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, shell } from 'electron'

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

let database: TurnscopeDatabase | undefined
let importManager: ImportManager | undefined

const requireString = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('Expected a string identifier')
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

const registerIpcHandlers = (api: TurnscopeApi, manager: ImportManager): void => {
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
    backgroundColor: '#f4f1ea',
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
  registerIpcHandlers(createLocalApi({ database }), importManager)
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
