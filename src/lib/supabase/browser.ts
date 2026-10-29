import { createBrowserClient } from '@supabase/ssr'

// Browser client: publishable key and the user's session only. RLS is the wall.
// NEXT_PUBLIC_* must be referenced literally so Next inlines them into the bundle.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
