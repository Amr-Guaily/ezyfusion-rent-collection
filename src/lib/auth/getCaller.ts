import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db/prisma'
import { publicEnv } from '@/lib/env'
import { forbidden, unauthorized } from '@/lib/http'
import { createClient as createCookieClient } from '@/lib/supabase/server'

// Who is calling, from the database only. Roles come from memberships (staff and
// managers) or tenants.user_id (tenants), never from user_metadata or the request.
export type Caller =
  | { kind: 'manager' | 'staff'; userId: string; orgId: string }
  | { kind: 'tenant'; userId: string; tenantIds: string[] }

export type StaffCaller = Extract<Caller, { kind: 'manager' | 'staff' }>

/** Authenticates the request (Bearer access token or session cookie) and loads the caller. 401 if neither is valid. */
export async function getCaller(req: Request): Promise<Caller> {
  const userId = await authenticatedUserId(req)
  if (!userId) throw unauthorized()
  return loadCaller(userId)
}

async function authenticatedUserId(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization')
  if (header !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(header)
    if (!match) return null
    const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = publicEnv()
    const supabase = createSupabaseClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    // getUser verifies the token with the auth server (getSession would trust it blindly).
    const { data, error } = await supabase.auth.getUser(match[1])
    return error || !data.user ? null : data.user.id
  }
  const supabase = await createCookieClient()
  const { data, error } = await supabase.auth.getUser()
  return error || !data.user ? null : data.user.id
}

/** Loads the caller's role for an already-authenticated user id. Also used by the seed. */
export async function loadCaller(userId: string): Promise<Caller> {
  const membership = await prisma.memberships.findUnique({ where: { user_id: userId } })
  if (membership) return { kind: membership.role, userId, orgId: membership.org_id }
  const tenants = await prisma.tenants.findMany({ where: { user_id: userId }, select: { id: true } })
  if (tenants.length > 0) return { kind: 'tenant', userId, tenantIds: tenants.map((t) => t.id) }
  // A valid login with no role anywhere: authenticated, but allowed nothing.
  throw forbidden('No access')
}

export function isStaff(caller: Caller): caller is StaffCaller {
  return caller.kind === 'manager' || caller.kind === 'staff'
}

/** Can the caller see a record of this org / lease tenant? Callers that cannot get 404. */
export function canSee(caller: Caller, record: { org_id: string; tenant_id?: string }): boolean {
  if (isStaff(caller)) return record.org_id === caller.orgId
  return record.tenant_id !== undefined && caller.tenantIds.includes(record.tenant_id)
}

export function requireManager(caller: Caller): asserts caller is StaffCaller & { kind: 'manager' } {
  if (caller.kind !== 'manager') throw forbidden()
}

export function requireStaff(caller: Caller): asserts caller is StaffCaller {
  if (!isStaff(caller)) throw forbidden()
}
