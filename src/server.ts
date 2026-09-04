import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'

import type { AnalyticsRangeQuery, ProjectSessionsQuery, SessionTimelineQuery } from '../shared/contracts.js'
import { deleteInstallationData, type TurnscopeDatabase } from './db.js'
import { createLocalApi, LocalApiError } from './local-api.js'

interface PageQuerystring {
  offset?: string
  limit?: string
  search?: string
  issue?: string
  actor?: string
  eventId?: string
  range?: string
}

const analyticsPageQuery = (query: PageQuerystring): AnalyticsRangeQuery => {
  if (query.range !== undefined && query.range !== '7d' && query.range !== '30d' && query.range !== 'all') {
    throw new LocalApiError('Invalid analytics range', 400)
  }
  return query.range ? { range: query.range } : {}
}

const commonPageQuery = (query: PageQuerystring) => ({
  ...(query.offset === undefined ? {} : { offset: Number(query.offset) }),
  ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
  ...(query.search === undefined ? {} : { search: query.search }),
})

const projectPageQuery = (query: PageQuerystring): ProjectSessionsQuery => {
  if (query.issue !== undefined && query.issue !== 'corrections' && query.issue !== 'errors') {
    throw new LocalApiError('Invalid issue filter', 400)
  }
  return { ...commonPageQuery(query), ...(query.issue ? { issue: query.issue } : {}) }
}

const timelinePageQuery = (query: PageQuerystring): SessionTimelineQuery => {
  if (query.actor !== undefined
    && query.actor !== 'user'
    && query.actor !== 'agent'
    && query.actor !== 'tool'
    && query.actor !== 'system') {
    throw new LocalApiError('Invalid actor filter', 400)
  }
  return {
    ...commonPageQuery(query),
    ...(query.actor ? { actor: query.actor } : {}),
    ...(query.eventId ? { eventId: query.eventId } : {}),
  }
}

const bearerToken = (authorization: string | undefined): string | null => {
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice('Bearer '.length)
}

export const createServer = ({
  database,
  apiToken,
  staticRoot,
}: {
  database: TurnscopeDatabase
  apiToken: string
  staticRoot?: string
}): FastifyInstance => {
  const server = Fastify({ logger: false })
  const api = createLocalApi({ database })

  server.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof LocalApiError) {
      return reply.code(error.statusCode).send({ error: error.message })
    }
    return reply.send(error)
  })

  server.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || request.url === '/api/health') return
    if (bearerToken(request.headers.authorization) !== apiToken) {
      await reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  server.get('/api/health', async () => ({ status: 'ok' }))
  server.get('/api/diagnostics', async () => api.getDiagnostics())
  server.get<{ Querystring: PageQuerystring }>('/api/overview', async (request) =>
    api.getOverview(analyticsPageQuery(request.query)))
  server.get<{ Querystring: PageQuerystring }>('/api/tool-health', async (request) =>
    api.getToolHealth(analyticsPageQuery(request.query)))
  server.get('/api/patterns', async () => api.getPatterns())
  server.get<{ Params: { id: string }; Querystring: PageQuerystring }>(
    '/api/projects/:id',
    async (request) => api.getProject(request.params.id, projectPageQuery(request.query)),
  )
  server.get<{ Params: { id: string }; Querystring: PageQuerystring }>(
    '/api/sessions/:id',
    async (request) => api.getSession(request.params.id, timelinePageQuery(request.query)),
  )
  server.get<{ Params: { id: string } }>('/api/evidence/:id', async (request) =>
    api.getEvidence(request.params.id))
  server.put<{ Params: { id: string }; Body: Parameters<typeof api.updateCorrection>[1] }>(
    '/api/corrections/:id',
    async (request, reply) => {
      await api.updateCorrection(request.params.id, request.body)
      return reply.code(204).send()
    },
  )
  server.put<{ Params: { id: string }; Body: Parameters<typeof api.createCorrection>[1] }>(
    '/api/events/:id/correction',
    async (request, reply) => {
      await api.createCorrection(request.params.id, request.body)
      return reply.code(204).send()
    },
  )
  server.put<{ Params: { id: string }; Body: Parameters<typeof api.updateSignal>[1] }>(
    '/api/signals/:id',
    async (request, reply) => {
      await api.updateSignal(request.params.id, request.body)
      return reply.code(204).send()
    },
  )
  server.delete<{ Params: { id: string } }>('/api/installations/:id', async (request, reply) => {
    const deleted = deleteInstallationData({ database, installationId: request.params.id })
    if (!deleted) return reply.code(404).send({ error: 'Installation not found' })
    return reply.code(204).send()
  })

  const webRoot = staticRoot ?? resolve(process.cwd(), 'web-dist')
  if (existsSync(webRoot)) {
    void server.register(fastifyStatic, { root: webRoot, wildcard: false })
    server.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' })
      return reply.sendFile('index.html')
    })
  }

  return server
}
