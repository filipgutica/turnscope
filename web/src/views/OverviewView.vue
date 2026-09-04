<template>
  <section class="page-stack">
    <header class="page-heading">
      <div>
        <h1>Overview</h1>
        <p>Recent agent activity, reported issues, and the coverage behind each result.</p>
      </div>
      <div class="page-actions">
        <TimeRangeControl :model-value="range" @update:model-value="setRange" />
        <UiButton variant="secondary" :loading="loading" @click="loadOverview">Refresh</UiButton>
      </div>
    </header>

    <p v-if="loading && !overview" class="status-message">Loading overview…</p>
    <UiAlert v-else-if="error && !overview" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton @click="loadOverview">Retry</UiButton>
    </UiAlert>
    <template v-else-if="overview">
      <UiAlert v-if="error" class="error-message" tone="danger">{{ error }}</UiAlert>

      <UiSurface class="panel activity-summary" padding="none" aria-labelledby="activity-heading">
        <div class="section-heading">
          <div>
            <h2 id="activity-heading">Recent activity</h2>
            <p>Counts and supporting coverage for the selected period.</p>
          </div>
          <span class="range-context">{{ overview.range.label }}</span>
        </div>
        <div class="activity-summary__content">
          <div class="priority-metrics">
            <MetricCard label="Recent sessions" :metric="overview.recentSessions" />
            <MetricCard label="Sessions needing attention" :metric="overview.sessionsNeedingAttention" />
          </div>
          <dl class="definition-grid coverage-summary">
            <div>
              <dt>Tool-reliability coverage</dt>
              <dd>
                <strong>{{ formatCoverageRatio(overview.toolReliabilityCoverage) }}</strong>
                <span>{{ formatCoverageCount(overview.toolReliabilityCoverage) }}</span>
                <small>{{ overview.toolReliabilityCoverage.limitation }}</small>
              </dd>
            </div>
            <div>
              <dt>Outcome coverage</dt>
              <dd>
                <strong>{{ formatCoverageRatio(overview.outcomeCoverage) }}</strong>
                <span>{{ formatCoverageCount(overview.outcomeCoverage) }}</span>
                <small>{{ overview.outcomeCoverage.limitation }}</small>
              </dd>
            </div>
          </dl>
        </div>
      </UiSurface>

      <UiSurface class="panel session-span" padding="none" aria-labelledby="session-span-heading">
        <div class="section-heading">
          <div>
            <h2 id="session-span-heading">Session span</h2>
            <p>{{ overview.sessionSpan.definition }}</p>
          </div>
          <span class="range-context">{{ overview.range.label }}</span>
        </div>
        <dl class="definition-grid session-span__values">
          <div><dt>Median span</dt><dd>{{ formatMilliseconds(overview.sessionSpan.medianMs) }}</dd></div>
          <div><dt>P90 span</dt><dd>{{ formatMilliseconds(overview.sessionSpan.p90Ms) }}</dd></div>
          <div>
            <dt>Timestamp coverage</dt>
            <dd>
              <strong>{{ formatCoverageRatio(overview.sessionSpan.coverage) }}</strong>
              <span>{{ formatCoverageCount(overview.sessionSpan.coverage) }}</span>
              <small>{{ overview.sessionSpan.coverage.limitation }}</small>
            </dd>
          </div>
        </dl>
      </UiSurface>

      <UiSurface class="panel" padding="none" aria-labelledby="findings-heading">
        <div class="section-heading">
          <div>
            <h2 id="findings-heading">Evidence-backed findings</h2>
            <p>Observed tool results that may need review; these are not automatic quality judgments.</p>
          </div>
          <span class="range-context">{{ overview.range.label }}</span>
        </div>
        <p v-if="overview.findingsLimitation" class="empty-state panel-empty">
          {{ overview.findingsLimitation }}
        </p>
        <ul v-else class="finding-list">
          <li v-for="finding in overview.findings" :key="finding.id">
            <div class="finding-list__heading">
              <strong>{{ finding.title }}</strong>
              <span>{{ finding.measurementClass }}</span>
            </div>
            <p>{{ finding.reason }}</p>
            <RouterLink
              v-for="evidence in finding.evidence"
              :key="evidence.eventId"
              :to="evidenceTarget(evidence)"
            >
              {{ evidence.label }}
            </RouterLink>
          </li>
        </ul>
      </UiSurface>

      <UiSurface class="panel" padding="none" aria-labelledby="recent-sessions-heading">
        <div class="section-heading">
          <div>
            <h2 id="recent-sessions-heading">Recent sessions</h2>
            <p>Sessions with the most recent imported activity in this period.</p>
          </div>
          <span class="range-context">{{ overview.range.label }}</span>
        </div>
        <p v-if="overview.recentSessionRows.length === 0" class="empty-state panel-empty">
          No sessions fall within this time range.
        </p>
        <VirtualDataTable
          v-else
          :rows="overview.recentSessionRows"
          :columns="sessionColumns"
          :total="overview.recentSessionRows.length"
          label="Recent sessions"
        />
      </UiSurface>

      <DataHealthPanel :data-health="overview.dataHealth" :range-label="overview.range.label" />

      <UiSurface class="panel" padding="none" aria-labelledby="projects-heading">
        <div class="section-heading">
          <div>
            <h2 id="projects-heading">Projects</h2>
            <p>Imported activity grouped by repository.</p>
          </div>
          <span class="range-context">{{ overview.range.label }}</span>
        </div>

        <p v-if="overview.projectRows.length === 0" class="empty-state panel-empty">
          No projects fall within this time range.
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
import { computed, h, inject, ref, watch } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import { UiAlert, UiButton, UiField, UiInput, UiSurface } from '@filipgutica/ui'

import type { EvidenceRef, OverviewResponse, ProjectSummary, RecentSessionSummary } from '@shared/contracts'

import {
  formatCoverageCount,
  formatCoverageRatio,
  formatMilliseconds,
  useAnalyticsRange,
} from '../analytics-range'
import { apiKey } from '../api'
import DataHealthPanel from '../components/DataHealthPanel.vue'
import MetricCard from '../components/MetricCard.vue'
import TimeRangeControl from '../components/TimeRangeControl.vue'
import VirtualDataTable from '../components/VirtualDataTable.vue'
import { formatDate } from '../format'
import type { DataTableColumn } from '../table'

const api = inject(apiKey)
if (!api) throw new Error('Turnscope API client was not provided')

const { range, setRange } = useAnalyticsRange()
const overview = ref<OverviewResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const projectSearch = ref('')
let requestId = 0

const evidenceTarget = (evidence: EvidenceRef): RouteLocationRaw => ({
  name: 'session',
  params: { id: evidence.sessionId },
  query: { event: evidence.eventId },
  hash: `#event-${evidence.eventId}`,
})
const evidenceLinks = (evidence: EvidenceRef[]) => h('div', { class: 'table-evidence' }, evidence.map((item) =>
  h(RouterLink, { to: evidenceTarget(item) }, () => item.label)))

const filteredProjects = computed(() => {
  const query = projectSearch.value.trim().toLocaleLowerCase()
  if (!overview.value || !query) return overview.value?.projectRows ?? []
  return overview.value.projectRows.filter((project) =>
    project.name.toLocaleLowerCase().includes(query)
    || project.repository?.toLocaleLowerCase().includes(query))
})

const sessionColumns: DataTableColumn<RecentSessionSummary>[] = [
  {
    accessorKey: 'title',
    header: 'Session',
    cell: ({ row }) => h('div', [
      h(RouterLink, { to: { name: 'session', params: { id: row.original.id } } }, () => row.original.title),
      h('small', row.original.repository ?? 'Repository not reported'),
    ]),
  },
  { accessorKey: 'endedAt', header: 'Last activity', cell: ({ row }) => formatDate(row.original.endedAt ?? row.original.startedAt) },
  {
    accessorKey: 'attentionStatus',
    header: 'Attention',
    cell: ({ row }) => h('div', [
      h('strong', row.original.attentionStatus === 'needs_attention'
        ? 'Needs attention'
        : row.original.attentionStatus === 'coverage_limited' ? 'Coverage limited' : 'No reported issue'),
      h('small', row.original.attentionReason),
    ]),
  },
  { id: 'evidence', header: 'Evidence', cell: ({ row }) => row.original.evidence.length > 0
    ? evidenceLinks(row.original.evidence)
    : row.original.attentionStatus === 'coverage_limited' ? 'Unavailable' : 'None reported' },
]

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
]

const loadOverview = async (): Promise<void> => {
  const currentRequest = ++requestId
  loading.value = true
  error.value = null

  try {
    const response = await api.getOverview({ range: range.value })
    if (currentRequest === requestId) overview.value = response
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load overview'
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

watch(range, loadOverview, { immediate: true })
</script>
