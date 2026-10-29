import { serverEnv } from '@/lib/env'
import { parseCallback, parseFormFields } from '@/lib/gateway/callback'
import { verifySignature } from '@/lib/gateway/signature'
import { errorJson, json, route } from '@/lib/http'
import { applyGatewayCallback } from '@/services/gatewayBills'

// POST /api/webhooks/gateway (brief section 5). Only this route can settle a bill.
//   401 signature missing or wrong | 404 unknown bill | 422 paid=true with the wrong amount
//   200 otherwise (settled, failed, or a repeat / late delivery that changes nothing)
// Never logs the key or the payload: errors go through toErrorResponse, which logs messages only.
export const POST = route(async (req: Request) => {
  const raw = await req.text() // raw body, decoded exactly once; the signature covers the decoded field values
  const fields = parseFormFields(raw)
  if (!fields || !verifySignature(fields, serverEnv().GATEWAY_X_SIGNATURE_KEY)) {
    return errorJson(401, 'Invalid signature')
  }
  const outcome = await applyGatewayCallback(parseCallback(fields))
  return json({ ok: true, outcome })
})
