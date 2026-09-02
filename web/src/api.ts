import type { InjectionKey } from 'vue'

import type { TurnscopeApi, TurnscopeImportApi } from '@shared/api'

import type {
  DiagnosticsResponse,
  OverviewResponse,
  PatternSignal,
  ProjectDetailResponse,
  ProjectSessionsQuery,
  SessionDetailResponse,
  SessionTimelineQuery,
  SourceEvidenceResponse,
} from '@shared/contracts'

export type ApiClient = TurnscopeApi & Partial<TurnscopeImportApi>

export const apiKey: InjectionKey<ApiClient> = Symbol('turnscope-api')

export const consumeApiToken = ({
  location,
  history,
}: {
  location: { href: string }
  history: { replaceState: (data: unknown, unused: string, url?: string | URL | null) => void }
}): string | null => {
  const url = new URL(location.href)
  const token = url.searchParams.get('token')

  if (token === null) {
    return null
  }

  url.searchParams.delete('token')
  history.replaceState(null, '', url.toString())
  return token
}

export const selectApiClient = ({
  electronApi,
  createBrowserApi,
}: {
  electronApi: ApiClient | undefined
  createBrowserApi: () => TurnscopeApi
}): ApiClient => electronApi ?? createBrowserApi()

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload: unknown = await response.json()
    if (typeof payload === 'object' && payload !== null) {
      if ('message' in payload && typeof payload.message === 'string') {
        return payload.message
      }
      if ('error' in payload && typeof payload.error === 'string') {
        return payload.error
      }
    }
  } catch {
    // A non-JSON response still has a useful HTTP status below.
  }

  return `Turnscope request failed (${response.status})`
}

const withQuery = (
  path: string,
  query: ProjectSessionsQuery | SessionTimelineQuery | undefined,
): string => {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `${path}?${encoded}` : path
}

export const createApiClient = ({
  token,
  fetchImpl = fetch,
}: {
  token: string | null
  fetchImpl?: typeof fetch
}): ApiClient => {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = {
      ...(init?.headers ?? {}),
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    }
    const response = await fetchImpl(path, { ...init, headers })

    if (!response.ok) {
      throw new Error(await getErrorMessage(response))
    }

    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  return {
    getDiagnostics: () => request<DiagnosticsResponse>('/api/diagnostics'),
    getOverview: () => request<OverviewResponse>('/api/overview'),
    getProject: (projectId, query) =>
      request<ProjectDetailResponse>(withQuery(
        `/api/projects/${encodeURIComponent(projectId)}`,
        query,
      )),
    getSession: (sessionId, query) =>
      request<SessionDetailResponse>(withQuery(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        query,
      )),
    getPatterns: () => request<PatternSignal[]>('/api/patterns'),
    getEvidence: (sourceRecordId) =>
      request<SourceEvidenceResponse>(
        `/api/evidence/${encodeURIComponent(sourceRecordId)}`,
      ),
    updateCorrection: (correctionId, override) => request<void>(
      `/api/corrections/${encodeURIComponent(correctionId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override),
      },
    ),
    createCorrection: (eventId, override) => request<void>(
      `/api/events/${encodeURIComponent(eventId)}/correction`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override),
      },
    ),
    updateSignal: (signalId, override) => request<void>(
      `/api/signals/${encodeURIComponent(signalId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override),
      },
    ),
  }
}
