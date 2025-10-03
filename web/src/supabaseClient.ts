import { createClient } from '@supabase/supabase-js'

import { supabaseEnv } from './config/supabaseEnv'

export const supabase = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
