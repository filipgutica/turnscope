<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink class="brand" :to="{ name: 'overview' }">Turnscope</RouterLink>
      <nav aria-label="Primary navigation">
        <RouterLink :to="{ name: 'overview' }">Overview</RouterLink>
        <RouterLink :to="{ name: 'patterns' }">Patterns</RouterLink>
        <label class="theme-control">
          <span>Theme</span>
          <select v-model="preference" aria-label="Color theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </nav>
    </header>

    <main>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'

import { useTheme } from './theme'

const { preference } = useTheme()
</script>
