<template>
  <section class="page-stack settings-page">
    <header class="page-heading">
      <div>
        <h1>Settings</h1>
      </div>
    </header>

    <UiSurface class="panel settings-section" padding="default" aria-labelledby="appearance-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Appearance</p>
          <h2 id="appearance-heading">Color theme</h2>
          <p>Use a built-in palette, a local VS Code color-theme file, or an Open VSX theme.</p>
        </div>
      </div>

      <div class="settings-row">
        <UiField control-id="active-theme" class="settings-control" label="Active theme">
          <UiSelect
            id="active-theme"
            v-model="theme.preference.value"
            aria-label="Color theme"
            :disabled="theme.isChangingTheme.value"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option v-if="theme.importedTheme.value" value="imported">
              Imported — {{ theme.importedTheme.value.name }}
            </option>
          </UiSelect>
        </UiField>
        <div class="theme-preview" aria-hidden="true">
          <span
            v-for="(color, index) in previewColors"
            :key="`${color}-${index}`"
            :style="{ background: color }"
          />
        </div>
      </div>

      <div class="settings-subsection" aria-labelledby="community-themes-heading">
        <div>
          <h3 id="community-themes-heading">Search community themes</h3>
          <p>Find open-source color themes from Open VSX. Turnscope imports colors only; extension code never runs.</p>
        </div>
        <form class="theme-search" role="search" @submit.prevent="submitSearch">
          <UiField control-id="theme-search" label="Search Open VSX themes" class="theme-search__field">
            <UiInput
              id="theme-search"
              v-model="searchQuery"
              aria-label="Search Open VSX themes"
              type="search"
              maxlength="100"
              placeholder="Search themes"
            />
          </UiField>
          <UiButton type="submit" :loading="theme.isSearchingOpenVsx.value" :disabled="!searchQuery.trim()">
            {{ theme.isSearchingOpenVsx.value ? 'Searching…' : 'Search' }}
          </UiButton>
        </form>
        <div class="theme-suggestions" aria-label="Suggested theme searches">
          <UiButton
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            variant="text"
            :disabled="theme.isSearchingOpenVsx.value"
            @click="searchSuggestion(suggestion)"
          >
            {{ suggestion }}
          </UiButton>
        </div>
        <UiAlert v-if="theme.openVsxError.value" class="error-message" tone="danger">
          {{ theme.openVsxError.value }}
        </UiAlert>
        <p
          v-else-if="hasSearched && !theme.isSearchingOpenVsx.value && theme.openVsxResults.value.length === 0"
          class="empty-state"
        >
          No compatible themes found. Try another search.
        </p>
        <div v-else-if="theme.openVsxResults.value.length > 0" class="theme-results">
          <UiSurface
            v-for="result in theme.openVsxResults.value"
            :key="result.id"
            as="article"
            class="theme-result-card"
            padding="compact"
          >
            <div class="theme-result-card__heading">
              <span class="theme-result-icon" aria-hidden="true">◐</span>
              <div>
                <h4>{{ result.name }}</h4>
                <p>{{ result.publisher }} · {{ formatDownloads(result.downloadCount) }} downloads</p>
              </div>
            </div>
            <p>{{ result.description || 'No description provided.' }}</p>
            <UiButton
              type="button"
              variant="secondary"
              :loading="theme.installingOpenVsxId.value === result.id"
              :disabled="theme.isChangingTheme.value"
              @click="theme.importOpenVsxTheme(result.id)"
            >
              {{ theme.installingOpenVsxId.value === result.id ? 'Adding…' : 'Apply theme' }}
            </UiButton>
          </UiSurface>
        </div>
      </div>

      <div class="settings-subsection local-theme-import" aria-labelledby="local-theme-heading">
        <div>
          <h3 id="local-theme-heading">Import a local theme</h3>
          <p>Choose a VS Code <code>.json</code> or <code>.jsonc</code> color-theme file up to 1 MB.</p>
        </div>
        <div class="theme-actions">
          <UiButton
            type="button"
            variant="secondary"
            :loading="theme.isImporting.value"
            :disabled="theme.isChangingTheme.value"
            @click="theme.importTheme"
          >
            {{ theme.isImporting.value ? 'Importing…' : 'Import VS Code theme…' }}
          </UiButton>
          <UiButton
            v-if="theme.importedTheme.value"
            type="button"
            variant="text"
            :disabled="theme.isChangingTheme.value"
            @click="theme.removeImportedTheme"
          >
            Remove imported theme
          </UiButton>
        </div>
      </div>

      <UiAlert
        v-if="theme.status.value"
        class="theme-status"
        :tone="themeStatusTone"
      >
        <strong v-if="theme.status.value.tone === 'error'">Error:</strong>
        {{ theme.status.value.message }}
      </UiAlert>
    </UiSurface>

    <section class="settings-group" aria-labelledby="data-sources-heading">
      <div>
        <p class="eyebrow">Data sources</p>
        <h2 id="data-sources-heading">Agent session imports</h2>
        <p>Each agent integration owns its discovery and compatibility rules.</p>
      </div>

      <ImportStatusPanel
        v-if="importStatus"
        :status="importStatus"
        @start="startImport"
        @cancel="cancelImport"
      />
      <UiSurface v-else as="article" class="panel source-card" padding="default">
        <div>
          <h3>Codex</h3>
          <p>Codex session import is available in the desktop app.</p>
        </div>
        <UiBadge>Unavailable</UiBadge>
      </UiSurface>

      <UiSurface as="article" class="panel source-card" padding="default">
        <div>
          <h3>Claude Code</h3>
          <p>The settings boundary is ready for a future Claude Code adapter; importing is not implemented yet.</p>
        </div>
        <UiBadge tone="info">Planned</UiBadge>
      </UiSurface>
    </section>

    <section id="data-health" class="settings-group" aria-labelledby="data-health-settings-heading">
      <div>
        <h2 id="data-health-settings-heading">Data health and diagnostics</h2>
        <p v-if="dataHealth">
          {{ formatNumber(dataHealth.importedSessions) }} imported sessions ·
          status known for {{ formatCoverageCount(dataHealth.toolStatusCoverage) }} invocations ·
          {{ formatNumber(dataHealth.activeWarnings.length) }} active warnings
        </p>
        <p v-else-if="dataHealthError">Data health is unavailable: {{ dataHealthError }}</p>
        <p v-else>Loading imported data coverage…</p>
      </div>

      <details class="settings-diagnostics">
        <summary>View coverage and advanced diagnostics</summary>
        <DataHealthPanel v-if="dataHealth" :data-health="dataHealth" range-label="All time" />
        <RouterLink class="diagnostics-link" :to="{ name: 'patterns' }">
          Open pattern diagnostics
        </RouterLink>
      </details>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import {
  UiAlert,
  UiBadge,
  UiButton,
  UiField,
  UiInput,
  UiSelect,
  UiSurface,
} from '@filipgutica/ui'

import type { DataHealthSummary, ImportJobStatus } from '@shared/contracts'

import { formatCoverageCount } from '../analytics-range'
import { apiKey } from '../api'
import DataHealthPanel from '../components/DataHealthPanel.vue'
import ImportStatusPanel from '../components/ImportStatusPanel.vue'
import { themeKey } from '../theme'

const api = inject(apiKey)
const theme = inject(themeKey)
if (!api || !theme) throw new Error('Turnscope settings dependencies were not provided')

const searchQuery = ref('')
const hasSearched = ref(false)
const suggestions = ['Catppuccin', 'Dracula', 'Nord', 'Tokyo Night']
const importStatus = ref<ImportJobStatus | null>(null)
const dataHealth = ref<DataHealthSummary | null>(null)
const dataHealthError = ref<string | null>(null)
const importApi = api.getImportStatus && api.startImport && api.cancelImport
  ? { getStatus: api.getImportStatus, start: api.startImport, cancel: api.cancelImport }
  : null
let importPollTimer: ReturnType<typeof setTimeout> | undefined

const previewColors = [
  'var(--color-bg)',
  'var(--color-text)',
  'var(--color-link)',
  'var(--color-accent)',
  'var(--color-error)',
] as const

const themeStatusTone = computed(() => {
  if (theme.status.value?.tone === 'error') return 'error'
  if (theme.status.value?.tone === 'success') return 'success'
  return 'neutral'
})

const formatDownloads = (value: number): string => new Intl.NumberFormat(undefined, {
  notation: value >= 1_000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value)
const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)

const loadDataHealth = async (): Promise<void> => {
  dataHealthError.value = null
  try {
    dataHealth.value = (await api.getOverview({ range: 'all' })).dataHealth
  } catch (cause) {
    dataHealthError.value = cause instanceof Error ? cause.message : 'Unable to load coverage'
  }
}

const submitSearch = async (): Promise<void> => {
  hasSearched.value = true
  await theme.searchOpenVsxThemes(searchQuery.value)
}

const searchSuggestion = async (suggestion: string): Promise<void> => {
  searchQuery.value = suggestion
  await submitSearch()
}

const scheduleImportPoll = (): void => {
  if (importStatus.value?.state !== 'running') return
  importPollTimer = setTimeout(refreshImportStatus, 500)
}

const refreshImportStatus = async (): Promise<void> => {
  if (!importApi) return
  try {
    importStatus.value = await importApi.getStatus()
  } catch (cause) {
    if (importStatus.value) {
      importStatus.value = {
        ...importStatus.value,
        state: 'failed',
        phase: null,
        completedAt: new Date().toISOString(),
        error: cause instanceof Error ? cause.message : 'Unable to read import status',
      }
    }
  } finally {
    scheduleImportPoll()
  }
}

const startImport = async (): Promise<void> => {
  if (!importApi) return
  if (importPollTimer) clearTimeout(importPollTimer)
  try {
    importStatus.value = await importApi.start()
  } catch (cause) {
    if (importStatus.value) {
      importStatus.value = {
        ...importStatus.value,
        state: 'failed',
        phase: null,
        completedAt: new Date().toISOString(),
        error: cause instanceof Error ? cause.message : 'Unable to start import',
      }
    }
  }
  scheduleImportPoll()
}

const cancelImport = async (): Promise<void> => {
  if (!importApi) return
  if (importPollTimer) clearTimeout(importPollTimer)
  importStatus.value = await importApi.cancel()
}

onMounted(() => {
  void refreshImportStatus()
  void loadDataHealth()
})
onUnmounted(() => {
  if (importPollTimer) clearTimeout(importPollTimer)
})
</script>
