import { supabaseAdmin } from './firestore'

export type EdgeFunctionContext = {
  requestId?: string
  user?: {
    id: string
    email?: string | null
    app_metadata?: Record<string, unknown>
  } | null
  headers?: Record<string, string>
}

const MAX_SANITIZE_DEPTH = 4
const MAX_ARRAY_SAMPLE = 5
const MAX_OBJECT_KEYS = 25

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth >= MAX_SANITIZE_DEPTH) {
    return '[max-depth]'
  }

  if (value === null) return 'null'

  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return valueType
  }

  if (valueType === 'bigint') return 'bigint'
  if (valueType === 'undefined') return 'undefined'
  if (valueType === 'symbol') return 'symbol'
  if (valueType === 'function') return 'function'

  if (Array.isArray(value)) {
    if (depth + 1 >= MAX_SANITIZE_DEPTH) {
      return { __type: 'array', length: value.length }
    }

    const samples = value.slice(0, MAX_ARRAY_SAMPLE).map(entry => sanitizePayload(entry, depth + 1))
    if (value.length > MAX_ARRAY_SAMPLE) {
      samples.push(`[+${value.length - MAX_ARRAY_SAMPLE} more]`)
    }
    return samples
  }

  if (value instanceof Date) {
    return 'date'
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS)
    const result: Record<string, unknown> = {}
    for (const [key, entry] of entries) {
      result[key] = sanitizePayload(entry, depth + 1)
    }
    if (Object.keys(value).length > MAX_OBJECT_KEYS) {
      result.__truncatedKeys = Object.keys(value).length - MAX_OBJECT_KEYS
    }
    return result
  }

  if (value && typeof value === 'object') {
    const constructorName = value.constructor?.name ?? 'object'
    return constructorName
  }

  return valueType
}

export function deriveStoreIdFromContext(context: EdgeFunctionContext): string | null {
  const metadata = (context.user?.app_metadata ?? {}) as Record<string, unknown>
  const candidateKeys = ['activeStoreId', 'storeId', 'store_id', 'store', 'sid']
  for (const key of candidateKeys) {
    const raw = metadata?.[key]
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed) return trimmed
    }
  }
  return null
}

export type CallableErrorLogInput<T> = {
  route: string
  context: EdgeFunctionContext
  data: T
  error: unknown
  storeId?: string | null
}

function sanitizeError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : String(error) }
  }

  const result: Record<string, unknown> = {}
  const payload = error as Record<string, unknown>

  const message = payload.message
  if (typeof message === 'string' && message.trim()) {
    result.message = message
  }

  const code = payload.code
  if (typeof code === 'string' && code.trim()) {
    result.code = code
  }

  const status = payload.status
  if (typeof status === 'string' && status.trim()) {
    result.status = status
  }

  if ('details' in payload && payload.details !== undefined) {
    result.details = sanitizePayload(payload.details)
  }

  if (!('message' in result)) {
    result.message = String(error)
  }

  return result
}

export async function logCallableError<T>({
  route,
  context,
  data,
  error,
  storeId,
}: CallableErrorLogInput<T>): Promise<void> {
  const payload = {
    route,
    store_id: storeId ?? deriveStoreIdFromContext(context),
    user_id: context.user?.id ?? null,
    payload_shape: sanitizePayload(data),
    error: sanitizeError(error),
    request_id: context.requestId ?? null,
  }

  const { error: insertError } = await supabaseAdmin
    .from('callable_error_events')
    .insert(payload)

  if (insertError) {
    console.error('[telemetry] Failed to record callable error', insertError)
  }
}
