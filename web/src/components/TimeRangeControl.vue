<template>
  <div class="range-control" role="group" :aria-label="label" :aria-busy="disabled">
    <button
      v-for="option in analyticsRangeOptions"
      :key="option.value"
      type="button"
      :aria-pressed="modelValue === option.value"
      :disabled="disabled"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { AnalyticsRange } from '@shared/contracts'

import { analyticsRangeOptions } from '../analytics-range'

const { modelValue, label = 'Analytics time range', disabled = false } = defineProps<{
  modelValue: AnalyticsRange
  label?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: AnalyticsRange): void
}>()
</script>
