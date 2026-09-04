import { inject, readonly, ref, type InjectionKey, type Ref } from 'vue'

import type { AnalyticsRange, CoverageValue } from '@shared/contracts'

export interface AnalyticsRangeState {
  range: Readonly<Ref<AnalyticsRange>>
  setRange: (range: AnalyticsRange) => void
}

export const analyticsRangeKey: InjectionKey<AnalyticsRangeState> = Symbol('analytics-range')

export const analyticsRangeOptions: { label: string; value: AnalyticsRange }[] = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: 'All time', value: 'all' },
]

export const createAnalyticsRange = (initialRange: AnalyticsRange = '30d'): AnalyticsRangeState => {
  const range = ref<AnalyticsRange>(initialRange)

  return {
    range: readonly(range),
    setRange: (value) => {
      range.value = value
    },
  }
}

export const useAnalyticsRange = (): AnalyticsRangeState => {
  const state = inject(analyticsRangeKey)
  if (!state) throw new Error('Analytics range was not provided')
  return state
}

export const formatCoverageRatio = (coverage: CoverageValue): string => coverage.ratio === null
  ? 'Not reported'
  : new Intl.NumberFormat(undefined, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(coverage.ratio)

export const formatCoverageCount = (coverage: CoverageValue): string =>
  `${new Intl.NumberFormat().format(coverage.numerator)} of ${new Intl.NumberFormat().format(coverage.denominator)}`

export const formatMilliseconds = (value: number | null): string => {
  if (value === null) return 'Not reported'
  if (value < 1_000) return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)} ms`

  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1_000)} s`
}
