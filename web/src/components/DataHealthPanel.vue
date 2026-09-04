<template>
  <UiSurface class="panel data-health" padding="none" aria-labelledby="data-health-heading">
    <div class="section-heading">
      <div>
        <h2 id="data-health-heading">Data health</h2>
        <p>Coverage shows which imported records can support each result.</p>
      </div>
      <span class="range-context">{{ rangeLabel }}</span>
    </div>

    <dl class="definition-grid data-health__summary">
      <div>
        <dt>Imported sessions</dt>
        <dd>{{ formatNumber(dataHealth.importedSessions) }}</dd>
      </div>
      <div>
        <dt>Last successful import</dt>
        <dd>{{ formatDate(dataHealth.lastSuccessfulImport) }}</dd>
      </div>
      <div v-for="item in coverageRows" :key="item.label">
        <dt>{{ item.label }}</dt>
        <dd>
          <strong>{{ formatCoverageRatio(item.coverage) }}</strong>
          <span>{{ formatCoverageCount(item.coverage) }}</span>
          <small>{{ item.coverage.limitation }}</small>
        </dd>
      </div>
    </dl>

    <div class="data-health__sources">
      <h3>Products and adapters</h3>
      <p v-if="dataHealth.sources.length === 0" class="empty-state">
        No compatible source installation has been imported.
      </p>
      <ul v-else class="source-health-list">
        <li v-for="source in dataHealth.sources" :key="source.id">
          <div>
            <strong>{{ source.product }} {{ source.productVersion ?? 'version unknown' }}</strong>
            <span>Adapter {{ source.adapterVersion }}</span>
          </div>
          <UiBadge :tone="source.compatibility === 'supported' ? 'success' : 'warning'">
            {{ source.compatibility }}
          </UiBadge>
          <small v-if="source.warning">{{ source.warning }}</small>
        </li>
      </ul>
    </div>

    <div class="data-health__warnings">
      <h3>Active compatibility warnings</h3>
      <p v-if="dataHealth.activeWarnings.length === 0">None reported.</p>
      <ul v-else>
        <li v-for="warning in dataHealth.activeWarnings" :key="`${warning.code}-${warning.source ?? ''}`">
          <strong>{{ warning.code.replaceAll('_', ' ') }}</strong>
          <span>{{ warning.message }}</span>
          <small v-if="warning.source">{{ warning.source }}</small>
        </li>
      </ul>
    </div>
  </UiSurface>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { UiBadge, UiSurface } from '@filipgutica/ui'

import type { DataHealthSummary } from '@shared/contracts'

import { formatCoverageCount, formatCoverageRatio } from '../analytics-range'
import { formatDate } from '../format'

const { dataHealth, rangeLabel } = defineProps<{
  dataHealth: DataHealthSummary
  rangeLabel: string
}>()

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const coverageRows = computed(() => [
  { label: 'Token-usage coverage', coverage: dataHealth.tokenUsageCoverage },
  { label: 'Tool-status coverage', coverage: dataHealth.toolStatusCoverage },
  { label: 'Tool-timing coverage', coverage: dataHealth.toolTimingCoverage },
  { label: 'Sessions with known outcomes', coverage: dataHealth.outcomeCoverage },
])
</script>
