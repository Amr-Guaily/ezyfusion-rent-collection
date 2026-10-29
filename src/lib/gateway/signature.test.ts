import { describe, expect, it } from 'vitest'
import { computeSignature, signatureSource, verifySignature } from './signature'

const KEY = 'test_x_signature_key'
const FIELDS = {
  id: 'bill_8f3a2c',
  paid: 'true',
  paid_amount: '210050',
  paid_at: '2026-04-01 00:30:12 +0800',
  transaction_id: 'TX-000123',
  transaction_status: 'completed',
}
const VECTOR = '06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641'

describe('gateway signature', () => {
  it('matches the brief test vector', () => {
    expect(signatureSource(FIELDS)).toBe(
      'idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted',
    )
    expect(computeSignature(FIELDS, KEY)).toBe(VECTOR)
  })

  it('ignores x_signature and key order when signing', () => {
    const shuffled = Object.fromEntries([['x_signature', 'whatever'], ...Object.entries(FIELDS).reverse()])
    expect(computeSignature(shuffled, KEY)).toBe(VECTOR)
  })

  it('includes fields the gateway adds in future', () => {
    expect(computeSignature({ ...FIELDS, currency: 'MYR' }, KEY)).not.toBe(VECTOR)
  })

  it('accepts the right signature', () => {
    expect(verifySignature({ ...FIELDS, x_signature: VECTOR }, KEY)).toBe(true)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong', VECTOR.replace(/^0/, '1')],
    ['uppercase', VECTOR.toUpperCase()],
    ['truncated', VECTOR.slice(0, 63)],
    ['too long', `${VECTOR}00`],
    ['not hex', 'z'.repeat(64)],
  ])('rejects a %s signature', (_label, signature) => {
    const fields: Record<string, string> = { ...FIELDS }
    if (signature !== undefined) fields.x_signature = signature
    expect(verifySignature(fields, KEY)).toBe(false)
  })

  it('rejects a tampered field and a different key', () => {
    expect(verifySignature({ ...FIELDS, paid_amount: '210051', x_signature: VECTOR }, KEY)).toBe(false)
    expect(verifySignature({ ...FIELDS, x_signature: VECTOR }, 'other_key')).toBe(false)
  })
})
