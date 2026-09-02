<template>
  <div v-if="sourceRecordId" class="evidence-overlay" @click.self="emit('close')">
    <section
      ref="panel"
      class="evidence-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-title"
      tabindex="-1"
      @keydown.esc="emit('close')"
    >
      <div class="section-heading">
        <div>
          <p class="eyebrow">Raw provenance</p>
          <h2 id="evidence-title">Evidence</h2>
        </div>
        <button type="button" class="secondary-button" @click="emit('close')">Close</button>
      </div>

      <p v-if="loading" class="status-message">Loading evidence…</p>
      <div v-else-if="error" class="error-message" role="alert">
        <p>{{ error }}</p>
        <button type="button" @click="loadEvidence">Retry</button>
      </div>
      <div v-else-if="evidence" class="evidence-content">
        <dl class="detail-list">
          <div>
            <dt>Source pointer</dt>
            <dd>{{ evidence.sourcePointer }}</dd>
          </div>
          <div>
            <dt>Schema version</dt>
            <dd>{{ evidence.sourceSchemaVersion ?? 'Not reported' }}</dd>
          </div>
          <div>
            <dt>Imported</dt>
            <dd>{{ formatDate(evidence.importedAt) }}</dd>
          </div>
        </dl>
        <pre>{{ formattedPayload }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'

import type { SourceEvidenceResponse } from '@shared/contracts'

import { apiKey } from '../api'
import { formatDate } from '../format'

const { sourceRecordId } = defineProps<{ sourceRecordId: string | null }>()
const emit = defineEmits<{
  (e: 'close'): void
}>()

const api = inject(apiKey)
if (!api) {
  throw new Error('Turnscope API client was not provided')
}

const evidence = ref<SourceEvidenceResponse | null>(null)
const panel = ref<HTMLElement | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const formattedPayload = computed(() =>
  evidence.value === null ? '' : JSON.stringify(evidence.value.redactedPayload, null, 2),
)

const loadEvidence = async (): Promise<void> => {
  if (!sourceRecordId) {
    return
  }

  loading.value = true
  error.value = null
  evidence.value = null

  try {
    evidence.value = await api.getEvidence(sourceRecordId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load evidence'
  } finally {
    loading.value = false
  }
}

watch(
  () => sourceRecordId,
  async () => {
    await nextTick()
    panel.value?.focus()
    await loadEvidence()
  },
  { immediate: true, flush: 'post' },
)
</script>
