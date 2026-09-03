<template>
  <section class="page-stack settings-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">Application preferences</p>
        <h1>Settings</h1>
        <p>Choose Turnscope’s appearance and manage local agent data sources.</p>
      </div>
    </header>

    <section class="panel settings-section" aria-labelledby="appearance-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Appearance</p>
          <h2 id="appearance-heading">Color theme</h2>
          <p>Use a built-in palette, a local VS Code color-theme file, or an Open VSX theme.</p>
        </div>
      </div>

      <div class="settings-row">
        <label class="settings-control">
          <span>Active theme</span>
          <select
            v-model="theme.preference.value"
            aria-label="Color theme"
            :disabled="theme.isChangingTheme.value"
          >
            <option value="system">System</option>
            <option value="light">Light — Catppuccin Latte</option>
            <option value="dark">Dark — Catppuccin Mocha</option>
            <option v-if="theme.importedTheme.value" value="imported">
              Imported — {{ theme.importedTheme.value.name }}
            </option>
          </select>
        </label>
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
          <label>
            <span class="sr-only">Search Open VSX themes</span>
            <input
              v-model="searchQuery"
              type="search"
              maxlength="100"
              placeholder="Search themes"
              aria-label="Search Open VSX themes"
            >
          </label>
          <button type="submit" :disabled="theme.isSearchingOpenVsx.value || !searchQuery.trim()">
            {{ theme.isSearchingOpenVsx.value ? 'Searching…' : 'Search' }}
          </button>
        </form>
        <div class="theme-suggestions" aria-label="Suggested theme searches">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            type="button"
            class="text-button"
            :disabled="theme.isSearchingOpenVsx.value"
            @click="searchSuggestion(suggestion)"
          >
            {{ suggestion }}
          </button>
        </div>
        <p v-if="theme.openVsxError.value" class="error-message" role="alert">
          {{ theme.openVsxError.value }}
        </p>
        <p
          v-else-if="hasSearched && !theme.isSearchingOpenVsx.value && theme.openVsxResults.value.length === 0"
          class="empty-state"
        >
          No compatible themes found. Try another search.
        </p>
        <div v-else-if="theme.openVsxResults.value.length > 0" class="theme-results">
          <article
            v-for="result in theme.openVsxResults.value"
            :key="result.id"
            class="theme-result-card"
          >
            <div class="theme-result-card__heading">
              <span class="theme-result-icon" aria-hidden="true">◐</span>
              <div>
                <h4>{{ result.name }}</h4>
                <p>{{ result.publisher }} · {{ formatDownloads(result.downloadCount) }} downloads</p>
              </div>
            </div>
            <p>{{ result.description || 'No description provided.' }}</p>
            <button
              type="button"
              class="secondary-button"
              :disabled="theme.isChangingTheme.value"
              @click="theme.importOpenVsxTheme(result.id)"
            >
              {{ theme.installingOpenVsxId.value === result.id ? 'Adding…' : 'Apply theme' }}
            </button>
          </article>
        </div>
      </div>

      <div class="settings-subsection local-theme-import" aria-labelledby="local-theme-heading">
        <div>
          <h3 id="local-theme-heading">Import a local theme</h3>
          <p>Choose a VS Code <code>.json</code> or <code>.jsonc</code> color-theme file up to 1 MB.</p>
        </div>
        <div class="theme-actions">
          <button
            type="button"
            class="secondary-button"
            :disabled="theme.isChangingTheme.value"
            @click="theme.importTheme"
          >
            {{ theme.isImporting.value ? 'Importing…' : 'Import VS Code theme…' }}
          </button>
          <button
            v-if="theme.importedTheme.value"
            type="button"
            class="text-button"
            :disabled="theme.isChangingTheme.value"
            @click="theme.removeImportedTheme"
          >
            Remove imported theme
          </button>
        </div>
      </div>

      <p
        v-if="theme.status.value"
        class="theme-status"
        :data-tone="theme.status.value.tone"
        :role="theme.status.value.tone === 'error' ? 'alert' : undefined"
        aria-live="polite"
      >
        <strong v-if="theme.status.value.tone === 'error'">Error:</strong>
        {{ theme.status.value.message }}
      </p>
    </section>

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
      <article v-else class="panel source-card">
        <div>
          <h3>Codex</h3>
          <p>Codex session import is available in the desktop app.</p>
        </div>
        <span class="status-badge">Unavailable</span>
      </article>

      <article class="panel source-card">
        <div>
          <h3>Claude Code</h3>
          <p>The settings boundary is ready for a future Claude Code adapter; importing is not implemented yet.</p>
        </div>
        <span class="status-badge" data-state="planned">Planned</span>
      </article>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'

import type { ImportJobStatus } from '@shared/contracts'

import { apiKey } from '../api'
import ImportStatusPanel from '../components/ImportStatusPanel.vue'
import { themeKey } from '../theme'

const api = inject(apiKey)
const theme = inject(themeKey)
if (!api || !theme) throw new Error('Turnscope settings dependencies were not provided')

const searchQuery = ref('')
const hasSearched = ref(false)
const suggestions = ['Catppuccin', 'Dracula', 'Nord', 'Tokyo Night']
const importStatus = ref<ImportJobStatus | null>(null)
const importApi = api.getImportStatus && api.startImport && api.cancelImport
  ? { getStatus: api.getImportStatus, start: api.startImport, cancel: api.cancelImport }
  : null
let importPollTimer: ReturnType<typeof setTimeout> | undefined

const previewColors = computed(() => {
  if (theme.resolvedTheme.value === 'imported' && theme.importedTheme.value) {
    const { tokens } = theme.importedTheme.value
    return [tokens.pageBackground, tokens.textPrimary, tokens.link, tokens.accent, tokens.error]
  }
  return theme.resolvedTheme.value === 'dark'
    ? ['#1E1E2E', '#CDD6F4', '#89B4FA', '#CBA6F7', '#F38BA8']
    : ['#EFF1F5', '#4C4F69', '#1E66F5', '#8839EF', '#D20F39']
})

const formatDownloads = (value: number): string => new Intl.NumberFormat(undefined, {
  notation: value >= 1_000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value)

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

onMounted(refreshImportStatus)
onUnmounted(() => {
  if (importPollTimer) clearTimeout(importPollTimer)
})
</script>
