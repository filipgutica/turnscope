import { describe, expect, it } from 'vitest'

import { formatDate } from './format'

describe('formatDate', () => {
  it('keeps missing and invalid source timestamps explicit', () => {
    expect(formatDate(null)).toBe('Not reported')
    expect(formatDate('not-a-source-timestamp')).toBe('Invalid source timestamp')
  })
})
