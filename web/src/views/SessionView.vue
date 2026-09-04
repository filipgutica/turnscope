<template>
  <section class="page-stack session-view">
    <RouterLink class="back-link" :to="backTarget">← Back to {{ backLabel }}</RouterLink>

    <UiAlert v-if="error" class="error-message" tone="danger">
      <p>{{ error }}</p>
      <UiButton size="compact" @click="loadSession">Retry</UiButton>
    </UiAlert>
    <p v-if="loading" class="status-message">Loading session…</p>
    <template v-else-if="detail">
      <header class="session-header">
        <h1>{{ detail.session.title }}</h1>
        <p>
          {{ detail.session.model ?? 'Model not reported' }}
          <span aria-hidden="true">·</span>
          {{ formatDate(detail.session.startedAt) }}
        </p>
      </header>

      <section
        class="session-timeline"
        aria-labelledby="session-timeline-heading"
        :aria-busy="refreshing"
      >
        <header class="session-timeline__toolbar">
          <div class="session-timeline__heading">
            <h2 id="session-timeline-heading">Timeline</h2>
            <span aria-live="polite">{{ matchingEventLabel }}</span>
          </div>
          <div v-if="!highlightedEventId" class="session-timeline__filters">
            <UiInput
              id="timeline-search"
              v-model="search"
              class="session-search"
              type="search"
              aria-label="Search events"
              placeholder="Search events"
            />
            <UiSelect
              id="timeline-actor"
              class="session-actor-filter"
              :model-value="actor"
              aria-label="Filter events by actor"
              @update:model-value="setActor"
            >
              <option value="">All actors</option>
              <option value="user">User</option>
              <option value="agent">Agent</option>
              <option value="tool">Tool</option>
              <option value="system">System</option>
            </UiSelect>
          </div>
        </header>

        <div v-if="highlightedEventId" class="linked-event-notice" role="status">
          <span v-if="orderedTimeline.length > 0">
            <strong>Linked evidence</strong> · showing the supporting event
          </span>
          <span v-else>
            <strong>Supporting event unavailable</strong> · it may be missing from this import
          </span>
          <UiButton variant="text" @click="showFullTimeline">Show all events</UiButton>
        </div>
        <p v-if="orderedTimeline.length === 0" class="empty-state">
          {{ highlightedEventId
            ? 'The linked source event is unavailable.'
            : 'No events match the current search and filters.' }}
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
              :ref="measureTimelineEvent"
              class="timeline-event"
              :data-index="item.virtualRow.index"
              :data-highlighted="highlightedEventId === item.event.id"
              :style="{ transform: `translateY(${item.virtualRow.start}px)` }"
            >
              <div class="timeline-event__marker" :data-actor="item.event.actor ?? 'system'" aria-hidden="true" />
              <article>
                <div class="timeline-event__heading">
                  <div>
                    <strong class="event-actor">{{ item.event.actor ?? 'system' }}</strong>
                    <span>{{ formatEventKind(item.event.kind, item.event.actor) }}</span>
                    <span>#{{ item.event.sourceOrder }}</span>
                    <span v-if="highlightedEventId === item.event.id" class="linked-event-label">
                      Linked evidence
                    </span>
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
                  <UiButton variant="text" @click="openEvidence(item.event.sourceRecordId, $event)">
                    View source
                  </UiButton>
                </div>
              </article>
            </li>
          </ol>
          <p v-if="loadingMore" class="timeline-loading" aria-live="polite">Loading more events…</p>
        </div>
      </section>

      <EvidencePanel :source-record-id="selectedEvidenceId" @close="closeEvidence" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { useVirtualizer } from '@tanstack/vue-virtual'

import {
  UiAlert,
  UiButton,
  UiInput,
  UiSelect,
} from '@filipgutica/ui'

import type { SessionDetailResponse, SessionTimelineQuery } from '@shared/contracts'

import { apiKey } from '../api'
import EvidencePanel from '../components/EvidencePanel.vue'
import MarkdownContent from '../components/MarkdownContent.vue'
import { formatDate } from '../format'

const api = inject(apiKey)
if (!api) {
  throw new Error('Turnscope API client was not provided')
}

const route = useRoute()
const router = useRouter()
const detail = ref<SessionDetailResponse | null>(null)
const loading = ref(false)
const refreshing = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const selectedEvidenceId = ref<string | null>(null)
const evidenceTrigger = ref<HTMLElement | null>(null)
const search = ref('')
const actor = ref<NonNullable<SessionTimelineQuery['actor']> | ''>('')
const timelineViewport = ref<HTMLDivElement | null>(null)
const timelineRevision = ref(0)
const estimatedTimelineEventHeight = 152

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
  : { name: 'activity' })
const backLabel = computed(() => typeof route.query.project === 'string' ? 'project' : 'activity')
const orderedTimeline = computed(() =>
  detail.value === null
    ? []
    : [...detail.value.timeline.rows].sort((left, right) => left.sourceOrder - right.sourceOrder),
)
const matchingEventLabel = computed(() => {
  const count = detail.value?.timeline.total ?? 0
  return `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'event' : 'events'}`
})
const formatEventKind = (kind: string, actor: string | null): string => {
  const normalizedKind = kind.replaceAll('_', ' ')
  const actorPrefix = `${actor ?? 'system'} `
  return normalizedKind.startsWith(actorPrefix)
    ? normalizedKind.slice(actorPrefix.length)
    : normalizedKind
}
const timelineVirtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>(computed(() => ({
  count: orderedTimeline.value.length,
  getScrollElement: () => timelineViewport.value,
  estimateSize: () => estimatedTimelineEventHeight,
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
        start: index * estimatedTimelineEventHeight,
        end: (index + 1) * estimatedTimelineEventHeight,
        size: estimatedTimelineEventHeight,
        lane: 0,
      }))
  return rows.flatMap((virtualRow) => {
    const event = orderedTimeline.value[virtualRow.index]
    return event ? [{ event, virtualRow }] : []
  })
})
const timelineSize = computed(() => timelineVirtualizer.value.getTotalSize()
  || orderedTimeline.value.length * estimatedTimelineEventHeight)
let requestId = 0

const measureTimelineEvent = (element: Element | ComponentPublicInstance | null): void => {
  if (element instanceof HTMLLIElement) {
    timelineVirtualizer.value.measureElement(element)
  }
}

const loadSession = async (): Promise<void> => {
  const currentRequest = ++requestId
  const isInitialLoad = detail.value === null || detail.value.session.id !== sessionId.value
  if (isInitialLoad) detail.value = null
  timelineVirtualizer.value.scrollToOffset(0)
  if (timelineViewport.value) {
    timelineViewport.value.scrollTop = 0
    timelineViewport.value.dispatchEvent(new Event('scroll'))
  }
  loading.value = isInitialLoad
  refreshing.value = !isInitialLoad
  error.value = null
  selectedEvidenceId.value = null

  try {
    const response = await api.getSession(sessionId.value, {
      limit: 100,
      ...(highlightedEventId.value
        ? { eventId: highlightedEventId.value }
        : {
            search: search.value,
            ...(actor.value ? { actor: actor.value } : {}),
          }),
    })
    if (currentRequest !== requestId) return
    detail.value = response
    timelineRevision.value += 1
    await nextTick()
    timelineVirtualizer.value.scrollToOffset(0)
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load session'
    }
  } finally {
    if (currentRequest === requestId) {
      loading.value = false
      refreshing.value = false
    }
  }
}

const loadMore = async (): Promise<void> => {
  if (
    !detail.value
    || refreshing.value
    || loadingMore.value
    || detail.value.timeline.rows.length >= detail.value.timeline.total
  ) return
  const currentRequest = requestId
  loadingMore.value = true
  try {
    const response = await api.getSession(sessionId.value, {
      offset: detail.value.timeline.rows.length,
      limit: 100,
      search: search.value,
      ...(actor.value ? { actor: actor.value } : {}),
    })
    if (currentRequest !== requestId) return
    detail.value = {
      ...response,
      timeline: {
        ...response.timeline,
        offset: 0,
        rows: [...detail.value.timeline.rows, ...response.timeline.rows],
      },
    }
  } catch (cause) {
    if (currentRequest === requestId) {
      error.value = cause instanceof Error ? cause.message : 'Unable to load more events'
    }
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

watch([sessionId, actor, highlightedEventId], loadSession, { immediate: true })
watch(search, (_value, _previous, onCleanup) => {
  const timer = window.setTimeout(() => void loadSession(), 200)
  onCleanup(() => window.clearTimeout(timer))
})
</script>
