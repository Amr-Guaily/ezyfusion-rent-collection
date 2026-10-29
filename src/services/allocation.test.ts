import { describe, expect, it } from 'vitest'
import { planAllocation, type AllocatableInvoice } from './allocation'

const inv = (
  id: string,
  kind: 'deposit' | 'rent',
  dueDate: string,
  periodIndex: number | null,
  amountSen: bigint,
  paidSen = 0n,
): AllocatableInvoice => ({ id, kind, dueDate, periodIndex, amountSen, paidSen })

// Aisyah's schedule (brief section 3).
const aisyah = [
  inv('r5', 'rent', '2026-06-30', 5, 77419n),
  inv('r1', 'rent', '2026-02-28', 1, 150000n),
  inv('r0', 'rent', '2026-01-31', 0, 150000n),
  inv('dep', 'deposit', '2026-01-31', null, 300000n),
  inv('r2', 'rent', '2026-03-31', 2, 150000n),
  inv('r3', 'rent', '2026-04-30', 3, 150000n),
  inv('r4', 'rent', '2026-05-31', 4, 150000n),
]

describe('planAllocation', () => {
  it('fills the deposit before rent due the same day (seed cash RM 3,000)', () => {
    expect(planAllocation(aisyah, 300000n)).toEqual({
      allocations: [{ invoiceId: 'dep', amountSen: 300000n }],
      unappliedSen: 0n,
    })
  })

  it('then fills period 0 and part of period 1 (seed transfer RM 2,000)', () => {
    const afterCash = aisyah.map((i) => (i.id === 'dep' ? { ...i, paidSen: 300000n } : i))
    expect(planAllocation(afterCash, 200000n)).toEqual({
      allocations: [
        { invoiceId: 'r0', amountSen: 150000n },
        { invoiceId: 'r1', amountSen: 50000n },
      ],
      unappliedSen: 0n,
    })
  })

  it('tops up a partially paid invoice and skips paid ones', () => {
    const invoices = [inv('a', 'rent', '2026-01-01', 0, 1000n, 1000n), inv('b', 'rent', '2026-02-01', 1, 1000n, 400n), inv('c', 'rent', '2026-03-01', 2, 1000n)]
    expect(planAllocation(invoices, 900n).allocations).toEqual([
      { invoiceId: 'b', amountSen: 600n },
      { invoiceId: 'c', amountSen: 300n },
    ])
  })

  it('pays invoices that are not due yet and leaves the rest unapplied', () => {
    const invoices = [inv('a', 'rent', '2099-01-01', 0, 1000n), inv('b', 'rent', '2099-02-01', 1, 1000n)]
    expect(planAllocation(invoices, 2500n)).toEqual({
      allocations: [
        { invoiceId: 'a', amountSen: 1000n },
        { invoiceId: 'b', amountSen: 1000n },
      ],
      unappliedSen: 500n,
    })
  })

  it('skips zero-sen invoices', () => {
    const invoices = [inv('zero', 'rent', '2026-01-01', 0, 0n), inv('b', 'rent', '2026-02-01', 1, 100n)]
    expect(planAllocation(invoices, 100n).allocations).toEqual([{ invoiceId: 'b', amountSen: 100n }])
  })

  it('orders by due date before kind (a later deposit comes after earlier rent)', () => {
    const invoices = [inv('dep', 'deposit', '2026-02-01', null, 100n), inv('r0', 'rent', '2026-01-01', 0, 100n)]
    expect(planAllocation(invoices, 150n).allocations.map((a) => a.invoiceId)).toEqual(['r0', 'dep'])
  })

  it('does not mutate its input', () => {
    const invoices = [...aisyah]
    planAllocation(invoices, 1n)
    expect(invoices.map((i) => i.id)).toEqual(aisyah.map((i) => i.id))
  })

  it('allocates nothing when there is nothing unpaid', () => {
    expect(planAllocation([inv('a', 'rent', '2026-01-01', 0, 100n, 100n)], 50n)).toEqual({ allocations: [], unappliedSen: 50n })
  })
})
