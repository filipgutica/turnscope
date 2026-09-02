const fullSecretPatterns: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
]

const assignedSecretPattern = /((?:(?:api|access|refresh|client)[_-]?(?:key|token|secret)|authorization|cookie|password|secret|x-api-key)\s*[=:]\s*["']?)[^\s,"']+/gi
const secretKeyPattern = /^(?:(?:api|access|refresh|client)[_-]?(?:key|token|secret)|authorization|cookie|set-cookie|password|secret|x-api-key)$/i

export const redactText = (value: string): string => {
  const fullyRedacted = fullSecretPatterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, '[REDACTED]'),
    value,
  )
  return fullyRedacted.replace(assignedSecretPattern, '$1[REDACTED]')
}

const redactValue = (value: unknown): unknown => {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        secretKeyPattern.test(key) ? '[REDACTED]' : redactValue(entry),
      ]),
    )
  }
  return value
}

export const redactPayload = (value: unknown): unknown => redactValue(value)
