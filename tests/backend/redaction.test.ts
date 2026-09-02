import { describe, expect, it } from 'vitest'

import { redactPayload, redactText } from '../../src/redaction.js'

describe('secret redaction', () => {
  it.each([
    'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'github_pat_abcdefghijklmnopqrstuvwxyz_1234567890',
    'xoxb-abcdefghijklmnopqrstuvwx',
    'AKIAIOSFODNN7EXAMPLE',
    'AIzaSyA12345678901234567890123456789012',
    'Bearer sanitized-token-value',
  ])('redacts token-shaped text: %s', (secret) => {
    expect(redactText(`token=${secret}`)).not.toContain(secret)
  })

  it.each([
    'client_secret',
    'refresh_token',
    'x-api-key',
    'cookie',
    'set-cookie',
    'authorization',
  ])('redacts the complete value for secret field %s', (key) => {
    expect(redactPayload({ [key]: 'sanitized-secret-value' })).toEqual({ [key]: '[REDACTED]' })
  })
})
