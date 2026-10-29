import { getCaller, requireManager } from '@/lib/auth/getCaller'
import { json, readJson, route } from '@/lib/http'
import { createLeaseSchema } from '@/lib/validation'
import { createLease } from '@/services/leases'

// POST /api/leases (manager): 201 { id } | 400 | 401 | 403 | 404 foreign unit/tenant | 409 overlap
export const POST = route(async (req: Request) => {
  const caller = await getCaller(req)
  requireManager(caller) // role before body: a staff member gets 403 whatever they send
  const input = await readJson(req, createLeaseSchema)
  const id = await createLease(caller, input)
  return json({ id }, 201)
})
