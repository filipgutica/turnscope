<template>
  <UiSurface as="article" class="metric-card" padding="default">
    <div class="metric-card__heading">
      <h2>{{ label }}</h2>
      <UiBadge :tone="metric.measurementClass === 'inferred' ? 'warning' : 'neutral'">
        {{ measurementLabel }}
      </UiBadge>
    </div>
    <p v-if="metric.value !== null" class="metric-card__value">{{ formattedValue }}</p>
    <div v-else class="metric-card__missing">
      <p>Not available</p>
      <small>{{ metric.missingReason ?? 'The source did not report this value.' }}</small>
    </div>
    <details v-if="metric.evidence.length > 0" class="metric-card__evidence">
      <summary>View evidence ({{ metric.evidence.length }})</summary>
      <ul>
        <li v-for="evidence in metric.evidence" :key="evidence.eventId">
          <RouterLink
            :to="{
              name: 'session',
              params: { id: evidence.sessionId },
              query: { event: evidence.eventId },
              hash: `#event-${evidence.eventId}`,
            }"
          >
            {{ evidence.label }}
          </RouterLink>
        </li>
      </ul>
    </details>
  </UiSurface>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { UiBadge, UiSurface } from '@filipgutica/ui'

import type { MetricValue } from '@shared/contracts'

const { label, metric } = defineProps<{
  label: string
  metric: MetricValue
}>()

const measurementLabel = computed(
  () =>
    `${metric.measurementClass.charAt(0).toUpperCase()}${metric.measurementClass.slice(1)}`,
)

const formattedValue = computed(() => {
  if (metric.value === null) {
    return ''
  }

  switch (metric.unit) {
    case 'ratio':
      return new Intl.NumberFormat(undefined, {
        style: 'percent',
        maximumFractionDigits: 1,
      }).format(metric.value)
    case 'milliseconds':
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(metric.value / 1_000)}s`
    case 'currency':
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
      }).format(metric.value)
    default:
      return new Intl.NumberFormat().format(metric.value)
  }
})
</script>
