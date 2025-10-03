const requiredEnvKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

export type SupabaseEnvKey = (typeof requiredEnvKeys)[number]

export type SupabaseEnvConfig = {
  url: string
  anonKey: string
  functionsUrl: string
}

function getRequiredEnv(key: SupabaseEnvKey): string {
  const value = import.meta.env[key]
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

export const supabaseEnv: SupabaseEnvConfig = (() => {
  const baseUrl = normalizeUrl(getRequiredEnv('VITE_SUPABASE_URL'))
  const anonKey = getRequiredEnv('VITE_SUPABASE_ANON_KEY')

  return {
    url: baseUrl,
    anonKey,
    functionsUrl: `${baseUrl}/functions/v1`,
  }
})()
