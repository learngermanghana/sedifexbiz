// web/src/supabaseClient.ts
import { supabaseEnv } from './config/supabaseEnv'

type SupabaseRequestOptions = RequestInit & {
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined>
}

function buildSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined> | undefined,
): string {
  if (!params) {
    return ''
  }

  if (params instanceof URLSearchParams) {
    const serialized = params.toString()
    return serialized ? `?${serialized}` : ''
  }

  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          searchParams.append(key, entry)
        }
      }
    } else if (typeof value === 'string') {
      searchParams.set(key, value)
    }
  }

  const serialized = searchParams.toString()
  return serialized ? `?${serialized}` : ''
}

async function supabaseRequest(path: string, options: SupabaseRequestOptions = {}) {
  const headers = new Headers(options.headers)
  headers.set('apikey', supabaseEnv.anonKey)
  headers.set('Authorization', `Bearer ${supabaseEnv.anonKey}`)

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const search = buildSearchParams(options.searchParams)
  const response = await fetch(`${supabaseEnv.url}${path}${search}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const payload = await response.json()
      if (payload && typeof payload.error === 'string') {
        message = payload.error
      } else if (payload && typeof payload.message === 'string') {
        message = payload.message
      }
    } catch {
      // Ignore JSON parsing errors and fall back to status text.
    }
    throw new Error(`[supabase] ${message}`)
  }

  return response
}

export async function callSupabaseRpc<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  const response = await supabaseRequest(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args ?? {}),
  })

  if (response.status === 204) {
    return null
  }

  const data = (await response.json()) as T | null
  return data
}

export async function querySupabase<T>(
  resource: string,
  params?: URLSearchParams | Record<string, string | string[] | undefined>,
): Promise<T[]> {
  const response = await supabaseRequest(`/rest/v1/${resource}`, {
    method: 'GET',
    searchParams: params,
    headers: {
      Prefer: 'return=representation',
    },
  })

  const data = (await response.json()) as T[] | null
  return Array.isArray(data) ? data : []
}
