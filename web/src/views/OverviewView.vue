<template>
  <section class="activity-page">
    <header class="activity-header">
      <h1>Activity</h1>
      <TimeRangeControl :model-value="range" :disabled="loading" @update:model-value="setRange" />
    </header>

    <p v-if="loading && !overview" class="status-message">Loading activity…</p>
    <UiAlert v-else-if="error && !overview" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton @click="loadActivity">Retry</UiButton>
    </UiAlert>

    <template v-else-if="overview && toolHealth">
      <UiAlert v-if="error" class="error-message" tone="danger">{{ error }}</UiAlert>

      <section
        v-if="hasActivity"
        class="activity-section activity-friction"
        aria-labelledby="observed-friction-heading"
      >
        <div class="activity-section__heading">
          <h2 id="observed-friction-heading">Observed friction</h2>
          <UiButton
            v-if="overview.findings.length > defaultFindingCount"
            variant="text"
            class="activity-section__action"
            @click="toggleFindings"
          >
            {{ showAllFindings ? 'Show less' : 'View all' }}
          </UiButton>
        </div>

        <p v-if="overview.findingsLimitation" class="activity-empty-line">
          {{ overview.findingsLimitation }}
        </p>
        <ul v-else class="friction-list">
          <li
            v-for="finding in visibleFindings"
            :key="finding.id"
            class="friction-row"
            :data-status="finding.status"
          >
            <span class="status-symbol" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="presentation">
                <circle cx="12" cy="12" r="9" />
                <path v-if="finding.status === 'failure'" d="M12 7v6m0 4h.01" />
                <path v-else-if="finding.status === 'rejected'" d="m8 8 8 8" />
                <path v-else d="M8 12h8" />
              </svg>
            </span>
            <div class="friction-row__identity">
              <strong>{{ statusLabel(finding.status) }}</strong>
              <span>{{ finding.toolLabel }}</span>
            </div>
            <div class="friction-row__session">
              <span>{{ finding.sessionTitle }}</span>
              <time>{{ formatActivityTime(finding.occurredAt) }}</time>
            </div>
            <p>{{ finding.reason }}</p>
            <RouterLink :to="evidenceTarget(finding.evidence[0]!)">
              Open event
            </RouterLink>
          </li>
        </ul>
      </section>

      <section
        v-if="hasActivity"
        class="activity-section activity-tools"
        aria-labelledby="tool-usage-heading"
      >
        <div class="activity-section__heading">
          <h2 id="tool-usage-heading">Tool usage</h2>
        </div>

        <p v-if="rankedCategories.length === 0" class="activity-empty-line">
          No classified tool activity falls within this time range.
        </p>
        <div v-else class="activity-tools__table-wrap">
          <table class="activity-tools__table">
            <thead>
              <tr>
                <th scope="col" :aria-sort="ariaSort('label')">
                  <button type="button" aria-label="Sort tools by name" @click="() => setSort('label')">Tool</button>
                </th>
                <th scope="col" :aria-sort="ariaSort('uniqueInvocations')">
                  <button type="button" @click="() => setSort('uniqueInvocations')">Invocations</button>
                </th>
                <th scope="col" :aria-sort="ariaSort('affectedSessions')">
                  <button type="button" @click="() => setSort('affectedSessions')">Sessions</button>
                </th>
                <th scope="col" :aria-sort="ariaSort('reportedIssues')">
                  <button type="button" @click="() => setSort('reportedIssues')">Reported issues</button>
                </th>
                <th scope="col" :aria-sort="ariaSort('successRate')">
                  <button type="button" @click="() => setSort('successRate')">Successful when known</button>
                </th>
                <th class="activity-tools__disclosure" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="category in sortedCategories"
                :key="category.id"
                class="activity-tool-row"
                :data-tool-category="category.category"
              >
                <th scope="row">
                  <RouterLink :to="toolTarget(category)">{{ category.label }}</RouterLink>
                  <small class="activity-tool-row__mobile-summary">
                    {{ formatNumber(category.uniqueInvocations) }} invocations ·
                    {{ formatNumber(category.affectedSessions) }} sessions
                  </small>
                </th>
                <td data-label="Invocations">{{ formatNumber(category.uniqueInvocations) }}</td>
                <td data-label="Sessions">{{ formatNumber(category.affectedSessions) }}</td>
                <td
                  data-label="Reported issues"
                  :data-known="category.statusCoverage.numerator > 0"
                >
                  <span v-if="category.statusCoverage.numerator > 0">{{ formatNumber(reportedIssues(category)) }}</span>
                  <span v-else class="unknown-value" aria-label="Not reported by source">—</span>
                </td>
                <td data-label="Successful when known">
                  <span v-if="category.successRate.denominator > 0">
                    {{ formatNumber(category.successRate.numerator) }} /
                    {{ formatNumber(category.successRate.denominator) }} ·
                    {{ formatCoverageRatio(category.successRate) }}
                  </span>
                  <span v-else class="unknown-value" aria-label="Not reported by source">
                    <span class="desktop-only">—</span>
                    <span class="mobile-only">Status unavailable</span>
                  </span>
                </td>
                <td class="activity-tools__disclosure">
                  <RouterLink :to="toolTarget(category)" :aria-label="`Open ${category.label} details`">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="coverage-disclosure">
          <p>{{ statusCoverageSummary }} <span class="coverage-secondary">{{ availabilitySummary }}</span></p>
          <details>
            <summary>Details</summary>
            <div class="coverage-disclosure__details">
              <p>{{ toolHealth.statusCoverage.limitation }}</p>
              <p v-if="unclassifiedCategory">
                {{ formatNumber(unclassifiedCategory.uniqueInvocations) }} invocations remain unclassified
                across {{ formatNumber(unclassifiedCategory.affectedSessions) }} sessions.
              </p>
              <RouterLink :to="{ name: 'settings', hash: '#data-health' }">Open data health</RouterLink>
            </div>
          </details>
        </div>
      </section>

      <section v-if="hasActivity" class="activity-section activity-sessions" aria-labelledby="recent-sessions-heading">
        <div class="activity-section__heading">
          <h2 id="recent-sessions-heading">Recent sessions</h2>
        </div>
        <ul class="session-list">
          <li v-for="session in recentSessions" :key="session.id">
            <RouterLink :to="{ name: 'session', params: { id: session.id } }">
              <span class="session-list__identity">
                <strong>{{ session.title }}</strong>
                <small>{{ projectLabel(session.repository) }}</small>
              </span>
              <time>{{ formatActivityTime(session.endedAt ?? session.startedAt) }}</time>
              <span v-if="session.attentionStatus === 'needs_attention'" class="session-list__issue">
                {{ session.attentionReason }}
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section v-else class="activity-empty" aria-labelledby="empty-activity-heading">
        <h2 id="empty-activity-heading">No imported activity yet</h2>
        <p>Import local agent sessions to see tool use and source-reported friction.</p>
        <RouterLink class="activity-empty__action" :to="{ name: 'settings' }">Import sessions</RouterLink>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import { UiAlert, UiButton } from '@filipgutica/ui'

import type {
  EvidenceRef,
  NormalizedToolStatus,
  OverviewResponse,
  ToolHealthCategory,
  ToolHealthResponse,
} from '@shared/contracts'

import { formatCoverageCount, formatCoverageRatio, useAnalyticsRange } from '../analytics-range'
import { apiKey } from '../api'
import TimeRangeControl from '../components/TimeRangeControl.vue'

type SortKey = 'label' | 'uniqueInvocations' | 'affectedSessions' | 'reportedIssues' | 'successRate'
type SortDirection = 'ascending' | 'descending'

const api = inject(apiKey)
if (!api) throw new Error('Turnscope API client was not provided')

const { range, setRange } = useAnalyticsRange()
const overview = ref<OverviewResponse | null>(null)
const toolHealth = ref<ToolHealthResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const showAllFindings = ref(false)
const sortKey = ref<SortKey>('uniqueInvocations')
const sortDirection = ref<SortDirection>('descending')
const defaultFindingCount = 2
let requestId = 0

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const projectLabel = (repository: string | null): string => {
  if (!repository) return 'Project not reported'
  return repository.split(/[\\/]/).filter(Boolean).at(-1) ?? repository
}
const statusLabel = (status: Exclude<NormalizedToolStatus, 'success'>): string =>
  status === 'failure' ? 'Failed' : status === 'rejected' ? 'Rejected' : 'Cancelled'

const formatActivityTime = (value: string | null): string => {
  if (!value) return 'Time unavailable'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Time unavailable'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
  if (startOfDate === startOfToday) return `Today, ${time}`
  if (startOfDate === startOfToday - 86_400_000) return `Yesterday, ${time}`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

const evidenceTarget = (evidence: EvidenceRef): RouteLocationRaw => ({
  name: 'session',
  params: { id: evidence.sessionId },
  query: { event: evidence.eventId },
  hash: `#event-${evidence.eventId}`,
})

const toolTarget = (category: ToolHealthCategory): RouteLocationRaw => ({
  name: 'tool-detail',
  params: { category: category.category },
})

const visibleFindings = computed(() => {
  const findings = overview.value?.findings ?? []
  return showAllFindings.value ? findings : findings.slice(0, defaultFindingCount)
})
const recentSessions = computed(() => overview.value?.recentSessionRows.slice(0, 3) ?? [])
const unclassifiedCategory = computed(() =>
  toolHealth.value?.categories.find(({ category }) => category === 'other') ?? null)
const rankedCategories = computed(() =>
  toolHealth.value?.categories.filter(({ category }) => category !== 'other') ?? [])
const hasActivity = computed(() =>
  (overview.value?.recentSessionRows.length ?? 0) > 0 || (toolHealth.value?.totalInvocations ?? 0) > 0)

const reportedIssues = (category: ToolHealthCategory): number =>
  category.failedInvocations + (category.permissionRejections ?? 0) + (category.cancellations ?? 0)
const sortValue = (category: ToolHealthCategory, key: SortKey): string | number | null => {
  if (key === 'label') return category.label
  if (key === 'reportedIssues') return reportedIssues(category)
  if (key === 'successRate') return category.successRate.ratio
  return category[key]
}
const sortedCategories = computed(() => [...rankedCategories.value].sort((left, right) => {
  const leftValue = sortValue(left, sortKey.value)
  const rightValue = sortValue(right, sortKey.value)
  if (leftValue === null) return rightValue === null ? left.label.localeCompare(right.label) : 1
  if (rightValue === null) return -1
  const comparison = typeof leftValue === 'string' && typeof rightValue === 'string'
    ? leftValue.localeCompare(rightValue)
    : Number(leftValue) - Number(rightValue)
  return (sortDirection.value === 'ascending' ? comparison : -comparison) || left.label.localeCompare(right.label)
}))
const setSort = (key: SortKey): void => {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'ascending' ? 'descending' : 'ascending'
    return
  }
  sortKey.value = key
  sortDirection.value = key === 'label' ? 'ascending' : 'descending'
}
const ariaSort = (key: SortKey): SortDirection | 'none' => sortKey.value === key ? sortDirection.value : 'none'

const statusCoverageSummary = computed(() => toolHealth.value
  ? `Status known for ${formatCoverageCount(toolHealth.value.statusCoverage)} invocations (${formatCoverageRatio(toolHealth.value.statusCoverage)}).`
  : '')
const availabilitySummary = computed(() => {
  if (!toolHealth.value || !overview.value) return ''
  const missing = [
    toolHealth.value.timingCoverage.numerator === 0 ? 'Timing' : null,
    overview.value.outcomeCoverage.numerator === 0 ? 'outcomes' : null,
  ].filter((value): value is string => value !== null)
  if (missing.length === 0) return ''
  return `${missing.join(' and ')} unavailable.`
})

const toggleFindings = (): void => {
  showAllFindings.value = !showAllFindings.value
}

const loadActivity = async (): Promise<void> => {
  const currentRequest = ++requestId
  loading.value = true
  error.value = null
  showAllFindings.value = false

  try {
    const [nextOverview, nextToolHealth] = await Promise.all([
      api.getOverview({ range: range.value }),
      api.getToolHealth({ range: range.value }),
    ])
    if (currentRequest === requestId) {
      overview.value = nextOverview
      toolHealth.value = nextToolHealth
    }
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load activity'
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

watch(range, loadActivity, { immediate: true })
</script>
