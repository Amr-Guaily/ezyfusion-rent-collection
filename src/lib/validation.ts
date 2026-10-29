import { z } from 'zod'

// Request schemas (brief section 7). Amounts are integers in sen; z.int() also
// rejects unsafe integers. Calendar validity of dates is checked by billing.ts.

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export const createLeaseSchema = z.object({
  unitId: z.uuid(),
  tenantId: z.uuid(),
  startDate: dateString,
  endDate: dateString,
  monthlyRentSen: z.int().positive(),
  depositSen: z.int().nonnegative(),
})
export type CreateLeaseInput = z.infer<typeof createLeaseSchema>

export const recordPaymentSchema = z
  .object({
    amountSen: z.int().positive(),
    method: z.enum(['cash', 'bank_transfer']),
    // An instant with an explicit offset; a bare local time would be ambiguous.
    receivedAt: z.iso.datetime({ offset: true, local: false }),
    slipPath: z.string().min(1).max(512).optional(),
  })
  .refine((body) => body.method !== 'bank_transfer' || body.slipPath !== undefined, {
    path: ['slipPath'],
    message: 'A bank transfer needs a slip',
  })
  .refine((body) => body.method !== 'cash' || body.slipPath === undefined, {
    path: ['slipPath'],
    message: 'A cash payment has no slip',
  })
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

export const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters').max(1000),
})
