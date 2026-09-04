import { cpSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createCodexAdapter, normalizeCodexToolCategory, stripInjectedUserContent } from '../../src/adapters/codex.js'

describe('Codex tool aliases', () => {
  it('maps observed provider aliases to stable semantic categories', () => {
    expect(['command', 'exec_command'].map(normalizeCodexToolCategory))
      .toEqual(['terminal', 'terminal'])
    expect(normalizeCodexToolCategory('exec')).toBe('terminal')
    expect(['apply_patch', 'patch_apply', 'write_file'].map(normalizeCodexToolCategory))
      .toEqual(['file_change', 'file_change', 'file_change'])
    expect(['rg', 'grep', 'search'].map(normalizeCodexToolCategory))
      .toEqual(['search', 'search', 'search'])
    expect(normalizeCodexToolCategory('mcp__server__tool')).toBe('mcp')
    expect(['spawn_agent', 'send_message', 'wait_agent'].map(normalizeCodexToolCategory))
      .toEqual(['subagent', 'subagent', 'subagent'])
    expect(normalizeCodexToolCategory('provider_specific_tool')).toBe('other')
  })
})

describe('Codex injected content', () => {
  it('removes path-qualified AGENTS headings and instruction bodies', () => {
    expect(stripInjectedUserContent(
      '# AGENTS.md instructions for /workspace\n<INSTRUCTIONS>Wrong: revert this.</INSTRUCTIONS>\nWhat tests did you run?',
    )).toBe('What tests did you run?')
  })
})

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
