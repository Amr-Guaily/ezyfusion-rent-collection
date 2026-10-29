import { getCaller } from '@/lib/auth/getCaller'
import { json, parseId, route } from '@/lib/http'
import { approvePayment } from '@/services/payments'

type Ctx = { params: Promise<{ paymentId: string }> }

// POST /api/payments/:paymentId/approve (manager: 200 { status } | 401 | 403 | 404 | 409 not pending | 422 over the remaining balance)
export const POST = route(async (req: Request, { params }: Ctx) => {
  const caller = await getCaller(req)
  const paymentId = parseId((await params).paymentId)
  return json(await approvePayment(caller, paymentId))
})
