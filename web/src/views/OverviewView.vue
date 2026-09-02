<template>
  <section class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Local agent observability</p>
        <h1>Overview</h1>
        <p>Health and activity across all imported projects.</p>
      </div>
      <button type="button" class="secondary-button" :disabled="loading" @click="loadOverview">
        Refresh
      </button>
    </header>

    <ImportStatusPanel
      v-if="importStatus"
      :status="importStatus"
      @start="startImport"
      @cancel="cancelImport"
    />

    <p v-if="loading" class="status-message">Loading overview…</p>
    <div v-else-if="error" class="error-message" role="alert">
      <p>{{ error }}</p>
      <button type="button" @click="loadOverview">Retry</button>
    </div>
    <template v-else-if="overview">
      <div class="metric-grid metric-grid--summary">
        <MetricCard label="Projects" :metric="overview.projects" />
        <MetricCard label="Sessions" :metric="overview.sessions" />
        <MetricCard label="Corrections" :metric="overview.corrections" />
        <MetricCard label="Errors" :metric="overview.errors" />
      </div>

      <details class="panel metric-details">
        <summary>Usage and quality details</summary>
        <div class="metric-grid metric-grid--details">
          <MetricCard label="Input tokens" :metric="overview.inputTokens" />
          <MetricCard label="Cached input" :metric="overview.cachedInputTokens" />
          <MetricCard label="Output tokens" :metric="overview.outputTokens" />
          <MetricCard label="Cache ratio" :metric="overview.cacheRatio" />
          <MetricCard label="Duration" :metric="overview.duration" />
          <MetricCard label="Correction rate" :metric="overview.correctionRate" />
        </div>
      </details>

      <section class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Imported data</p>
            <h2>Projects</h2>
          </div>
          <span>{{ overview.projectRows.length }} total</span>
        </div>

        <p v-if="overview.projectRows.length === 0" class="empty-state">
          No projects have been imported yet. Run the Codex import command, then refresh.
        </p>
        <VirtualDataTable
          v-else
          :rows="filteredProjects"
          :columns="projectColumns"
          :total="filteredProjects.length"
          label="Projects"
        >
          <template #toolbar>
            <label class="search-control">
              <span>Search projects</span>
              <input v-model="projectSearch" type="search" placeholder="Name or repository" aria-label="Search projects" />
            </label>
          </template>
        </VirtualDataTable>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, h, inject, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import type { ImportJobStatus, OverviewResponse, ProjectSummary } from '@shared/contracts'

import { apiKey } from '../api'
import ImportStatusPanel from '../components/ImportStatusPanel.vue'
import MetricCard from '../components/MetricCard.vue'
import VirtualDataTable from '../components/VirtualDataTable.vue'
import { formatDate } from '../format'
import type { DataTableColumn } from '../table'

const api = inject(apiKey)
if (!api) {
  throw new Error('Turnscope API client was not provided')
}

const overview = ref<OverviewResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const importStatus = ref<ImportJobStatus | null>(null)
const projectSearch = ref('')
const importApi = api.getImportStatus && api.startImport && api.cancelImport
  ? { getStatus: api.getImportStatus, start: api.startImport, cancel: api.cancelImport }
  : null
let importPollTimer: ReturnType<typeof setTimeout> | undefined

const filteredProjects = computed(() => {
  const query = projectSearch.value.trim().toLocaleLowerCase()
  if (!overview.value || !query) return overview.value?.projectRows ?? []
  return overview.value.projectRows.filter((project) =>
    project.name.toLocaleLowerCase().includes(query)
    || project.repository?.toLocaleLowerCase().includes(query))
})
const projectColumns: DataTableColumn<ProjectSummary>[] = [
  {
    accessorKey: 'name',
    header: 'Project',
    cell: ({ row }) => h('div', [
      h(RouterLink, { to: { name: 'project', params: { id: row.original.id } } }, () => row.original.name),
      h('small', row.original.repository ?? 'Repository not reported'),
    ]),
  },
  { accessorKey: 'lastActiveAt', header: 'Last active', cell: ({ row }) => formatDate(row.original.lastActiveAt) },
  { accessorKey: 'sessionCount', header: 'Sessions' },
  { accessorKey: 'eventCount', header: 'Events' },
  { accessorKey: 'corrections', header: 'Corrections' },
  { accessorKey: 'errors', header: 'Errors' },
]

const loadOverview = async (): Promise<void> => {
  loading.value = true
  error.value = null

  try {
    overview.value = await api.getOverview()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load overview'
  } finally {
    loading.value = false
  }
}

const scheduleImportPoll = (): void => {
  if (importStatus.value?.state !== 'running') return
  importPollTimer = setTimeout(refreshImportStatus, 500)
}

const refreshImportStatus = async (): Promise<void> => {
  if (!importApi) return
  const previousState = importStatus.value?.state
  try {
    importStatus.value = await importApi.getStatus()
    if (previousState === 'running' && importStatus.value.state !== 'running') {
      await loadOverview()
    }
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
  await loadOverview()
}

onMounted(() => {
  void loadOverview()
  void refreshImportStatus()
})
onUnmounted(() => {
  if (importPollTimer) clearTimeout(importPollTimer)
})
</script>
