import type { InvoiceKind } from '@/lib/billing'
import type { Tx } from '@/lib/db/prisma'
import { dateColumnToString } from '@/lib/myt'

// Allocation order (brief section 4): due date, then deposit before rent, then period index.
// Also the order GET /api/leases/:leaseId returns invoices in.
export interface OrderedInvoice {
  kind: InvoiceKind
  dueDate: string // 'YYYY-MM-DD'
  periodIndex: number | null
}

export function compareAllocationOrder(a: OrderedInvoice, b: OrderedInvoice): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
  if (a.kind !== b.kind) return a.kind === 'deposit' ? -1 : 1
  return (a.periodIndex ?? -1) - (b.periodIndex ?? -1)
}

export interface AllocatableInvoice extends OrderedInvoice {
  id: string
  amountSen: bigint
  paidSen: bigint
}

export interface AllocationPlan {
  allocations: { invoiceId: string; amountSen: bigint }[]
  unappliedSen: bigint
}

/**
 * Pure: fills each invoice up to its unpaid amount in allocation order, including
 * invoices not due yet. Whatever is left once every invoice is paid is unapplied.
 */
export function planAllocation(invoices: AllocatableInvoice[], amountSen: bigint): AllocationPlan {
  if (amountSen < 0n) throw new Error('amountSen must not be negative')
  let remaining = amountSen
  const allocations: AllocationPlan['allocations'] = []
  for (const invoice of [...invoices].sort(compareAllocationOrder)) {
    if (remaining === 0n) break
    const unpaid = invoice.amountSen - invoice.paidSen
    if (unpaid <= 0n) continue
    const portion = unpaid < remaining ? unpaid : remaining
    allocations.push({ invoiceId: invoice.id, amountSen: portion })
    remaining -= portion
  }
  return { allocations, unappliedSen: remaining }
}

/**
 * Allocates an approved payment to its lease's invoices and stores the remainder as
 * unapplied_sen. The caller must hold the lease row lock (lockLease) in this transaction,
 * which is what makes the paid amounts read here stable.
 */
export async function allocate(tx: Tx, paymentId: string): Promise<AllocationPlan> {
  const payment = await tx.payments.findUniqueOrThrow({
    where: { id: paymentId },
    select: { id: true, org_id: true, lease_id: true, amount_sen: true, status: true },
  })
  if (payment.status !== 'approved') throw new Error(`Cannot allocate a ${payment.status} payment`)
  const existing = await tx.payment_allocations.count({ where: { payment_id: paymentId } })
  if (existing > 0) throw new Error('Payment is already allocated')

  const invoices = await tx.invoices.findMany({
    where: { lease_id: payment.lease_id },
    include: { payment_allocations: { select: { amount_sen: true } } },
  })
  const plan = planAllocation(
    invoices.map((invoice) => ({
      id: invoice.id,
      kind: invoice.kind,
      dueDate: dateColumnToString(invoice.due_date),
      periodIndex: invoice.period_index,
      amountSen: invoice.amount_sen,
      paidSen: invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n),
    })),
    payment.amount_sen,
  )

  if (plan.allocations.length > 0) {
    await tx.payment_allocations.createMany({
      data: plan.allocations.map((allocation) => ({
        org_id: payment.org_id,
        payment_id: payment.id,
        invoice_id: allocation.invoiceId,
        amount_sen: allocation.amountSen,
      })),
    })
  }
  await tx.payments.update({ where: { id: payment.id }, data: { unapplied_sen: plan.unappliedSen } })
  return plan
}
