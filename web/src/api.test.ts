import { describe, expect, it, vi } from 'vitest'

import { consumeApiToken, createApiClient, selectApiClient } from './api'

describe('consumeApiToken', () => {
  it('returns the token once and removes it from browser history', () => {
    const replaceState = vi.fn()
    const location = {
      href: 'http://127.0.0.1:4177/?token=secret&view=overview#top',
    }

    expect(consumeApiToken({ location, history: { replaceState } })).toBe('secret')
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      'http://127.0.0.1:4177/?view=overview#top',
    )
  })

  it('does not change history when the token is absent', () => {
    const replaceState = vi.fn()

    expect(
      consumeApiToken({
        location: { href: 'http://127.0.0.1:4177/' },
        history: { replaceState },
      }),
    ).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('createApiClient', () => {
  it('uses the Electron bridge without constructing a browser client', () => {
    const electronApi = createApiClient({ token: 'unused' })
    const createBrowserApi = vi.fn(() => createApiClient({ token: null }))

    expect(selectApiClient({ electronApi, createBrowserApi })).toBe(electronApi)
    expect(createBrowserApi).not.toHaveBeenCalled()
  })

  it('uses a bearer token without persisting it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sessions: { value: 2 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const api = createApiClient({ token: 'secret', fetchImpl })

    await api.getOverview()

    expect(fetchImpl).toHaveBeenCalledWith('/api/overview', {
      headers: { Authorization: 'Bearer secret' },
    })
  })

  it('reports a useful server error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Import a session first' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const api = createApiClient({ token: null, fetchImpl })

    await expect(api.getOverview()).rejects.toThrow('Import a session first')
  })

  it('sends a correction override through the authenticated local API', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const api = createApiClient({ token: 'secret', fetchImpl })

    await api.updateCorrection('correction-1', {
      category: 'approval',
      countsAsCorrection: false,
    })

    expect(fetchImpl).toHaveBeenCalledWith('/api/corrections/correction-1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
      body: JSON.stringify({ category: 'approval', countsAsCorrection: false }),
    })
  })
})
