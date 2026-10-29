import { getCaller } from '@/lib/auth/getCaller'
import { json, parseId, route } from '@/lib/http'
import { createGatewayBill } from '@/services/gatewayBills'

type Ctx = { params: Promise<{ leaseId: string }> }

// POST /api/leases/:leaseId/gateway-bills (the lease's tenant): 201 { billId, amountSen } | 401 | 403 | 404 | 422 nothing due
export const POST = route(async (req: Request, { params }: Ctx) => {
  const caller = await getCaller(req)
  const leaseId = parseId((await params).leaseId)
  return json(await createGatewayBill(caller, leaseId), 201)
})
