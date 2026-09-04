<template>
  <section class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Explainable diagnostics</p>
        <h1>Pattern explorer</h1>
        <p>Start with observed evidence. Inferred patterns are labeled and never presented as automatic judgments.</p>
      </div>
      <UiButton variant="secondary" :loading="loading" @click="loadDiagnostics">
        Refresh
      </UiButton>
    </header>

    <p v-if="loading" class="status-message">Loading diagnostics…</p>
    <UiAlert v-else-if="error" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton @click="loadDiagnostics">Retry</UiButton>
    </UiAlert>
    <template v-else-if="diagnostics">
      <section class="metric-grid" aria-label="Diagnostic overview">
        <UiSurface as="article" class="metric-card" padding="default">
          <span>Counted corrections</span>
          <strong>{{ formatNumber(diagnostics.countedCorrections) }}</strong>
          <small>{{ formatNumber(diagnostics.correctionCandidates) }} heuristic candidates</small>
        </UiSurface>
        <UiSurface as="article" class="metric-card" padding="default">
          <span>Failed tool events</span>
          <strong>{{ formatNumber(diagnostics.failedToolEvents) }}</strong>
          <small>Directly reported failed or error status</small>
        </UiSurface>
        <UiSurface as="article" class="metric-card" padding="default">
          <span>Token coverage</span>
          <strong>{{ formatPercent(diagnostics.tokenCoverage.coverageRatio) }}</strong>
          <small>{{ formatNumber(diagnostics.tokenCoverage.sessionsWithUsage) }} of {{ formatNumber(diagnostics.tokenCoverage.totalSessions) }} sessions</small>
        </UiSurface>
        <UiSurface as="article" class="metric-card" padding="default">
          <span>Detected repeat patterns</span>
          <strong>{{ formatNumber(diagnostics.signalCount) }}</strong>
          <small>Evidence-backed detector results</small>
        </UiSurface>
      </section>

      <UiSurface class="panel diagnostic-section" padding="none">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Corrections and mistakes</p>
            <h2>Where did the agent need steering?</h2>
          </div>
        </div>
        <p>
          Heuristic candidates include approvals and product decisions. Only agent mistakes and
          unproductive steering count as corrections by default; a user override always wins.
        </p>
        <VirtualDataTable
          :rows="diagnostics.correctionCategories"
          :columns="correctionColumns"
          :total="diagnostics.correctionCategories.length"
          label="Correction categories"
        />
      </UiSurface>

      <UiSurface class="panel diagnostic-section" padding="none">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Tool reliability</p>
            <h2>Which tool categories fail most often?</h2>
          </div>
        </div>
        <p>
          These are direct failed or error statuses from imported events. They show where to
          investigate, not whether the agent caused the underlying failure.
        </p>
        <VirtualDataTable
          v-if="diagnostics.toolFailures.length > 0"
          :rows="diagnostics.toolFailures"
          :columns="toolColumns"
          :total="diagnostics.toolFailures.length"
          label="Tool failure categories"
        />
        <p v-else class="empty-state">No failed tool events were imported.</p>
      </UiSurface>

      <section class="question-grid">
        <UiSurface as="article" class="panel diagnostic-section" padding="default">
          <p class="eyebrow">Token efficiency</p>
          <h2>Can we identify wasted tokens?</h2>
          <strong class="diagnostic-answer">Not reliably yet</strong>
          <UiProgress
            class="coverage-progress"
            label="Token usage coverage"
            :max="Math.max(1, diagnostics.tokenCoverage.totalSessions)"
            :value="diagnostics.tokenCoverage.sessionsWithUsage"
          />
          <p>
            Usage exists for {{ formatNumber(diagnostics.tokenCoverage.sessionsWithUsage) }} of
            {{ formatNumber(diagnostics.tokenCoverage.totalSessions) }} sessions
            ({{ formatPercent(diagnostics.tokenCoverage.coverageRatio) }}).
          </p>
          <dl class="detail-list">
            <div><dt>Input tokens</dt><dd>{{ formatOptionalNumber(diagnostics.tokenCoverage.inputTokens) }}</dd></div>
            <div><dt>Cached input</dt><dd>{{ formatOptionalNumber(diagnostics.tokenCoverage.cachedInputTokens) }}</dd></div>
            <div><dt>Output tokens</dt><dd>{{ formatOptionalNumber(diagnostics.tokenCoverage.outputTokens) }}</dd></div>
          </dl>
          <p class="diagnostic-limitation">{{ diagnostics.tokenCoverage.limitation }}</p>
        </UiSurface>

        <UiSurface as="article" class="panel diagnostic-section" padding="default">
          <p class="eyebrow">Skill efficiency</p>
          <h2>Which skills help or hurt?</h2>
          <strong class="diagnostic-answer">Not measurable yet</strong>
          <p>{{ diagnostics.skillCoverage.reason }}</p>
          <p class="diagnostic-limitation">
            The importer needs explicit skill invocation, completion, and outcome attribution before
            this can become a defensible comparison.
          </p>
        </UiSurface>
      </section>

      <UiSurface class="panel diagnostic-section" padding="none">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Repeated behavior</p>
            <h2>Detected patterns</h2>
          </div>
          <span>{{ diagnostics.signalCount }} results</span>
        </div>
        <p v-if="diagnostics.signals.length === 0" class="empty-state">
          No session contains the same normalized tool failure twice. Other diagnostic evidence is
          still available above.
        </p>
        <div v-else class="pattern-grid">
          <UiSurface
            v-for="pattern in diagnostics.signals"
            :key="pattern.id"
            as="article"
            class="pattern-card"
            padding="default"
            :data-dismissed="pattern.dismissed"
          >
            <div class="pattern-card__heading">
              <div>
                <span class="severity" :data-severity="pattern.severity">{{ pattern.severity }}</span>
                <h3>{{ pattern.detector.replaceAll('_', ' ') }}</h3>
              </div>
              <span>{{ formatConfidence(pattern.confidence) }} confidence</span>
            </div>
            <p v-if="pattern.dismissed"><strong>Dismissed by user</strong></p>
            <p>{{ pattern.explanation }}</p>
            <div class="pattern-evidence">
              <span>Supporting events</span>
              <RouterLink
                v-for="evidence in pattern.evidence"
                :key="evidence.eventId"
                :to="evidenceTarget(evidence)"
              >
                {{ evidence.label }}
              </RouterLink>
            </div>
          </UiSurface>
        </div>
      </UiSurface>
    </template>
  </section>
</template>

<script setup lang="ts">
import { h, inject, onMounted, ref } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import { UiAlert, UiButton, UiProgress, UiSurface } from '@filipgutica/ui'

import type {
  CorrectionDiagnostic,
  DiagnosticsResponse,
  EvidenceRef,
  ToolFailureDiagnostic,
} from '@shared/contracts'

import { apiKey } from '../api'
import VirtualDataTable from '../components/VirtualDataTable.vue'
import { formatConfidence } from '../format'
import type { DataTableColumn } from '../table'

const api = inject(apiKey)
if (!api) {
  throw new Error('Turnscope API client was not provided')
}

const diagnostics = ref<DiagnosticsResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const formatOptionalNumber = (value: number | null): string => value === null
  ? 'Not reported'
  : formatNumber(value)
const formatPercent = (value: number): string => new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
}).format(value)
const formatDuration = (value: number | null): string => value === null
  ? 'Not reported'
  : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}ms`
const evidenceTarget = (evidence: EvidenceRef): RouteLocationRaw => ({
  name: 'session',
  params: { id: evidence.sessionId },
  query: { event: evidence.eventId },
  hash: `#event-${evidence.eventId}`,
})
const evidenceCell = (evidence: EvidenceRef[]) => h('div', { class: 'table-evidence' },
  evidence.map((item) => h(RouterLink, {
    to: evidenceTarget(item),
  }, () => item.label)))

const correctionColumns: DataTableColumn<CorrectionDiagnostic>[] = [
  {
    accessorKey: 'category',
    header: 'Classification',
    cell: ({ row }) => row.original.category.replaceAll('_', ' '),
  },
  { accessorKey: 'candidates', header: 'Candidates' },
  { accessorKey: 'countedCorrections', header: 'Counted' },
  { accessorKey: 'userOverrides', header: 'Overrides' },
  { id: 'evidence', header: 'Evidence', cell: ({ row }) => evidenceCell(row.original.evidence) },
]

const toolColumns: DataTableColumn<ToolFailureDiagnostic>[] = [
  { accessorKey: 'toolName', header: 'Tool category' },
  { accessorKey: 'recordedEvents', header: 'Recorded events' },
  { accessorKey: 'failures', header: 'Failures' },
  { accessorKey: 'affectedSessions', header: 'Sessions' },
  {
    accessorKey: 'averageFailureDurationMs',
    header: 'Avg. failed duration',
    cell: ({ row }) => formatDuration(row.original.averageFailureDurationMs),
  },
  { id: 'evidence', header: 'Evidence', cell: ({ row }) => evidenceCell(row.original.evidence) },
]

const loadDiagnostics = async (): Promise<void> => {
  loading.value = true
  error.value = null

  try {
    diagnostics.value = await api.getDiagnostics()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load diagnostics'
  } finally {
    loading.value = false
  }
}

onMounted(loadDiagnostics)
</script>
