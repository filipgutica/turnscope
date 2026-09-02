import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCodexAdapter } from '../../src/adapters/codex.js'
import { closeDatabase, openDatabase } from '../../src/db.js'
import { importFromAdapter } from '../../src/importer.js'
import { createServer } from '../../src/server.js'

const closeCallbacks: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const close of closeCallbacks.splice(0).reverse()) await close()
})

const createImportedServer = async () => {
  const database = openDatabase({ path: ':memory:' })
  closeCallbacks.push(() => closeDatabase(database))
  const sourceRoot = join(import.meta.dirname, '../fixtures/codex')
  await importFromAdapter({
    database,
    adapter: createCodexAdapter({ sourceRoot }),
  })
  const server = createServer({ database, apiToken: 'fixture-token' })
  closeCallbacks.push(() => server.close())
  return { database, server }
}

describe('local API', () => {
  it('exposes project drill-down between the overview and a session', async () => {
    const { server } = await createImportedServer()
    const headers = { authorization: 'Bearer fixture-token' }
    const overview = await server.inject({ method: 'GET', url: '/api/overview', headers })
    const projectId = overview.json().projectRows[0].id as string

    const project = await server.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers,
    })

    expect(project.statusCode).toBe(200)
    expect(project.json()).toMatchObject({
      project: { id: projectId, sessionCount: 1 },
      sessions: { total: 1, rows: [{ repository: '/workspace/sanitized-project' }] },
    })
  })

  it('requires a bearer token and exposes drill-down evidence with redaction', async () => {
    const { server } = await createImportedServer()

    const unauthorized = await server.inject({ method: 'GET', url: '/api/overview' })
    expect(unauthorized.statusCode).toBe(401)

    const overview = await server.inject({
      method: 'GET',
      url: '/api/overview',
      headers: { authorization: 'Bearer fixture-token' },
    })
    expect(overview.statusCode).toBe(200)
    expect(overview.json().duration.evidence).toEqual([])
    const diagnostics = await server.inject({
      method: 'GET',
      url: '/api/diagnostics',
      headers: { authorization: 'Bearer fixture-token' },
    })
    expect(diagnostics.statusCode).toBe(200)
    expect(diagnostics.json()).toMatchObject({
      skillCoverage: { status: 'unavailable' },
      tokenCoverage: { totalSessions: 1 },
    })
    const projectId = overview.json().projectRows[0].id as string
    const project = await server.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers: { authorization: 'Bearer fixture-token' },
    })
    const sessionId = project.json().sessions.rows[0].id as string

    const detail = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
      headers: { authorization: 'Bearer fixture-token' },
    })
    expect(detail.statusCode).toBe(200)
    const timeline = detail.json().timeline.rows as { sourceOrder: number; sourceRecordId: string }[]
    expect(timeline.map(({ sourceOrder }) => sourceOrder)).toEqual(
      [...timeline].map(({ sourceOrder }) => sourceOrder).sort((left, right) => left - right),
    )

    const evidence = await server.inject({
      method: 'GET',
      url: `/api/evidence/${timeline[1]?.sourceRecordId}`,
      headers: { authorization: 'Bearer fixture-token' },
    })
    expect(evidence.statusCode).toBe(200)
    expect(evidence.body).not.toContain('sk-example-secret')
    expect(evidence.body).toContain('[REDACTED]')
  })

  it('deletes only imported installation data', async () => {
    const { database, server } = await createImportedServer()
    const installation = database
      .prepare('SELECT id FROM product_installations LIMIT 1')
      .get() as { id: string }

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/installations/${installation.id}`,
      headers: { authorization: 'Bearer fixture-token' },
    })

    expect(response.statusCode).toBe(204)
    expect(database.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM source_records').get()).toEqual({ count: 0 })
  })

  it('persists a user correction override and recomputes effective metrics', async () => {
    const { server } = await createImportedServer()
    const headers = { authorization: 'Bearer fixture-token' }
    const overview = await server.inject({ method: 'GET', url: '/api/overview', headers })
    const projectId = overview.json().projectRows[0].id as string
    const project = await server.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers })
    const sessionId = project.json().sessions.rows[0].id as string
    const detail = await server.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers })
    const correctionId = detail.json().corrections[0].id as string

    const update = await server.inject({
      method: 'PUT',
      url: `/api/corrections/${correctionId}`,
      headers,
      payload: { category: 'approval', countsAsCorrection: false },
    })
    expect(update.statusCode).toBe(204)

    const updatedOverview = await server.inject({ method: 'GET', url: '/api/overview', headers })
    expect(updatedOverview.json().corrections.value).toBe(0)
    expect(updatedOverview.json().correctionRate.value).toBe(0)
    const updatedDetail = await server.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
      headers,
    })
    expect(updatedDetail.json().corrections[0]).toMatchObject({
      inferredCategory: 'agent_mistake',
      category: 'approval',
      countsAsCorrection: false,
      hasUserOverride: true,
    })
  })

  it('lets the user add a missed correction and dismiss a diagnostic signal', async () => {
    const { server } = await createImportedServer()
    const headers = { authorization: 'Bearer fixture-token' }
    const overview = await server.inject({ method: 'GET', url: '/api/overview', headers })
    const projectId = overview.json().projectRows[0].id as string
    const project = await server.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers })
    const sessionId = project.json().sessions.rows[0].id as string
    const detail = await server.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers })
    const payload = detail.json()
    const missedUserEvent = payload.timeline.rows.find(
      (event: { actor: string; labels: string[] }) =>
        event.actor === 'user' && !event.labels.includes('correction'),
    ) as { id: string }

    const addCorrection = await server.inject({
      method: 'PUT',
      url: `/api/events/${missedUserEvent.id}/correction`,
      headers,
      payload: { category: 'clarification', countsAsCorrection: false },
    })
    expect(addCorrection.statusCode).toBe(204)

    const signalId = payload.signals[0].id as string
    const dismissSignal = await server.inject({
      method: 'PUT',
      url: `/api/signals/${signalId}`,
      headers,
      payload: { dismissed: true },
    })
    expect(dismissSignal.statusCode).toBe(204)

    const updated = await server.inject({ method: 'GET', url: `/api/sessions/${sessionId}`, headers })
    expect(updated.json().corrections).toContainEqual(expect.objectContaining({
      eventId: missedUserEvent.id,
      classificationMethod: 'user',
      category: 'clarification',
      countsAsCorrection: false,
    }))
    expect(updated.json().signals[0]).toMatchObject({ dismissed: true, hasUserOverride: true })
  })
})
