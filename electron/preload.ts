import { contextBridge, ipcRenderer } from 'electron'

import type { TurnscopeDesktopApi } from '../shared/api.js'
import { turnscopeIpcChannels } from '../shared/ipc.js'

const api: TurnscopeDesktopApi = {
  getDiagnostics: () => ipcRenderer.invoke(turnscopeIpcChannels.getDiagnostics),
  getOverview: () => ipcRenderer.invoke(turnscopeIpcChannels.getOverview),
  getProject: (projectId, query) =>
    ipcRenderer.invoke(turnscopeIpcChannels.getProject, projectId, query),
  getPatterns: () => ipcRenderer.invoke(turnscopeIpcChannels.getPatterns),
  getSession: (sessionId, query) =>
    ipcRenderer.invoke(turnscopeIpcChannels.getSession, sessionId, query),
  getEvidence: (sourceRecordId) =>
    ipcRenderer.invoke(turnscopeIpcChannels.getEvidence, sourceRecordId),
  getImportStatus: () => ipcRenderer.invoke(turnscopeIpcChannels.getImportStatus),
  startImport: () => ipcRenderer.invoke(turnscopeIpcChannels.startImport),
  cancelImport: () => ipcRenderer.invoke(turnscopeIpcChannels.cancelImport),
  updateCorrection: async (correctionId, override) => {
    await ipcRenderer.invoke(turnscopeIpcChannels.updateCorrection, correctionId, override)
  },
  createCorrection: async (eventId, override) => {
    await ipcRenderer.invoke(turnscopeIpcChannels.createCorrection, eventId, override)
  },
  updateSignal: async (signalId, override) => {
    await ipcRenderer.invoke(turnscopeIpcChannels.updateSignal, signalId, override)
  },
}

contextBridge.exposeInMainWorld('turnscope', api)
