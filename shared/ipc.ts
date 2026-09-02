export const turnscopeIpcChannels = {
  getOverview: 'turnscope:get-overview',
  getProject: 'turnscope:get-project',
  getSession: 'turnscope:get-session',
  getPatterns: 'turnscope:get-patterns',
  getDiagnostics: 'turnscope:get-diagnostics',
  getEvidence: 'turnscope:get-evidence',
  getImportStatus: 'turnscope:get-import-status',
  startImport: 'turnscope:start-import',
  cancelImport: 'turnscope:cancel-import',
  updateCorrection: 'turnscope:update-correction',
  createCorrection: 'turnscope:create-correction',
  updateSignal: 'turnscope:update-signal',
} as const
