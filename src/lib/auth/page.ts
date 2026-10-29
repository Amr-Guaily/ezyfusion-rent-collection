import { redirect } from 'next/navigation'
import { DomainError } from '@/lib/http'
import { createClient } from '@/lib/supabase/server'
import { loadCaller, type Caller } from './getCaller'

/**
 * For server components: the signed-in caller, from the session cookie verified with
 * getUser() and the role loaded from the database (same rules as getCaller). Pages are
 * not the security boundary (the API routes and RLS are) but they never render data
 * for the wrong person either.
 */
export async function requirePageCaller(): Promise<Caller & { email: string }> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) redirect('/login')
  let caller: Caller
  try {
    caller = await loadCaller(data.user.id)
  } catch (error) {
    if (error instanceof DomainError) redirect('/login?error=no-access')
    throw error
  }
  return { ...caller, email: data.user.email ?? '' }
}
