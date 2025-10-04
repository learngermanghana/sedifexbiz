import { supabaseEnv } from './config/supabaseEnv'
import { supabase } from './supabaseClient'

export type SupabaseFunctionInvokeOptions<Payload> = {
  payload?: Payload
  signal?: AbortSignal
  headers?: Record<string, string>
}

export type SupabaseFunctionInvokeResult<Result> = {
  data: Result | null
  error: Error | null
  status: number
}

function ensureFunctionsBaseUrl(): string {
  const { functionsUrl } = supabaseEnv
  if (!functionsUrl) {
    throw new Error('[supabase-functions] Missing Supabase functions URL configuration')
  }
  return functionsUrl
}

export function getSupabaseFunctionUrl(functionName: string): string {
  const baseUrl = ensureFunctionsBaseUrl()
  const normalized = functionName.replace(/^\/+/, '').trim()
  if (!normalized) {
    throw new Error('[supabase-functions] Function name is required')
  }
  return `${baseUrl}/${normalized}`
}

async function resolveAuthToken(): Promise<string> {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      console.warn('[supabase-functions] Failed to read auth session for functions request', error)
    } else if (data?.session?.access_token) {
      return data.session.access_token
    }
  } catch (error) {
    console.warn('[supabase-functions] Unexpected error while reading session', error)
  }

  return supabaseEnv.anonKey
}

function parseResponseBody<Result>(response: Response, rawBody: string): Result | null {
  if (!rawBody) {
    return null
  }

  const contentType = response.headers.get('content-type') ?? ''
  const shouldParseAsJson = contentType.includes('application/json')

  if (shouldParseAsJson) {
    try {
      return JSON.parse(rawBody) as Result
    } catch (error) {
      console.warn('[supabase-functions] Failed to parse JSON response', error)
      return null
    }
  }

  try {
    return JSON.parse(rawBody) as Result
  } catch {
    return rawBody as unknown as Result
  }
}

export async function invokeSupabaseFunction<Payload, Result>(
  functionName: string,
  options: SupabaseFunctionInvokeOptions<Payload> = {},
): Promise<SupabaseFunctionInvokeResult<Result>> {
  const url = getSupabaseFunctionUrl(functionName)
  const headers = new Headers(options.headers)

  headers.set('apikey', supabaseEnv.anonKey)
  const authToken = await resolveAuthToken()
  headers.set('authorization', `Bearer ${authToken}`)

  let body: string | undefined
  if (options.payload !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(options.payload)
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: options.signal,
    })

    const rawBody = response.status === 204 ? '' : await response.text()
    const data = parseResponseBody<Result>(response, rawBody)

    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : null) ?? `Supabase function ${functionName} responded with status ${response.status}`

      return { data, error: new Error(message), status: response.status }
    }

    return { data, error: null, status: response.status }
  } catch (error) {
    const normalizedError =
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')

    return { data: null, error: normalizedError, status: 0 }
  }
}
