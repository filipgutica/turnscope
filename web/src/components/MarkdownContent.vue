<template>
  <div class="markdown-content" v-html="html" />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { renderMarkdown } from '../markdown'

const { content } = defineProps<{ content: string }>()
const html = computed(() => renderMarkdown(content))
</script>
