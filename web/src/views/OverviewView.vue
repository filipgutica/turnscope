<template>
  <section class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Local agent observability</p>
        <h1>Overview</h1>
        <p>Health and activity across all imported projects.</p>
      </div>
      <UiButton variant="secondary" :loading="loading" @click="loadOverview">
        Refresh
      </UiButton>
    </header>

    <p v-if="loading" class="status-message">Loading overview…</p>
    <UiAlert v-else-if="error" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton @click="loadOverview">Retry</UiButton>
    </UiAlert>
    <template v-else-if="overview">
      <div class="metric-grid metric-grid--summary">
        <MetricCard label="Projects" :metric="overview.projects" />
        <MetricCard label="Sessions" :metric="overview.sessions" />
        <MetricCard label="Corrections" :metric="overview.corrections" />
        <MetricCard label="Errors" :metric="overview.errors" />
      </div>

      <UiSurface as="details" class="panel metric-details" padding="none">
        <summary>Usage and quality details</summary>
        <div class="metric-grid metric-grid--details">
          <MetricCard label="Input tokens" :metric="overview.inputTokens" />
          <MetricCard label="Cached input" :metric="overview.cachedInputTokens" />
          <MetricCard label="Output tokens" :metric="overview.outputTokens" />
          <MetricCard label="Cache ratio" :metric="overview.cacheRatio" />
          <MetricCard label="Duration" :metric="overview.duration" />
          <MetricCard label="Correction rate" :metric="overview.correctionRate" />
        </div>
      </UiSurface>

      <UiSurface class="panel" padding="none">
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
            <UiField control-id="project-search" class="search-control" label="Search projects">
              <UiInput id="project-search" v-model="projectSearch" type="search" placeholder="Name or repository" />
            </UiField>
          </template>
        </VirtualDataTable>
      </UiSurface>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, h, inject, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { UiAlert, UiButton, UiField, UiInput, UiSurface } from '@filipgutica/ui'

import type { OverviewResponse, ProjectSummary } from '@shared/contracts'

import { apiKey } from '../api'
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
const projectSearch = ref('')

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

onMounted(loadOverview)
</script>
