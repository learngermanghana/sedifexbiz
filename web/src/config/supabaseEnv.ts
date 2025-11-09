import runtimeEnv from './runtimeEnv'

const requiredEnvKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const
const optionalEnvKeys = ['VITE_SUPABASE_FUNCTIONS_URL'] as const

export type SupabaseEnvKey = (typeof requiredEnvKeys)[number]
type OptionalSupabaseEnvKey = (typeof optionalEnvKeys)[number]

export type SupabaseEnvConfig = {
  url: string
  anonKey: string
  functionsUrl: string
}

function getRequiredEnv(key: SupabaseEnvKey): string {
  const value = runtimeEnv[key]
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  throw new Error(
    `[supabase-env] Missing required environment variable "${key}". ` +
      'Ensure this value is configured for your deployment.',
  )
}

function normalizeUrl(value: string): string {
  return value.replace(/\/?$/, '')
}

function getOptionalEnv(key: OptionalSupabaseEnvKey): string | null {
  const value = runtimeEnv[key]
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export const supabaseEnv: SupabaseEnvConfig = (() => {
  const baseUrl = normalizeUrl(getRequiredEnv('VITE_SUPABASE_URL'))
  const anonKey = getRequiredEnv('VITE_SUPABASE_ANON_KEY')
  const overrideFunctionsUrl = getOptionalEnv('VITE_SUPABASE_FUNCTIONS_URL')
  const functionsBase = overrideFunctionsUrl ?? `${baseUrl}/functions/v1`

  return {
    url: baseUrl,
    anonKey,
    functionsUrl: normalizeUrl(functionsBase),
  }
})()
