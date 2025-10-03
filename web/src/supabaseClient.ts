import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js'
import { supabaseEnv } from './config/supabaseEnv'

export const supabase = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export type { Session, SupabaseClient, User }
