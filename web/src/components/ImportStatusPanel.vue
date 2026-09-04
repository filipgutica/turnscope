<template>
  <UiSurface class="panel import-panel" padding="default" aria-labelledby="import-heading">
    <div class="section-heading import-panel__heading">
      <div>
        <p class="eyebrow">Local data</p>
        <h2 id="import-heading">Codex import</h2>
      </div>
      <UiBadge :tone="statusTone">{{ statusLabel }}</UiBadge>
    </div>

    <div class="import-panel__action">
      <div>
        <strong>{{ primaryMessage }}</strong>
        <p>{{ supportingMessage }}</p>
      </div>
      <UiButton
        :variant="status.state === 'running' ? 'danger' : 'primary'"
        @click="onAction"
      >
        {{ actionLabel }}
      </UiButton>
    </div>

    <template v-if="status.state === 'running'">
      <UiProgress
        class="import-progress"
        label="Codex import progress"
        :max="Math.max(1, status.progress.filesTotal)"
        :value="status.progress.filesProcessed"
      />
      <div class="import-progress__copy">
        <strong>{{ status.progress.filesProcessed }} of {{ status.progress.filesTotal }} files</strong>
        <span>{{ phaseLabel }}</span>
      </div>
      <p v-if="status.progress.currentFile" class="path-text import-current-file">
        {{ status.progress.currentFile }}
      </p>
    </template>

    <dl v-if="status.state !== 'idle'" class="import-stats">
      <div>
        <dt>Imported</dt>
        <dd>{{ formatCount(status.progress.filesImported) }} files</dd>
      </div>
      <div>
        <dt>Unchanged</dt>
        <dd>{{ formatCount(status.progress.filesSkipped) }} files</dd>
      </div>
      <div>
        <dt>New records</dt>
        <dd>{{ formatCount(status.progress.recordsInserted) }}</dd>
      </div>
      <div>
        <dt>Warnings</dt>
        <dd>{{ formatCount(status.warningCount) }}</dd>
      </div>
    </dl>

    <UiAlert v-if="status.error" class="error-message" tone="danger">{{ status.error }}</UiAlert>

    <details v-if="status.warnings.length > 0" class="import-warnings">
      <summary>View import warnings ({{ formatCount(status.warningCount) }})</summary>
      <ul>
        <li v-for="warning in status.warnings" :key="`${warning.code}:${warning.source ?? ''}`">
          {{ warning.message }}
          <small v-if="warning.source">{{ warning.source }}</small>
        </li>
      </ul>
      <p v-if="status.warningCount > status.warnings.length">
        Showing the first {{ status.warnings.length }} warnings.
      </p>
    </details>
  </UiSurface>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { UiAlert, UiBadge, UiButton, UiProgress, UiSurface } from '@filipgutica/ui'

import type { ImportJobStatus } from '@shared/contracts'

const { status } = defineProps<{ status: ImportJobStatus }>()

const emit = defineEmits<{
  (event: 'start'): void
  (event: 'cancel'): void
}>()

const onAction = (): void => {
  if (status.state === 'running') {
    emit('cancel')
  } else {
    emit('start')
  }
}

const formatCount = (value: number): string => new Intl.NumberFormat().format(value)

const statusLabel = computed(() => ({
  idle: 'Ready',
  running: 'Importing',
  completed: 'Complete',
  failed: 'Needs attention',
  cancelled: 'Stopped',
})[status.state])

const statusTone = computed(() => ({
  idle: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
} as const)[status.state])

const primaryMessage = computed(() => ({
  idle: 'Bring your local Codex sessions into Turnscope.',
  running: 'Import is running in the background.',
  completed: 'Import complete',
  failed: 'The import did not finish.',
  cancelled: 'Import stopped. Completed files are safely stored.',
})[status.state])

const supportingMessage = computed(() => status.state === 'running'
  ? 'You can keep using Turnscope while this runs.'
  : 'Source files stay untouched. Later imports skip files that have not changed.')

const actionLabel = computed(() => ({
  idle: 'Import Codex sessions',
  running: 'Stop import',
  completed: 'Check for new sessions',
  failed: 'Try import again',
  cancelled: 'Resume import',
})[status.state])

const phaseLabel = computed(() => ({
  discovering: 'Finding session files…',
  importing: 'Reading changed sessions…',
  analyzing: 'Updating patterns…',
})[status.phase ?? 'discovering'])
</script>
