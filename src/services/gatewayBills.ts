import { randomBytes } from 'node:crypto'
import { canSee, type Caller } from '@/lib/auth/getCaller'
import { prisma } from '@/lib/db/prisma'
import { forbidden, notFound, unprocessable } from '@/lib/http'
import { dateColumnToString, todayInMalaysia } from '@/lib/myt'
import { allocate } from '@/services/allocation'
import { writeAudit } from '@/services/audit'
import { lockLease } from '@/services/payments'

/** 'bill_' + 128 random bits: impossible to guess, unlike the brief's 'bill_8f3a2c'. */
function newBillId(): string {
  return `bill_${randomBytes(16).toString('hex')}`
}

/**
 * POST /api/leases/:leaseId/gateway-bills (the lease's tenant). The bill is for the amount
 * due now: the unpaid amounts of the lease's invoices due on or before today's Malaysia date.
 */
export async function createGatewayBill(
  caller: Caller,
  leaseId: string,
  now: Date = new Date(),
): Promise<{ billId: string; amountSen: number }> {
  const lease = await prisma.leases.findUnique({ where: { id: leaseId }, select: { id: true, org_id: true, tenant_id: true } })
  if (!lease || !canSee(caller, lease)) throw notFound('Lease not found')
  if (caller.kind !== 'tenant') throw forbidden('Only the tenant can pay online')

  const today = todayInMalaysia(now)
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, lease.id) // read the paid amounts while no payment can change them
    const invoices = await tx.invoices.findMany({
      where: { lease_id: lease.id },
      include: { payment_allocations: { select: { amount_sen: true } } },
    })
    const dueNowSen = invoices
      .filter((invoice) => dateColumnToString(invoice.due_date) <= today)
      .reduce((total, invoice) => {
        const unpaid = invoice.amount_sen - invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n)
        return unpaid > 0n ? total + unpaid : total
      }, 0n)
    if (dueNowSen <= 0n) throw unprocessable('Nothing is due on this lease')

    const bill = await tx.gateway_bills.create({
      data: { id: newBillId(), org_id: lease.org_id, lease_id: lease.id, amount_sen: dueNowSen, created_by: caller.userId },
      select: { id: true, amount_sen: true },
    })
    return { billId: bill.id, amountSen: Number(bill.amount_sen) }
  })
}

export interface GatewayCallback {
  billId: string
  paid: boolean
  paidAmountSen: bigint
  paidAt: Date | null // required when paid
  transactionId: string
}

export type WebhookOutcome = 'settled' | 'failed' | 'unchanged'

/**
 * Applies a verified gateway callback (brief section 5 table). Throws notFound for an
 * unknown bill and unprocessable for a paid amount that is not the bill's amount.
 *
 * Concurrency: the lease row and then the bill row are locked, and the bill's status is
 * re-read under the lock, so of two identical deliveries arriving together the second
 * sees 'paid' and changes nothing. payments.gateway_bill_id is UNIQUE as a backstop:
 * a bill creates at most one payment, ever.
 */
export async function applyGatewayCallback(callback: GatewayCallback): Promise<WebhookOutcome> {
  const bill = await prisma.gateway_bills.findUnique({
    where: { id: callback.billId },
    select: { id: true, org_id: true, lease_id: true, amount_sen: true },
  })
  if (!bill) throw notFound('Unknown bill')
  if (callback.paid && callback.paidAmountSen !== bill.amount_sen) {
    throw unprocessable("paid_amount is not the bill's amount")
  }

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, bill.lease_id) // lease_id never changes, so reading it unlocked is safe
    const [locked] = await tx.$queryRaw<{ status: 'pending' | 'paid' | 'failed' }[]>`
      SELECT status FROM gateway_bills WHERE id = ${bill.id} FOR UPDATE`

    if (!callback.paid) {
      if (locked.status !== 'pending') return 'unchanged' // failed stays failed; a paid bill never goes back
      await tx.gateway_bills.update({ where: { id: bill.id }, data: { status: 'failed', transaction_id: callback.transactionId, updated_at: new Date() } })
      return 'failed'
    }

    if (locked.status === 'paid') return 'unchanged' // repeat delivery
    const paidAt = callback.paidAt
    if (!paidAt) throw new Error('paid_at is required for a paid callback')
    await tx.gateway_bills.update({
      where: { id: bill.id },
      data: { status: 'paid', paid_at: paidAt, transaction_id: callback.transactionId, updated_at: new Date() },
    })
    const payment = await tx.payments.create({
      data: {
        org_id: bill.org_id,
        lease_id: bill.lease_id,
        amount_sen: bill.amount_sen,
        method: 'online',
        status: 'approved',
        received_at: paidAt,
        gateway_bill_id: bill.id,
      },
      select: { id: true },
    })
    const plan = await allocate(tx, payment.id)
    await writeAudit(tx, {
      orgId: bill.org_id,
      actorId: null,
      action: 'payment.approved',
      entityId: payment.id,
      details: {
        source: 'gateway',
        billId: bill.id,
        leaseId: bill.lease_id,
        amountSen: Number(bill.amount_sen),
        unappliedSen: Number(plan.unappliedSen),
        transactionId: callback.transactionId,
      },
    })
    return 'settled'
  })
}
