// web/src/config/supabaseEnv.ts
const requiredSupabaseEnvKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

type RequiredSupabaseEnvKey = (typeof requiredSupabaseEnvKeys)[number]

type SupabaseEnvConfig = {
  url: string
  anonKey: string
}

function getRequiredEnv(key: RequiredSupabaseEnvKey): string {
  const value = import.meta.env[key]
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim().replace(/\/$/, '')
  }

  throw new Error(
    `[supabase-env] Missing required environment variable "${key}". ` +
      'Ensure the Supabase URL and anon key are configured for this deployment.'
  )
}

export const supabaseEnv: SupabaseEnvConfig = {
  url: getRequiredEnv('VITE_SUPABASE_URL'),
  anonKey: getRequiredEnv('VITE_SUPABASE_ANON_KEY'),
}

export type { SupabaseEnvConfig }
