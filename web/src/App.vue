<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink class="brand" :to="{ name: 'overview' }">Turnscope</RouterLink>
      <nav aria-label="Primary navigation">
        <RouterLink :to="{ name: 'overview' }">Overview</RouterLink>
        <RouterLink :to="{ name: 'patterns' }">Patterns</RouterLink>
        <RouterLink :to="{ name: 'settings' }">Settings</RouterLink>
      </nav>
    </header>

    <main>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { RouterLink, RouterView } from 'vue-router'

import { themeKey, useTheme } from './theme'

provide(themeKey, useTheme())
</script>
