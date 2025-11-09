import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionMock = vi.fn(async () => ({ data: { session: null }, error: null }))

vi.mock('../config/supabaseEnv', () => ({
  supabaseEnv: {
    url: 'https://demo.supabase.co',
    anonKey: 'anon-key',
    functionsUrl: 'https://demo.supabase.co/functions/v1',
  },
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}))

describe('supabaseFunctionsClient', () => {
  const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
  let invokeSupabaseFunction: (typeof import('../supabaseFunctionsClient'))['invokeSupabaseFunction']
  let getSupabaseFunctionUrl: (typeof import('../supabaseFunctionsClient'))['getSupabaseFunctionUrl']

  beforeEach(async () => {
    vi.resetModules()
    getSessionMock.mockClear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    ;({ invokeSupabaseFunction, getSupabaseFunctionUrl } = await import('../supabaseFunctionsClient'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds function URLs using the configured base path', () => {
    expect(getSupabaseFunctionUrl('syncInventory')).toBe(
      'https://demo.supabase.co/functions/v1/syncInventory',
    )
  })

  it('includes the session access token when available', async () => {
    getSessionMock.mockResolvedValueOnce({
      data: { session: { access_token: 'session-token' } },
      error: null,
    })

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await invokeSupabaseFunction('manageStaff', {
      payload: { value: 42 },
    })

    expect(result.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://demo.supabase.co/functions/v1/manageStaff')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer session-token')
    expect(headers.get('apikey')).toBe('anon-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(init?.body).toBe(JSON.stringify({ value: 42 }))
  })

  it('falls back to the anon key when no session is available', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await invokeSupabaseFunction('afterSignup', {})

    expect(result.error).toBeNull()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer anon-key')
  })
})
