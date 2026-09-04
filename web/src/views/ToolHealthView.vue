<template>
  <section class="page-stack">
    <header class="page-heading">
      <div>
        <h1>Tool Health</h1>
        <p>Normalized invocations, reported outcomes, intervention signals, and source evidence.</p>
      </div>
      <div class="page-actions">
        <TimeRangeControl :model-value="range" @update:model-value="setRange" />
        <UiButton variant="secondary" :loading="loading" @click="loadToolHealth">Refresh</UiButton>
      </div>
    </header>

    <p v-if="loading && !toolHealth" class="status-message">Loading tool health…</p>
    <UiAlert v-else-if="error && !toolHealth" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton @click="loadToolHealth">Retry</UiButton>
    </UiAlert>
    <template v-else-if="toolHealth">
      <UiAlert v-if="error" class="error-message" tone="danger">{{ error }}</UiAlert>

      <UiSurface class="panel tool-health-summary" padding="none" aria-labelledby="tool-health-summary-heading">
        <div class="section-heading">
          <div>
            <h2 id="tool-health-summary-heading">Reliability coverage</h2>
            <p>Rates only use invocations with a reported value.</p>
          </div>
          <span class="range-context">{{ toolHealth.range.label }}</span>
        </div>
        <dl class="definition-grid tool-health-summary__values">
          <div>
            <dt>Unique invocations</dt>
            <dd>{{ formatNumber(toolHealth.totalInvocations) }}</dd>
          </div>
          <div>
            <dt>Known status</dt>
            <dd>
              <strong>{{ formatCoverageRatio(toolHealth.statusCoverage) }}</strong>
              <span>{{ formatCoverageCount(toolHealth.statusCoverage) }}</span>
              <small>{{ toolHealth.statusCoverage.limitation }}</small>
            </dd>
          </div>
          <div>
            <dt>Reported timing</dt>
            <dd>
              <strong>{{ formatCoverageRatio(toolHealth.timingCoverage) }}</strong>
              <span>{{ formatCoverageCount(toolHealth.timingCoverage) }}</span>
              <small>{{ toolHealth.timingCoverage.limitation }}</small>
            </dd>
          </div>
        </dl>
        <p class="panel-note">{{ toolHealth.limitation }}</p>
      </UiSurface>

      <UiSurface class="panel" padding="none" aria-labelledby="tool-categories-heading">
        <div class="section-heading">
          <div>
            <h2 id="tool-categories-heading">Tool categories</h2>
            <p>Provider aliases are grouped into stable semantic categories; evidence retains the raw tool name. Permission counts include explicit source outcomes only.</p>
          </div>
          <span class="range-context">{{ toolHealth.range.label }}</span>
        </div>

        <p v-if="toolHealth.categories.length === 0" class="empty-state panel-empty">
          No normalized tool invocations fall within this time range.
        </p>
        <div v-else class="tool-health-table" tabindex="0" aria-label="Scrollable tool health table">
          <table>
            <thead>
              <tr>
                <th scope="col" :aria-sort="ariaSort('label')"><button type="button" @click="setSort('label')">Tool category</button></th>
                <th scope="col" :aria-sort="ariaSort('uniqueInvocations')"><button type="button" @click="setSort('uniqueInvocations')">Unique invocations</button></th>
                <th scope="col" :aria-sort="ariaSort('statusRatio')"><button type="button" @click="setSort('statusRatio')">Known status</button></th>
                <th scope="col" :aria-sort="ariaSort('successRate')"><button type="button" @click="setSort('successRate')">Success rate</button></th>
                <th scope="col" :aria-sort="ariaSort('affectedSessions')"><button type="button" @click="setSort('affectedSessions')">Sessions</button></th>
                <th scope="col">Intervention</th>
                <th scope="col">Repeated actions</th>
                <th scope="col">Execution time</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="category in sortedCategories" :key="category.id">
                <th scope="row">{{ category.label }}</th>
                <td>{{ formatNumber(category.uniqueInvocations) }}</td>
                <td>
                  <strong>{{ formatCoverageRatio(category.statusCoverage) }}</strong>
                  <small>{{ formatCoverageCount(category.statusCoverage) }}</small>
                </td>
                <td>
                  <strong>{{ formatCoverageRatio(category.successRate) }}</strong>
                  <small>
                    {{ formatNumber(category.successfulInvocations) }} successful,
                    {{ formatNumber(category.failedInvocations) }} failed ·
                    {{ formatCoverageCount(category.successRate) }} known
                  </small>
                </td>
                <td>{{ formatNumber(category.affectedSessions) }}</td>
                <td>
                  <strong>{{ formatOptionalCount(category.permissionRejections) }} rejected</strong>
                  <small>{{ formatOptionalCount(category.cancellations) }} cancelled</small>
                  <small :title="category.interventionLimitation">Incomplete source coverage</small>
                </td>
                <td>
                  <template v-if="category.repeatInvocations !== null">
                    <strong>{{ formatNumber(category.repeatInvocations) }} repeats</strong>
                    <small>{{ formatCoverageCount(category.repeatCoverage) }} comparable</small>
                  </template>
                  <template v-else>
                    <strong>Not reported</strong>
                    <small>{{ formatCoverageCount(category.repeatCoverage) }} comparable</small>
                  </template>
                </td>
                <td>
                  <strong>Median {{ formatMilliseconds(category.medianDurationMs) }}</strong>
                  <small>P90 {{ formatMilliseconds(category.p90DurationMs) }} · {{ formatCoverageCount(category.timingCoverage) }}</small>
                </td>
                <td>
                  <div v-if="category.evidence.length > 0" class="table-evidence">
                    <RouterLink
                      v-for="evidence in category.evidence"
                      :key="evidence.eventId"
                      :to="evidenceTarget(evidence)"
                    >
                      {{ evidence.label }}
                    </RouterLink>
                  </div>
                  <span v-else>None available</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiSurface>

      <DataHealthPanel :data-health="toolHealth.dataHealth" :range-label="toolHealth.range.label" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import { UiAlert, UiButton, UiSurface } from '@filipgutica/ui'

import type { EvidenceRef, ToolHealthCategory, ToolHealthResponse } from '@shared/contracts'

import {
  formatCoverageCount,
  formatCoverageRatio,
  formatMilliseconds,
  useAnalyticsRange,
} from '../analytics-range'
import { apiKey } from '../api'
import DataHealthPanel from '../components/DataHealthPanel.vue'
import TimeRangeControl from '../components/TimeRangeControl.vue'

type SortKey = 'label' | 'uniqueInvocations' | 'statusRatio' | 'successRate' | 'affectedSessions'
type SortDirection = 'ascending' | 'descending'

const api = inject(apiKey)
if (!api) throw new Error('Turnscope API client was not provided')

const { range, setRange } = useAnalyticsRange()
const toolHealth = ref<ToolHealthResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const sortKey = ref<SortKey>('uniqueInvocations')
const sortDirection = ref<SortDirection>('descending')
let requestId = 0

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const formatOptionalCount = (value: number | null): string => value === null ? 'Not reported' : formatNumber(value)
const evidenceTarget = (evidence: EvidenceRef): RouteLocationRaw => ({
  name: 'session',
  params: { id: evidence.sessionId },
  query: { event: evidence.eventId },
  hash: `#event-${evidence.eventId}`,
})
const sortValue = (category: ToolHealthCategory, key: SortKey): number | string | null => {
  switch (key) {
    case 'label': return category.label
    case 'statusRatio': return category.statusCoverage.ratio
    case 'successRate': return category.successRate.ratio
    default: return category[key]
  }
}
const sortedCategories = computed(() => [...(toolHealth.value?.categories ?? [])].sort((left, right) => {
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

const loadToolHealth = async (): Promise<void> => {
  const currentRequest = ++requestId
  loading.value = true
  error.value = null

  try {
    const response = await api.getToolHealth({ range: range.value })
    if (currentRequest === requestId) toolHealth.value = response
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load tool health'
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

watch(range, loadToolHealth, { immediate: true })
</script>
