<template>
  <div class="theme-picker-shell">
    <UiSurface class="panel theme-picker-panel" padding="default">
      <fieldset class="theme-picker" :disabled="theme.isChangingTheme.value">
        <legend>Color scheme</legend>

        <div class="theme-choice-grid">
          <label
            v-for="choice in builtInThemes"
            :key="choice.value"
            class="theme-choice"
            :data-selected="theme.preference.value === choice.value"
          >
            <input
              v-model="theme.preference.value"
              type="radio"
              name="color-scheme"
              :value="choice.value"
              :disabled="theme.isChangingTheme.value"
            >
            <span
              class="theme-choice__preview"
              :class="`theme-choice__preview--${choice.value}`"
              aria-hidden="true"
            >
              <span class="theme-choice__sidebar">
                <i />
                <i />
                <i />
              </span>
              <span class="theme-choice__canvas">
                <i />
                <i />
                <i />
              </span>
              <span class="theme-choice__panel">
                <i />
                <i />
                <i />
              </span>
            </span>
            <span class="theme-choice__label">
              <span>{{ choice.label }}</span>
              <small v-if="theme.preference.value === choice.value">Selected</small>
            </span>
          </label>
        </div>

        <div class="theme-library-heading">
          <h3>Themes</h3>
          <UiButton
            type="button"
            variant="secondary"
            :disabled="theme.isChangingTheme.value"
            @click="openAddTheme"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
            Add theme
          </UiButton>
        </div>

        <div v-if="theme.importedTheme.value" class="installed-theme">
          <label
            class="installed-theme__choice"
            :data-selected="theme.preference.value === 'imported'"
          >
            <input
              v-model="theme.preference.value"
              type="radio"
              name="color-scheme"
              value="imported"
              :disabled="theme.isChangingTheme.value"
            >
            <span class="installed-theme__preview" :style="importedPreviewStyle" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span class="installed-theme__identity">
              <strong>{{ theme.importedTheme.value.name }}</strong>
              <small>Imported theme</small>
            </span>
            <UiBadge v-if="theme.preference.value === 'imported'" tone="success">Active</UiBadge>
          </label>
          <UiButton
            type="button"
            variant="text"
            :disabled="theme.isChangingTheme.value"
            :aria-label="`Remove ${theme.importedTheme.value.name} theme`"
            @click="theme.removeImportedTheme"
          >
            Remove
          </UiButton>
        </div>
      </fieldset>

      <UiAlert
        v-if="theme.status.value && !isAddThemeOpen"
        class="theme-status"
        :tone="themeStatusTone"
      >
        <strong v-if="theme.status.value.tone === 'error'">Error:</strong>
        {{ theme.status.value.message }}
      </UiAlert>
    </UiSurface>

    <UiDialog
      :open="isAddThemeOpen"
      title="Add a theme"
      description="Search Open VSX or import a VS Code color-theme file."
      @update:open="setAddThemeOpen"
    >
      <div class="theme-dialog">
        <section class="theme-dialog__section" aria-labelledby="community-themes-heading">
          <div>
            <h3 id="community-themes-heading">Search community themes</h3>
            <p>Open-source themes from Open VSX. Extension code never runs.</p>
          </div>

          <div class="theme-search" role="search">
            <UiField control-id="theme-search" label="Search Open VSX themes" class="theme-search__field">
              <UiInput
                id="theme-search"
                v-model="searchQuery"
                aria-label="Search Open VSX themes"
                type="search"
                maxlength="100"
                placeholder="Search themes…"
              />
            </UiField>
            <span class="theme-search__status" aria-live="polite">
              {{ theme.isSearchingOpenVsx.value ? 'Searching…' : '' }}
            </span>
          </div>

          <div class="theme-suggestions" aria-label="Suggested theme searches">
            <UiButton
              v-for="suggestion in suggestions"
              :key="suggestion"
              type="button"
              variant="ghost"
              size="compact"
              :disabled="theme.isSearchingOpenVsx.value || theme.isChangingTheme.value"
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
                <span class="theme-result-icon" aria-hidden="true">Aa</span>
                <div>
                  <h4>{{ result.name }}</h4>
                  <p>{{ result.publisher }} · {{ formatDownloads(result.downloadCount) }} downloads</p>
                </div>
              </div>
              <p>{{ result.description || 'No description provided.' }}</p>
              <UiButton
                type="button"
                variant="secondary"
                size="compact"
                :loading="theme.installingOpenVsxId.value === result.id"
                :disabled="theme.isChangingTheme.value"
                @click="applyOpenVsxTheme(result.id)"
              >
                {{ theme.installingOpenVsxId.value === result.id ? 'Applying…' : 'Apply theme' }}
              </UiButton>
            </UiSurface>
          </div>
        </section>

        <div class="theme-dialog__separator"><span>or import a file</span></div>

        <section class="theme-file-import" aria-labelledby="local-theme-heading">
          <div>
            <h3 id="local-theme-heading">Theme file</h3>
            <p>Choose a VS Code <code>.json</code> or <code>.jsonc</code> file up to 1 MB.</p>
          </div>
          <UiButton
            type="button"
            variant="secondary"
            :loading="theme.isImporting.value"
            :disabled="theme.isChangingTheme.value"
            @click="importLocalTheme"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 13.5V16h12v-2.5" />
            </svg>
            {{ theme.isImporting.value ? 'Importing…' : 'Choose theme file…' }}
          </UiButton>
        </section>

        <UiAlert
          v-if="hasImportFeedback && theme.status.value"
          class="theme-status"
          :tone="themeStatusTone"
        >
          <strong v-if="theme.status.value.tone === 'error'">Error:</strong>
          {{ theme.status.value.message }}
        </UiAlert>
      </div>
    </UiDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'

import { useDebounceFn } from '@vueuse/core'

import {
  UiAlert,
  UiBadge,
  UiButton,
  UiDialog,
  UiField,
  UiInput,
  UiSurface,
} from '@filipgutica/ui'

import { themeKey, type ThemePreference } from '../theme'

const theme = inject(themeKey)
if (!theme) throw new Error('Turnscope theme dependency was not provided')

const builtInThemes: ReadonlyArray<{ value: Exclude<ThemePreference, 'imported'>; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
const suggestions = ['Catppuccin', 'Dracula', 'Nord', 'Tokyo Night']
const searchDebounceMs = 300
const searchQuery = ref('')
const hasSearched = ref(false)
const hasImportFeedback = ref(false)
const isAddThemeOpen = ref(false)

const importedPreviewStyle = computed<Record<string, string>>(() => {
  const tokens = theme.importedTheme.value?.tokens
  if (!tokens) return {}
  return {
    '--theme-preview-bg': tokens.pageBackground,
    '--theme-preview-surface': tokens.surface,
    '--theme-preview-text': tokens.textPrimary,
    '--theme-preview-accent': tokens.accent,
  }
})

const themeStatusTone = computed(() => {
  if (theme.status.value?.tone === 'error') return 'error'
  if (theme.status.value?.tone === 'success') return 'success'
  return 'neutral'
})

const formatDownloads = (value: number): string => new Intl.NumberFormat(undefined, {
  notation: value >= 1_000 ? 'compact' : 'standard',
  maximumFractionDigits: 1,
}).format(value)

const openAddTheme = (): void => {
  hasImportFeedback.value = false
  isAddThemeOpen.value = true
}

const setAddThemeOpen = (open: boolean): void => {
  isAddThemeOpen.value = open
  if (open) hasImportFeedback.value = false
}

const runSearch = async (query: string): Promise<void> => {
  hasSearched.value = true
  await theme.searchOpenVsxThemes(query)
}

const debouncedSearch = useDebounceFn(runSearch, searchDebounceMs)

watch(searchQuery, (value) => {
  const query = value.trim()
  if (!query) {
    debouncedSearch.cancel()
    hasSearched.value = false
    void theme.searchOpenVsxThemes('')
    return
  }
  void debouncedSearch(query)
})

onBeforeUnmount(() => {
  debouncedSearch.cancel()
})

const searchSuggestion = (suggestion: string): void => {
  searchQuery.value = suggestion
}

const importLocalTheme = async (): Promise<void> => {
  hasImportFeedback.value = true
  await theme.importTheme()
  if (theme.status.value?.tone === 'success') isAddThemeOpen.value = false
}

const applyOpenVsxTheme = async (extensionId: string): Promise<void> => {
  hasImportFeedback.value = true
  await theme.importOpenVsxTheme(extensionId)
  if (theme.status.value?.tone === 'success') isAddThemeOpen.value = false
}
</script>
