import { describe, expect, it } from 'vitest'
import { DomainError } from '@/lib/http'
import { parseCallback, parseFormFields } from './callback'

describe('parseFormFields', () => {
  it('decodes form encoding, including spaces and +', () => {
    expect(parseFormFields('id=bill_1&paid_at=2026-04-01+00%3A30%3A12+%2B0800&extra=a%7Cb')).toEqual({
      id: 'bill_1',
      paid_at: '2026-04-01 00:30:12 +0800',
      extra: 'a|b',
    })
  })

  it('refuses repeated keys', () => {
    expect(parseFormFields('id=bill_1&paid=true&paid=false')).toBeNull()
  })
})

describe('parseCallback', () => {
  const paid = { id: 'bill_1', paid: 'true', paid_amount: '210050', paid_at: '2026-04-01 00:30:12 +0800', transaction_id: 'TX-1' }

  it('parses a paid callback; received_at will be paid_at', () => {
    expect(parseCallback(paid)).toEqual({
      billId: 'bill_1',
      paid: true,
      paidAmountSen: 210050n,
      paidAt: new Date('2026-03-31T16:30:12.000Z'),
      transactionId: 'TX-1',
    })
  })

  it('does not need paid_at when not paid', () => {
    expect(parseCallback({ id: 'bill_1', paid: 'false', paid_amount: '0' }).paidAt).toBeNull()
  })

  it.each([
    [{ ...paid, id: '' }],
    [{ ...paid, paid: 'yes' }],
    [{ ...paid, paid_amount: '2100.50' }],
    [{ ...paid, paid_amount: '-1' }],
    [{ ...paid, paid_at: '2026-04-01T00:30:12+08:00' }],
  ])('rejects %j with a 400', (fields) => {
    expect(() => parseCallback(fields)).toThrow(DomainError)
  })
})
