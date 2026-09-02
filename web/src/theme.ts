import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export const resolveTheme = ({
  preference,
  systemDark,
}: {
  preference: ThemePreference
  systemDark: boolean
}): ResolvedTheme => preference === 'system'
  ? systemDark ? 'dark' : 'light'
  : preference

export const applyTheme = ({
  root,
  theme,
}: {
  root: { classList: { toggle: (name: string, enabled: boolean) => unknown } }
  theme: ResolvedTheme
}): void => {
  root.classList.toggle('dark', theme === 'dark')
}

const storedPreference = (): ThemePreference => {
  const value = localStorage.getItem('turnscope-theme')
  return value === 'light' || value === 'dark' ? value : 'system'
}

export const useTheme = () => {
  const preference = ref<ThemePreference>(storedPreference())
  const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const theme = computed(() => resolveTheme({ preference: preference.value, systemDark: systemDark.value }))
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handleSystemChange = (event: MediaQueryListEvent): void => {
    systemDark.value = event.matches
  }

  watch(theme, (value) => applyTheme({ root: document.documentElement, theme: value }), {
    immediate: true,
  })
  watch(preference, (value) => {
    if (value === 'system') localStorage.removeItem('turnscope-theme')
    else localStorage.setItem('turnscope-theme', value)
  })
  onMounted(() => media.addEventListener('change', handleSystemChange))
  onUnmounted(() => media.removeEventListener('change', handleSystemChange))

  return { preference, theme }
}
