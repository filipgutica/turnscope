<template>
  <div class="app-shell bg-ui-bg text-ui-text">
    <aside class="app-header">
      <RouterLink class="brand" :to="{ name: 'activity' }">Turnscope</RouterLink>
      <nav aria-label="Primary navigation">
        <RouterLink
          :class="{ 'router-link-active': activityRouteNames.has(String(route.name)) }"
          :to="{ name: 'activity' }"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 16.5 9 11l3.5 3.5L20 6" />
            <path d="M15 6h5v5" />
          </svg>
          <span>Activity</span>
        </RouterLink>
        <RouterLink
          :class="{ 'router-link-active': settingsRouteNames.has(String(route.name)) }"
          :to="{ name: 'settings' }"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
          </svg>
          <span>Settings</span>
        </RouterLink>
      </nav>
    </aside>

    <main>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import { analyticsRangeKey, createAnalyticsRange } from './analytics-range'
import { themeKey, useTheme } from './theme'

const route = useRoute()
const activityRouteNames = new Set(['activity', 'tool-detail', 'session', 'project'])
const settingsRouteNames = new Set(['settings', 'patterns'])

provide(themeKey, useTheme())
provide(analyticsRangeKey, createAnalyticsRange())
</script>
