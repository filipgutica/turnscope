<template>
  <section class="page-stack tool-detail-page">
    <RouterLink class="back-link" :to="{ name: 'activity' }">← Activity</RouterLink>

    <header class="activity-header">
      <h1>{{ category?.label ?? 'Tool details' }}</h1>
      <TimeRangeControl :model-value="range" :disabled="loading" @update:model-value="setRange" />
    </header>

    <p v-if="loading && !toolHealth" class="status-message">Loading tool details…</p>
    <UiAlert v-else-if="error" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton @click="loadToolHealth">Retry</UiButton>
    </UiAlert>
    <template v-else-if="category">
      <dl class="tool-detail-summary">
        <div>
          <dt>Invocations</dt>
          <dd>{{ formatNumber(category.uniqueInvocations) }}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>{{ formatNumber(category.affectedSessions) }}</dd>
        </div>
        <div>
          <dt>Known status</dt>
          <dd>{{ formatCoverageCount(category.statusCoverage) }}</dd>
        </div>
        <div>
          <dt>Successful when known</dt>
          <dd v-if="category.successRate.denominator > 0">
            {{ formatNumber(category.successRate.numerator) }} /
            {{ formatNumber(category.successRate.denominator) }} ·
            {{ formatCoverageRatio(category.successRate) }}
          </dd>
          <dd v-else aria-label="Not reported by source">—</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd v-if="category.statusCoverage.numerator > 0">{{ formatNumber(category.failedInvocations) }}</dd>
          <dd v-else aria-label="Not reported by source">—</dd>
        </div>
        <div v-if="category.permissionRejections !== null">
          <dt>Rejected</dt>
          <dd>{{ formatNumber(category.permissionRejections) }}</dd>
        </div>
        <div v-if="category.cancellations !== null">
          <dt>Cancelled</dt>
          <dd>{{ formatNumber(category.cancellations) }}</dd>
        </div>
        <div v-if="category.repeatInvocations !== null">
          <dt>Repeated actions</dt>
          <dd>{{ formatNumber(category.repeatInvocations) }} of {{ formatNumber(category.repeatCoverage.denominator) }}</dd>
        </div>
        <div v-if="category.timingCoverage.numerator > 0">
          <dt>Execution time</dt>
          <dd>
            Median {{ formatMilliseconds(category.medianDurationMs) }} ·
            P90 {{ formatMilliseconds(category.p90DurationMs) }} ·
            {{ formatCoverageCount(category.timingCoverage) }} timed
          </dd>
        </div>
      </dl>

      <section class="tool-detail-section" aria-labelledby="aliases-heading">
        <h2 id="aliases-heading">Source tool names</h2>
        <ul v-if="category.rawNames.length > 0" class="alias-list">
          <li v-for="alias in category.rawNames" :key="alias.name">
            <code>{{ alias.name }}</code>
            <span>{{ formatNumber(alias.invocations) }}</span>
          </li>
        </ul>
        <p v-else class="activity-empty-line">The source did not report a raw tool name.</p>
      </section>

      <section class="tool-detail-section" aria-labelledby="tool-evidence-heading">
        <h2 id="tool-evidence-heading">Representative evidence</h2>
        <ul v-if="category.evidence.length > 0" class="tool-evidence-list">
          <li v-for="evidence in category.evidence" :key="evidence.eventId">
            <RouterLink :to="evidenceTarget(evidence)">
              <strong>{{ evidence.sessionTitle }}</strong>
              <span>
                {{ evidence.rawToolName ?? category.label }} ·
                {{ evidence.sourceStatus ?? evidence.status ?? 'Status not reported' }} ·
                {{ formatDate(evidence.occurredAt) }}
              </span>
            </RouterLink>
          </li>
        </ul>
        <p v-else class="activity-empty-line">No source event is available for this category.</p>
      </section>

      <div class="coverage-disclosure">
        <p>{{ category.statusCoverage.limitation }}</p>
        <RouterLink :to="{ name: 'settings', hash: '#data-health' }">Open data health</RouterLink>
      </div>
    </template>
    <p v-else-if="toolHealth" class="activity-empty-line">This tool category is not present in {{ toolHealth.range.label }}.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { RouterLink, type RouteLocationRaw, useRoute } from 'vue-router'

import { UiAlert, UiButton } from '@filipgutica/ui'

import type { EvidenceRef, ToolHealthResponse } from '@shared/contracts'

import {
  formatCoverageCount,
  formatCoverageRatio,
  formatMilliseconds,
  useAnalyticsRange,
} from '../analytics-range'
import { apiKey } from '../api'
import TimeRangeControl from '../components/TimeRangeControl.vue'
import { formatDate } from '../format'

const api = inject(apiKey)
if (!api) throw new Error('Turnscope API client was not provided')

const route = useRoute()
const { range, setRange } = useAnalyticsRange()
const toolHealth = ref<ToolHealthResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let requestId = 0

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const category = computed(() => toolHealth.value?.categories.find(({ category: value }) => value === route.params.category) ?? null)
const evidenceTarget = (evidence: EvidenceRef): RouteLocationRaw => ({
  name: 'session',
  params: { id: evidence.sessionId },
  query: { event: evidence.eventId },
  hash: `#event-${evidence.eventId}`,
})

const loadToolHealth = async (): Promise<void> => {
  const currentRequest = ++requestId
  loading.value = true
  error.value = null
  try {
    const response = await api.getToolHealth({ range: range.value })
    if (currentRequest === requestId) toolHealth.value = response
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load tool details'
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

watch([range, () => route.params.category], loadToolHealth, { immediate: true })
</script>
