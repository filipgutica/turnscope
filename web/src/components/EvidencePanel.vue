<template>
  <UiDialog
    :open="Boolean(sourceRecordId)"
    title="Evidence"
    description="Raw imported source record"
    @update:open="onOpenChange"
  >
      <p v-if="loading" class="status-message">Loading evidence…</p>
      <UiAlert v-else-if="error" class="error-message" tone="danger">
        <p>{{ error }}</p>
        <UiButton @click="loadEvidence">Retry</UiButton>
      </UiAlert>
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
  </UiDialog>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'

import { UiAlert, UiButton, UiDialog } from '@filipgutica/ui'

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
const loading = ref(false)
const error = ref<string | null>(null)

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close')
}

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
  loadEvidence,
  { immediate: true },
)
</script>
