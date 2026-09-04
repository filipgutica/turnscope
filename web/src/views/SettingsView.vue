<template>
  <section class="page-stack settings-page">
    <header class="page-heading">
      <div>
        <h1>Settings</h1>
      </div>
    </header>

    <ThemePicker />

    <section class="settings-group" aria-labelledby="data-sources-heading">
      <div>
        <p class="eyebrow">Data sources</p>
        <h2 id="data-sources-heading">Agent session imports</h2>
        <p>Each agent integration owns its discovery and compatibility rules.</p>
      </div>

      <ImportStatusPanel
        v-if="importStatus"
        :status="importStatus"
        @start="startImport"
        @cancel="cancelImport"
      />
      <UiSurface v-else as="article" class="panel source-card" padding="default">
        <div>
          <h3>Codex</h3>
          <p>Codex session import is available in the desktop app.</p>
        </div>
        <UiBadge>Unavailable</UiBadge>
      </UiSurface>

      <UiSurface as="article" class="panel source-card" padding="default">
        <div>
          <h3>Claude Code</h3>
          <p>The settings boundary is ready for a future Claude Code adapter; importing is not implemented yet.</p>
        </div>
        <UiBadge tone="info">Planned</UiBadge>
      </UiSurface>
    </section>

    <section id="data-health" class="settings-group" aria-labelledby="data-health-settings-heading">
      <div>
        <h2 id="data-health-settings-heading">Data health and diagnostics</h2>
        <p v-if="dataHealth">
          {{ formatNumber(dataHealth.importedSessions) }} imported sessions ·
          status known for {{ formatCoverageCount(dataHealth.toolStatusCoverage) }} invocations ·
          {{ formatNumber(dataHealth.activeWarnings.length) }} active warnings
        </p>
        <p v-else-if="dataHealthError">Data health is unavailable: {{ dataHealthError }}</p>
        <p v-else>Loading imported data coverage…</p>
      </div>

      <details class="settings-diagnostics">
        <summary>View coverage and advanced diagnostics</summary>
        <DataHealthPanel v-if="dataHealth" :data-health="dataHealth" range-label="All time" />
        <RouterLink class="diagnostics-link" :to="{ name: 'patterns' }">
          Open pattern diagnostics
        </RouterLink>
      </details>
    </section>
  </section>
</template>

<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { UiBadge, UiSurface } from '@filipgutica/ui'

import type { DataHealthSummary, ImportJobStatus } from '@shared/contracts'

import { formatCoverageCount } from '../analytics-range'
import { apiKey } from '../api'
import DataHealthPanel from '../components/DataHealthPanel.vue'
import ImportStatusPanel from '../components/ImportStatusPanel.vue'
import ThemePicker from '../components/ThemePicker.vue'

const api = inject(apiKey)
if (!api) throw new Error('Turnscope settings API was not provided')

const importStatus = ref<ImportJobStatus | null>(null)
const dataHealth = ref<DataHealthSummary | null>(null)
const dataHealthError = ref<string | null>(null)
const importApi = api.getImportStatus && api.startImport && api.cancelImport
  ? { getStatus: api.getImportStatus, start: api.startImport, cancel: api.cancelImport }
  : null
let importPollTimer: ReturnType<typeof setTimeout> | undefined

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)

const loadDataHealth = async (): Promise<void> => {
  dataHealthError.value = null
  try {
    dataHealth.value = (await api.getOverview({ range: 'all' })).dataHealth
  } catch (cause) {
    dataHealthError.value = cause instanceof Error ? cause.message : 'Unable to load coverage'
  }
}

const scheduleImportPoll = (): void => {
  if (importStatus.value?.state !== 'running') return
  importPollTimer = setTimeout(refreshImportStatus, 500)
}

const refreshImportStatus = async (): Promise<void> => {
  if (!importApi) return
  try {
    importStatus.value = await importApi.getStatus()
  } catch (cause) {
    if (importStatus.value) {
      importStatus.value = {
        ...importStatus.value,
        state: 'failed',
        phase: null,
        completedAt: new Date().toISOString(),
        error: cause instanceof Error ? cause.message : 'Unable to read import status',
      }
    }
  } finally {
    scheduleImportPoll()
  }
}

const startImport = async (): Promise<void> => {
  if (!importApi) return
  if (importPollTimer) clearTimeout(importPollTimer)
  try {
    importStatus.value = await importApi.start()
  } catch (cause) {
    if (importStatus.value) {
      importStatus.value = {
        ...importStatus.value,
        state: 'failed',
        phase: null,
        completedAt: new Date().toISOString(),
        error: cause instanceof Error ? cause.message : 'Unable to start import',
      }
    }
  }
  scheduleImportPoll()
}

const cancelImport = async (): Promise<void> => {
  if (!importApi) return
  if (importPollTimer) clearTimeout(importPollTimer)
  importStatus.value = await importApi.cancel()
}

onMounted(() => {
  void refreshImportStatus()
  void loadDataHealth()
})
onUnmounted(() => {
  if (importPollTimer) clearTimeout(importPollTimer)
})
</script>
