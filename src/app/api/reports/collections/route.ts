import { getCaller, requireStaff } from '@/lib/auth/getCaller'
import { json, route } from '@/lib/http'
import { collectionsQuerySchema } from '@/lib/validation'
import { collectionsReport } from '@/services/reports'

// GET /api/reports/collections?from=YYYY-MM&to=YYYY-MM (staff, manager): 200 [{ month, collectedSen }] | 400 | 401 | 403
export const GET = route(async (req: Request) => {
  const caller = await getCaller(req)
  requireStaff(caller)
  const params = new URL(req.url).searchParams
  const { from, to } = collectionsQuerySchema.parse({ from: params.get('from') ?? undefined, to: params.get('to') ?? undefined })
  return json(await collectionsReport(caller, from, to))
})
