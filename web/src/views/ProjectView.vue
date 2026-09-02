<template>
  <section class="page-stack">
    <RouterLink class="back-link" :to="{ name: 'overview' }">← Back to overview</RouterLink>

    <p v-if="loading" class="status-message">Loading project…</p>
    <div v-else-if="error" class="error-message" role="alert">
      <p>{{ error }}</p>
      <button type="button" @click="loadProject">Retry</button>
    </div>
    <template v-else-if="detail">
      <header class="page-heading">
        <div>
          <p class="eyebrow">Project</p>
          <h1>{{ detail.project.name }}</h1>
          <p class="path-text">{{ detail.project.repository ?? 'Repository not reported' }}</p>
        </div>
        <button type="button" class="secondary-button" :disabled="loading" @click="loadProject">
          Refresh
        </button>
      </header>

      <div class="project-stat-grid" aria-label="Project summary">
        <article>
          <span>Sessions</span>
          <strong>{{ detail.project.sessionCount }}</strong>
        </article>
        <article>
          <span>Events</span>
          <strong>{{ detail.project.eventCount }}</strong>
        </article>
        <article>
          <span>Corrections</span>
          <strong>{{ detail.project.corrections }}</strong>
        </article>
        <article>
          <span>Errors</span>
          <strong>{{ detail.project.errors }}</strong>
        </article>
      </div>

      <section class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Project activity</p>
            <h2>Sessions</h2>
          </div>
          <span>{{ detail.sessions.total }} matching</span>
        </div>

        <p v-if="detail.sessions.rows.length === 0" class="empty-state">
          No sessions are associated with this project.
        </p>
        <VirtualDataTable
          v-else
          :rows="detail.sessions.rows"
          :columns="sessionColumns"
          :total="detail.sessions.total"
          :loading="loadingMore"
          label="Project sessions"
          @load-more="loadMore"
        >
          <template #toolbar>
            <label class="search-control">
              <span>Search sessions</span>
              <input v-model="search" type="search" placeholder="Title or model" aria-label="Search sessions" />
            </label>
            <label class="filter-control">
              <span>Show</span>
              <select v-model="issue" aria-label="Session issue filter">
                <option value="">All sessions</option>
                <option value="corrections">With corrections</option>
                <option value="errors">With errors</option>
              </select>
            </label>
          </template>
        </VirtualDataTable>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, h, inject, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { ProjectDetailResponse, ProjectSessionsQuery, SessionSummary } from '@shared/contracts'

import { apiKey } from '../api'
import VirtualDataTable from '../components/VirtualDataTable.vue'
import { formatDate } from '../format'
import type { DataTableColumn } from '../table'

const api = inject(apiKey)
if (!api) {
  throw new Error('Turnscope API client was not provided')
}

const route = useRoute()
const detail = ref<ProjectDetailResponse | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const issue = ref<ProjectSessionsQuery['issue'] | ''>('')
const projectId = computed(() => String(route.params.id))
let requestId = 0

const sessionColumns: DataTableColumn<SessionSummary>[] = [
  {
    accessorKey: 'title',
    header: 'Session',
    cell: ({ row }) => h(RouterLink, {
      to: {
        name: 'session',
        params: { id: row.original.id },
        query: { project: detail.value?.project.id },
      },
    }, () => row.original.title),
  },
  { accessorKey: 'startedAt', header: 'Started', cell: ({ row }) => formatDate(row.original.startedAt) },
  { accessorKey: 'model', header: 'Model', cell: ({ row }) => row.original.model ?? 'Not reported' },
  { accessorKey: 'eventCount', header: 'Events' },
  { accessorKey: 'corrections', header: 'Corrections' },
  { accessorKey: 'errors', header: 'Errors' },
]

const loadProject = async (): Promise<void> => {
  const currentRequest = ++requestId
  loading.value = true
  error.value = null
  try {
    const response = await api.getProject(projectId.value, {
      limit: 100,
      search: search.value,
      ...(issue.value ? { issue: issue.value } : {}),
    })
    if (currentRequest === requestId) detail.value = response
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load project'
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

const loadMore = async (): Promise<void> => {
  if (!detail.value || loadingMore.value || detail.value.sessions.rows.length >= detail.value.sessions.total) return
  loadingMore.value = true
  try {
    const response = await api.getProject(projectId.value, {
      offset: detail.value.sessions.rows.length,
      limit: 100,
      search: search.value,
      ...(issue.value ? { issue: issue.value } : {}),
    })
    detail.value = {
      project: response.project,
      sessions: {
        ...response.sessions,
        offset: 0,
        rows: [...detail.value.sessions.rows, ...response.sessions.rows],
      },
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load more sessions'
  } finally {
    loadingMore.value = false
  }
}

watch([projectId, issue], loadProject, { immediate: true })
watch(search, (_value, _previous, onCleanup) => {
  const timer = window.setTimeout(() => void loadProject(), 200)
  onCleanup(() => window.clearTimeout(timer))
})
</script>
