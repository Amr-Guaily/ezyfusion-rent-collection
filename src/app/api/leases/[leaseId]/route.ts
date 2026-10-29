import { getCaller } from '@/lib/auth/getCaller'
import { json, parseId, route } from '@/lib/http'
import { getLease } from '@/services/leases'

type Ctx = { params: Promise<{ leaseId: string }> }

// GET /api/leases/:leaseId (staff, manager, the lease's tenant): 200 | 401 | 404
export const GET = route(async (req: Request, { params }: Ctx) => {
  const caller = await getCaller(req)
  const leaseId = parseId((await params).leaseId)
  return json(await getLease(caller, leaseId))
})
