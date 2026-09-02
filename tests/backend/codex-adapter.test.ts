import { cpSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createCodexAdapter } from '../../src/adapters/codex.js'

describe('Codex product discovery', () => {
  it('uses the newest observed session version instead of the oldest archive', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'turnscope-discovery-'))
    cpSync(join(import.meta.dirname, '../fixtures/codex'), sourceRoot, { recursive: true })
    const fixturePath = join(sourceRoot, 'sessions/2026/08/31/rollout-fixture.jsonl')
    writeFileSync(
      fixturePath,
      readFileSync(fixturePath, 'utf8').replaceAll('0.152.1', '0.104.0'),
    )

    const newestPath = join(sourceRoot, 'sessions/rollout-newest.jsonl')
    writeFileSync(
      newestPath,
      readFileSync(fixturePath, 'utf8').replaceAll('0.104.0', '0.152.1'),
    )
    utimesSync(fixturePath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    utimesSync(newestPath, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))

    const discovery = await createCodexAdapter({ sourceRoot }).discover()

    expect(discovery.productVersion).toBe('0.152.1')
    expect(discovery.compatibility).toBe('warning')
    expect(discovery.warning).toContain('undocumented local format')
  })
})
