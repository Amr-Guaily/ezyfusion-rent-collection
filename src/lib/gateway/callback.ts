import { badRequest } from '@/lib/http'
import { parseGatewayPaidAt } from '@/lib/myt'

/**
 * application/x-www-form-urlencoded body -> fields. Returns null when a key repeats:
 * the signature source would be ambiguous, so such a request cannot be verified.
 */
export function parseFormFields(raw: string): Record<string, string> | null {
  const fields: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(raw)) {
    if (Object.hasOwn(fields, key)) return null
    fields[key] = value
  }
  return fields
}

export interface ParsedCallback {
  billId: string
  paid: boolean
  paidAmountSen: bigint
  paidAt: Date | null
  transactionId: string
}

/** Validates a callback whose signature has already been verified. Error messages never echo values. */
export function parseCallback(fields: Record<string, string>): ParsedCallback {
  const billId = fields.id
  if (!billId) throw badRequest('id is required')
  if (fields.paid !== 'true' && fields.paid !== 'false') throw badRequest('paid must be true or false')
  const paid = fields.paid === 'true'
  const amount = fields.paid_amount ?? (paid ? undefined : '0')
  if (amount === undefined || !/^\d{1,15}$/.test(amount)) throw badRequest('paid_amount must be an integer in sen')
  let paidAt: Date | null = null
  if (paid) {
    try {
      paidAt = parseGatewayPaidAt(fields.paid_at ?? '')
    } catch {
      throw badRequest('paid_at must look like 2026-04-01 00:30:12 +0800')
    }
  }
  return { billId, paid, paidAmountSen: BigInt(amount), paidAt, transactionId: fields.transaction_id ?? '' }
}
