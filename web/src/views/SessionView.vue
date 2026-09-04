<template>
  <section class="page-stack">
    <RouterLink class="back-link" :to="backTarget">← Back to {{ backLabel }}</RouterLink>

    <p v-if="loading" class="status-message">Loading session…</p>
    <UiAlert v-else-if="error" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton @click="loadSession">Retry</UiButton>
    </UiAlert>
    <template v-else-if="detail">
      <header class="page-heading">
        <div>
          <p class="eyebrow">Session drill-down</p>
          <h1>{{ detail.session.title }}</h1>
          <p>
            {{ detail.session.model ?? 'Model not reported' }} ·
            {{ formatDate(detail.session.startedAt) }}
          </p>
        </div>
      </header>

      <UiSurface class="panel" padding="none">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Source order</p>
            <h2>Timeline</h2>
          </div>
          <span>{{ detail.timeline.total }} matching events</span>
        </div>

        <div class="data-table__toolbar timeline-filters">
          <UiField control-id="timeline-search" class="search-control" label="Search timeline">
            <UiInput id="timeline-search" v-model="search" type="search" placeholder="Message or tool" />
          </UiField>
          <UiField control-id="timeline-actor" class="filter-control" label="Actor">
            <UiSelect id="timeline-actor" :model-value="actor" @update:model-value="setActor">
              <option value="">Everyone</option>
              <option value="user">User</option>
              <option value="agent">Agent</option>
              <option value="tool">Tool</option>
              <option value="system">System</option>
            </UiSelect>
          </UiField>
        </div>
        <div v-if="highlightedEventId" class="linked-event-notice">
          <span>Showing the linked evidence event.</span>
          <UiButton variant="text" @click="showFullTimeline">Show full timeline</UiButton>
        </div>
        <p v-if="orderedTimeline.length === 0" class="empty-state">
          No events match the current search and filters.
        </p>
        <div
          v-else
          :key="timelineRevision"
          ref="timelineViewport"
          class="timeline-viewport"
          tabindex="0"
          aria-label="Session timeline"
          @scroll="handleTimelineScroll"
        >
        <ol class="timeline timeline--virtual" :style="{ height: `${timelineSize}px` }">
          <li
            v-for="item in virtualTimeline"
            :id="`event-${item.event.id}`"
            :key="item.event.id"
            class="timeline-event"
            :data-index="item.virtualRow.index"
            :data-highlighted="highlightedEventId === item.event.id"
            :style="{ transform: `translateY(${item.virtualRow.start}px)` }"
          >
            <div class="timeline-event__marker" :data-actor="item.event.actor ?? 'system'" />
            <article>
              <div class="timeline-event__heading">
                <div>
                  <span class="event-kind">{{ item.event.kind }}</span>
                  <span>{{ item.event.actor ?? 'system' }}</span>
                  <span>#{{ item.event.sourceOrder }}</span>
                </div>
                <time>{{ formatDate(item.event.occurredAt) }}</time>
              </div>
              <MarkdownContent
                v-if="item.event.actor === 'user' || item.event.actor === 'agent'"
                class="event-summary"
                :content="item.event.summary"
              />
              <p v-else class="event-summary">{{ item.event.summary }}</p>
              <dl v-if="item.event.toolName || item.event.toolStatus || item.event.durationMs !== null" class="event-meta">
                <div v-if="item.event.toolName">
                  <dt>Tool</dt>
                  <dd>{{ item.event.toolName }}</dd>
                </div>
                <div v-if="item.event.toolStatus">
                  <dt>Status</dt>
                  <dd>{{ item.event.toolStatus }}</dd>
                </div>
                <div v-if="item.event.durationMs !== null">
                  <dt>Duration</dt>
                  <dd>{{ item.event.durationMs }}ms</dd>
                </div>
              </dl>
              <div class="event-actions">
                <span v-for="label in item.event.labels" :key="label" class="label-chip">{{ label }}</span>
                <UiButton variant="text" @click="openEvidence(item.event.sourceRecordId, $event)">
                  Inspect evidence
                </UiButton>
                <UiButton
                  v-if="item.event.actor === 'user' && !item.event.labels.includes('correction')"
                  type="button"
                  variant="text"
                  :loading="savingEventId === item.event.id"
                  @click="markAsCorrection(item.event.id)"
                >
                  {{ savingEventId === item.event.id ? 'Saving…' : 'Mark as agent correction' }}
                </UiButton>
              </div>
            </article>
          </li>
        </ol>
        <p v-if="loadingMore" class="timeline-loading" aria-live="polite">Loading more events…</p>
        </div>
      </UiSurface>

      <UiAlert v-if="correctionSaveError" class="error-message" tone="danger">
        {{ correctionSaveError }}
      </UiAlert>

      <UiSurface v-if="detail.corrections.length > 0" class="panel" padding="none">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Inferred</p>
            <h2>Corrections and steering</h2>
          </div>
        </div>
        <ul class="finding-list">
          <li v-for="correction in detail.corrections" :key="correction.id">
            <strong>{{ correction.category.replaceAll('_', ' ') }}</strong>
            <span>{{ formatConfidence(correction.confidence) }} confidence</span>
            <p>{{ correction.explanation }}</p>
            <a :href="`#event-${correction.eventId}`">View event</a>
            <form class="correction-editor" @submit.prevent="saveCorrection(correction.id)">
              <UiField :control-id="`correction-${correction.id}`" label="Classification">
                <UiSelect
                  :id="`correction-${correction.id}`"
                  :model-value="correctionEdits[correction.id]?.category ?? correction.category"
                  @update:model-value="setCorrectionCategory(correction.id, $event)"
                >
                  <option v-for="category in correctionCategories" :key="category" :value="category">
                    {{ category.replaceAll('_', ' ') }}
                  </option>
                </UiSelect>
              </UiField>
              <UiCheckbox
                :model-value="correctionEdits[correction.id]?.countsAsCorrection ?? correction.countsAsCorrection"
                @update:model-value="setCorrectionCounted(correction.id, $event)"
              >
                Count as an agent correction or unproductive steering
              </UiCheckbox>
              <UiButton type="submit" :loading="savingCorrectionId === correction.id">
                {{ savingCorrectionId === correction.id ? 'Saving…' : 'Save classification' }}
              </UiButton>
              <small v-if="correction.hasUserOverride">User override applied</small>
            </form>
          </li>
        </ul>
      </UiSurface>

      <UiSurface v-if="detail.signals.length > 0" class="panel" padding="none">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Diagnostic signals</p>
            <h2>Patterns in this session</h2>
          </div>
        </div>
        <ul class="finding-list">
          <li v-for="signal in detail.signals" :key="signal.id">
            <strong>{{ signal.detector.replaceAll('_', ' ') }}</strong>
            <span>{{ signal.severity }} · {{ formatConfidence(signal.confidence) }} confidence</span>
            <span v-if="signal.dismissed">dismissed by user</span>
            <p>{{ signal.explanation }}</p>
            <UiButton
              type="button"
              variant="text"
              :loading="savingSignalId === signal.id"
              @click="setSignalDismissed(signal.id, !signal.dismissed)"
            >
              {{ signal.dismissed ? 'Restore signal' : 'Dismiss signal' }}
            </UiButton>
            <small v-if="signal.hasUserOverride">User override applied</small>
          </li>
        </ul>
      </UiSurface>

      <EvidencePanel :source-record-id="selectedEvidenceId" @close="closeEvidence" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { useVirtualizer } from '@tanstack/vue-virtual'

import {
  UiAlert,
  UiButton,
  UiCheckbox,
  UiField,
  UiInput,
  UiSelect,
  UiSurface,
} from '@filipgutica/ui'

import type {
  CorrectionOverrideInput,
  SessionDetailResponse,
  SessionTimelineQuery,
} from '@shared/contracts'
import { correctionCategories } from '@shared/corrections'

import { apiKey } from '../api'
import EvidencePanel from '../components/EvidencePanel.vue'
import MarkdownContent from '../components/MarkdownContent.vue'
import { formatConfidence, formatDate } from '../format'

const api = inject(apiKey)
if (!api) {
  throw new Error('Turnscope API client was not provided')
}

const route = useRoute()
const router = useRouter()
const detail = ref<SessionDetailResponse | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const selectedEvidenceId = ref<string | null>(null)
const evidenceTrigger = ref<HTMLElement | null>(null)
const search = ref('')
const actor = ref<NonNullable<SessionTimelineQuery['actor']> | ''>('')
const timelineViewport = ref<HTMLDivElement | null>(null)
const timelineRevision = ref(0)
const correctionEdits = ref<Record<string, CorrectionOverrideInput>>({})
const savingCorrectionId = ref<string | null>(null)
const correctionSaveError = ref<string | null>(null)
const savingEventId = ref<string | null>(null)
const savingSignalId = ref<string | null>(null)

const setActor = (value: string): void => {
  if (value === '' || value === 'user' || value === 'agent' || value === 'tool' || value === 'system') {
    actor.value = value
  }
}

const sessionId = computed(() => String(route.params.id))
const highlightedEventId = computed(() =>
  typeof route.query.event === 'string' ? route.query.event : null,
)
const backTarget = computed<RouteLocationRaw>(() => typeof route.query.project === 'string'
  ? { name: 'project', params: { id: route.query.project } }
  : { name: 'overview' })
const backLabel = computed(() => typeof route.query.project === 'string' ? 'project' : 'overview')
const orderedTimeline = computed(() =>
  detail.value === null
    ? []
    : [...detail.value.timeline.rows].sort((left, right) => left.sourceOrder - right.sourceOrder),
)
const timelineVirtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>(computed(() => ({
  count: orderedTimeline.value.length,
  getScrollElement: () => timelineViewport.value,
  estimateSize: () => 220,
  getItemKey: (index) => orderedTimeline.value[index]?.id ?? index,
  initialRect: { width: 1000, height: 496 },
  overscan: 5,
})))
const virtualTimeline = computed(() => {
  const measuredRows = timelineVirtualizer.value.getVirtualItems()
  const rows = measuredRows.length > 0 || timelineViewport.value?.clientHeight !== 0
    ? measuredRows
    : orderedTimeline.value.map((event, index) => ({
        index,
        key: event.id,
        start: index * 220,
        end: (index + 1) * 220,
        size: 220,
        lane: 0,
      }))
  return rows.flatMap((virtualRow) => {
    const event = orderedTimeline.value[virtualRow.index]
    return event ? [{ event, virtualRow }] : []
  })
})
const timelineSize = computed(() => timelineVirtualizer.value.getTotalSize()
  || orderedTimeline.value.length * 220)
let requestId = 0

const loadSession = async (): Promise<void> => {
  const currentRequest = ++requestId
  timelineVirtualizer.value.scrollToOffset(0)
  if (timelineViewport.value) {
    timelineViewport.value.scrollTop = 0
    timelineViewport.value.dispatchEvent(new Event('scroll'))
  }
  loading.value = true
  error.value = null
  selectedEvidenceId.value = null

  try {
    const response = await api.getSession(sessionId.value, {
      limit: 100,
      search: search.value,
      ...(actor.value ? { actor: actor.value } : {}),
      ...(highlightedEventId.value ? { eventId: highlightedEventId.value } : {}),
    })
    if (currentRequest !== requestId) return
    detail.value = response
    timelineRevision.value += 1
    correctionEdits.value = Object.fromEntries(
      response.corrections.map((correction) => [correction.id, {
        category: correction.category,
        countsAsCorrection: correction.countsAsCorrection,
      }]),
    )
    await nextTick()
    timelineVirtualizer.value.scrollToOffset(0)
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load session'
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

const loadMore = async (): Promise<void> => {
  if (!detail.value || loadingMore.value || detail.value.timeline.rows.length >= detail.value.timeline.total) return
  loadingMore.value = true
  try {
    const response = await api.getSession(sessionId.value, {
      offset: detail.value.timeline.rows.length,
      limit: 100,
      search: search.value,
      ...(actor.value ? { actor: actor.value } : {}),
    })
    detail.value = {
      ...response,
      timeline: {
        ...response.timeline,
        offset: 0,
        rows: [...detail.value.timeline.rows, ...response.timeline.rows],
      },
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load more events'
  } finally {
    loadingMore.value = false
  }
}

const handleTimelineScroll = (): void => {
  const element = timelineViewport.value
  if (!element || element.scrollHeight - element.scrollTop - element.clientHeight >= 480) return
  void loadMore()
}

const openEvidence = (sourceRecordId: string, event: Event): void => {
  evidenceTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  selectedEvidenceId.value = sourceRecordId
}

const closeEvidence = (): void => {
  selectedEvidenceId.value = null
  evidenceTrigger.value?.focus()
}

const showFullTimeline = (): void => {
  const query = { ...route.query }
  delete query.event
  void router.replace({ query, hash: '' })
}

const setCorrectionCategory = (correctionId: string, value: string): void => {
  const current = correctionEdits.value[correctionId]
  const category = correctionCategories.find((candidate) => candidate === value)
  if (!current || !category) return
  correctionEdits.value[correctionId] = {
    ...current,
    category,
  }
}

const setCorrectionCounted = (correctionId: string, value: boolean): void => {
  const current = correctionEdits.value[correctionId]
  if (!current) return
  correctionEdits.value[correctionId] = { ...current, countsAsCorrection: value }
}

const saveCorrection = async (correctionId: string): Promise<void> => {
  const override = correctionEdits.value[correctionId]
  if (!override) return
  savingCorrectionId.value = correctionId
  correctionSaveError.value = null
  try {
    await api.updateCorrection(correctionId, override)
    await loadSession()
  } catch (cause) {
    correctionSaveError.value = cause instanceof Error
      ? cause.message
      : 'Unable to save the classification'
  } finally {
    savingCorrectionId.value = null
  }
}

const markAsCorrection = async (eventId: string): Promise<void> => {
  savingEventId.value = eventId
  correctionSaveError.value = null
  try {
    await api.createCorrection(eventId, {
      category: 'agent_mistake',
      countsAsCorrection: true,
    })
    await loadSession()
  } catch (cause) {
    correctionSaveError.value = cause instanceof Error
      ? cause.message
      : 'Unable to add the correction classification'
  } finally {
    savingEventId.value = null
  }
}

const setSignalDismissed = async (signalId: string, dismissed: boolean): Promise<void> => {
  savingSignalId.value = signalId
  correctionSaveError.value = null
  try {
    await api.updateSignal(signalId, { dismissed })
    await loadSession()
  } catch (cause) {
    correctionSaveError.value = cause instanceof Error
      ? cause.message
      : 'Unable to update the diagnostic signal'
  } finally {
    savingSignalId.value = null
  }
}

watch([sessionId, actor, highlightedEventId], loadSession, { immediate: true })
watch(search, (_value, _previous, onCleanup) => {
  const timer = window.setTimeout(() => void loadSession(), 200)
  onCleanup(() => window.clearTimeout(timer))
})
</script>
