import { getCaller } from '@/lib/auth/getCaller'
import { json, parseId, readJsonBodyLenient, route } from '@/lib/http'
import { voidPayment } from '@/services/payments'

type Ctx = { params: Promise<{ paymentId: string }> }

// POST /api/payments/:paymentId/void (manager: 200 { status } | 400 missing reason | 401 | 403 | 404 | 409 not approved)
export const POST = route(async (req: Request, { params }: Ctx) => {
  const caller = await getCaller(req)
  const paymentId = parseId((await params).paymentId)
  return json(await voidPayment(caller, paymentId, await readJsonBodyLenient(req)))
})
