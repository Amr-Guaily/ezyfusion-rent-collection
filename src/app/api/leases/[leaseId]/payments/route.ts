import { getCaller } from '@/lib/auth/getCaller'
import { json, parseId, readJsonBodyLenient, route } from '@/lib/http'
import { recordPayment } from '@/services/payments'

type Ctx = { params: Promise<{ leaseId: string }> }

// POST /api/leases/:leaseId/payments (staff, manager): 201 { id, status } | 400 | 401 | 403 | 404 | 422 over the cap
export const POST = route(async (req: Request, { params }: Ctx) => {
  const caller = await getCaller(req)
  const leaseId = parseId((await params).leaseId)
  // The service validates the body itself so it can remove an uploaded slip on any failure.
  const body = await readJsonBodyLenient(req)
  return json(await recordPayment(caller, leaseId, body), 201)
})
