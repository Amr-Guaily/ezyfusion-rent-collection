import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

// Secret-key client: bypasses RLS. Server code only (route handlers, services, seed).
// Used for the auth admin API, signed slip URLs and removing orphaned slips.
export function createAdminClient() {
  const env = serverEnv()
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const SLIP_BUCKET = 'payment-slips'
