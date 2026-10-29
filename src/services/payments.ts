import { canSee, isStaff, requireManager, requireStaff, type Caller } from '@/lib/auth/getCaller'
import { prisma, type Tx } from '@/lib/db/prisma'
import { badRequest, conflict, notFound, unprocessable } from '@/lib/http'
import { parseIsoInstant } from '@/lib/myt'
import { createAdminClient, SLIP_BUCKET } from '@/lib/supabase/admin'
import { reasonSchema, recordPaymentSchema } from '@/lib/validation'
import { allocate } from '@/services/allocation'
import { writeAudit } from '@/services/audit'

// Every payment mutation runs in one transaction that first locks the lease row.
// That serialises all money movement on a lease (record, approve, void, webhook
// settle), so the cap and balance checks below read figures nobody else can change
// until we commit. Lock order everywhere: lease -> gateway bill -> invoices.

export async function lockLease(tx: Tx, leaseId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM leases WHERE id = ${leaseId}::uuid FOR UPDATE`
  if (rows.length === 0) throw notFound('Lease not found')
}

export interface LeaseBalance {
  invoicedSen: bigint
  allocatedSen: bigint
  pendingSen: bigint
}

/** Totals for a lease. Only meaningful while holding the lease lock. */
export async function leaseBalance(tx: Tx, leaseId: string): Promise<LeaseBalance> {
  const [row] = await tx.$queryRaw<{ invoiced: bigint; allocated: bigint; pending: bigint }[]>`
    SELECT
      (SELECT COALESCE(SUM(i.amount_sen), 0)::bigint FROM invoices i WHERE i.lease_id = ${leaseId}::uuid) AS invoiced,
      (SELECT COALESCE(SUM(a.amount_sen), 0)::bigint
         FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id
        WHERE i.lease_id = ${leaseId}::uuid) AS allocated,
      (SELECT COALESCE(SUM(p.amount_sen), 0)::bigint FROM payments p
        WHERE p.lease_id = ${leaseId}::uuid AND p.status = 'pending_verification') AS pending`
  return { invoicedSen: row.invoiced, allocatedSen: row.allocated, pendingSen: row.pending }
}

const SLIP_MAX_BYTES = 5 * 1024 * 1024
const SLIP_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

/** The slip must be an existing JPEG/PNG/PDF of at most 5 MB in the caller's org folder. */
async function assertSlip(orgId: string, slipPath: string): Promise<void> {
  const prefix = `${orgId}/`
  if (!slipPath.startsWith(prefix) || slipPath.length === prefix.length || slipPath.split('/').includes('..')) {
    throw badRequest("slipPath must point to a file in your organization's folder")
  }
  const rows = await prisma.$queryRaw<{ size: string | null; mimetype: string | null }[]>`
    SELECT metadata->>'size' AS size, metadata->>'mimetype' AS mimetype
      FROM storage.objects WHERE bucket_id = ${SLIP_BUCKET} AND name = ${slipPath}`
  if (rows.length === 0) throw badRequest('Slip file not found')
  const size = Number(rows[0].size)
  if (!Number.isFinite(size) || size <= 0 || size > SLIP_MAX_BYTES) throw badRequest('Slip must be at most 5 MB')
  if (!SLIP_MIME_TYPES.includes(rows[0].mimetype ?? '')) throw badRequest('Slip must be a JPEG, PNG or PDF')
}

/**
 * Deletes an uploaded slip after a failed recording, so the file is not left behind.
 * Only in the caller's own org folder, and never a slip another payment already uses
 * (slip_path is UNIQUE), so a request naming someone else's slip cannot delete it.
 */
async function removeOrphanSlip(orgId: string, slipPath: string): Promise<void> {
  if (!slipPath.startsWith(`${orgId}/`) || slipPath.split('/').includes('..')) return
  try {
    if ((await prisma.payments.count({ where: { slip_path: slipPath } })) > 0) return
    const { error } = await createAdminClient().storage.from(SLIP_BUCKET).remove([slipPath])
    if (error) console.error('Could not remove orphaned slip:', error.message)
  } catch (error) {
    console.error('Could not remove orphaned slip:', error instanceof Error ? error.message : String(error))
  }
}

export type PaymentStatus = 'pending_verification' | 'approved' | 'rejected' | 'voided'

/**
 * POST /api/leases/:leaseId/payments. Staff payments wait for approval; a manager's are
 * approved and allocated at once. Refused (422) above the cap: invoices - allocated - pending.
 */
export async function recordPayment(
  caller: Caller,
  leaseId: string,
  body: unknown,
): Promise<{ id: string; status: PaymentStatus }> {
  const slipPath =
    typeof body === 'object' && body !== null && typeof (body as { slipPath?: unknown }).slipPath === 'string'
      ? (body as { slipPath: string }).slipPath
      : undefined
  try {
    return await recordPaymentChecked(caller, leaseId, body)
  } catch (error) {
    if (slipPath !== undefined && isStaff(caller)) await removeOrphanSlip(caller.orgId, slipPath)
    throw error
  }
}

async function recordPaymentChecked(caller: Caller, leaseId: string, body: unknown) {
  const lease = await prisma.leases.findUnique({ where: { id: leaseId }, select: { id: true, org_id: true, tenant_id: true } })
  if (!lease || !canSee(caller, lease)) throw notFound('Lease not found')
  requireStaff(caller)
  const input = recordPaymentSchema.parse(body)
  if (input.slipPath !== undefined) await assertSlip(caller.orgId, input.slipPath)
  const receivedAt = parseIsoInstant(input.receivedAt)
  const status: PaymentStatus = caller.kind === 'manager' ? 'approved' : 'pending_verification'

  return prisma.$transaction(async (tx) => {
    await lockLease(tx, lease.id)
    const balance = await leaseBalance(tx, lease.id)
    const capSen = balance.invoicedSen - balance.allocatedSen - balance.pendingSen
    if (BigInt(input.amountSen) > capSen) {
      throw unprocessable(`Amount is more than the lease's remaining balance (${capSen > 0n ? capSen : 0n} sen available)`)
    }
    const payment = await tx.payments.create({
      data: {
        org_id: lease.org_id,
        lease_id: lease.id,
        amount_sen: BigInt(input.amountSen),
        method: input.method,
        status,
        received_at: receivedAt,
        slip_path: input.slipPath ?? null,
        recorded_by: caller.userId,
        ...(status === 'approved' ? { reviewed_by: caller.userId, reviewed_at: new Date() } : {}),
      },
      select: { id: true },
    })
    await writeAudit(tx, {
      orgId: lease.org_id,
      actorId: caller.userId,
      action: 'payment.recorded',
      entityId: payment.id,
      details: { leaseId: lease.id, amountSen: input.amountSen, method: input.method, receivedAt: input.receivedAt, status },
    })
    if (status === 'approved') {
      const plan = await allocate(tx, payment.id)
      await writeAudit(tx, {
        orgId: lease.org_id,
        actorId: caller.userId,
        action: 'payment.approved',
        entityId: payment.id,
        details: { leaseId: lease.id, amountSen: input.amountSen, unappliedSen: Number(plan.unappliedSen), onRecord: true },
      })
    }
    return { id: payment.id, status }
  })
}

/** The payment if the caller can see it (its lease's org, or its lease's tenant); otherwise 404. */
async function findVisiblePayment(caller: Caller, paymentId: string) {
  const payment = await prisma.payments.findUnique({
    where: { id: paymentId },
    select: { id: true, org_id: true, lease_id: true, leases: { select: { tenant_id: true } } },
  })
  if (!payment || !canSee(caller, { org_id: payment.org_id, tenant_id: payment.leases.tenant_id })) {
    throw notFound('Payment not found')
  }
  return payment
}

/** POST /api/payments/:paymentId/approve. Re-checks the remaining balance inside the lock; 422 leaves it pending. */
export async function approvePayment(caller: Caller, paymentId: string): Promise<{ status: PaymentStatus }> {
  const visible = await findVisiblePayment(caller, paymentId)
  requireManager(caller)
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, visible.lease_id)
    // Re-read under the lock: a concurrent approve may have committed while we waited.
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } })
    if (payment.status !== 'pending_verification') throw conflict(`Payment is ${payment.status}, not pending verification`)
    const balance = await leaseBalance(tx, payment.lease_id)
    const remainingSen = balance.invoicedSen - balance.allocatedSen
    if (payment.amount_sen > remainingSen) {
      throw unprocessable(`Amount is more than the lease's remaining balance (${remainingSen} sen)`)
    }
    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'approved', reviewed_by: caller.userId, reviewed_at: new Date() },
    })
    const plan = await allocate(tx, payment.id)
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: caller.userId,
      action: 'payment.approved',
      entityId: payment.id,
      details: { leaseId: payment.lease_id, amountSen: Number(payment.amount_sen), unappliedSen: Number(plan.unappliedSen) },
    })
    return { status: 'approved' as const }
  })
}

/** POST /api/payments/:paymentId/reject. Pending only (409 otherwise); reason of at least 5 characters (400). */
export async function rejectPayment(caller: Caller, paymentId: string, body: unknown): Promise<{ status: PaymentStatus }> {
  const visible = await findVisiblePayment(caller, paymentId)
  requireManager(caller)
  const { reason } = reasonSchema.parse(body)
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, visible.lease_id)
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } })
    if (payment.status !== 'pending_verification') throw conflict(`Payment is ${payment.status}, not pending verification`)
    await tx.payments.update({
      where: { id: payment.id },
      data: { status: 'rejected', reviewed_by: caller.userId, reviewed_at: new Date(), review_reason: reason },
    })
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: caller.userId,
      action: 'payment.rejected',
      entityId: payment.id,
      details: { leaseId: payment.lease_id, amountSen: Number(payment.amount_sen), reason },
    })
    return { status: 'rejected' as const }
  })
}

/**
 * POST /api/payments/:paymentId/void. Approved only (409 otherwise). Removes this payment's
 * allocations and nothing else; other payments' allocations and unapplied amounts are untouched.
 */
export async function voidPayment(caller: Caller, paymentId: string, body: unknown): Promise<{ status: PaymentStatus }> {
  const visible = await findVisiblePayment(caller, paymentId)
  requireManager(caller)
  const { reason } = reasonSchema.parse(body)
  return prisma.$transaction(async (tx) => {
    await lockLease(tx, visible.lease_id)
    const payment = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } })
    if (payment.status !== 'approved') throw conflict(`Payment is ${payment.status}, not approved`)
    const removed = await tx.payment_allocations.deleteMany({ where: { payment_id: payment.id } })
    await tx.payments.update({
      where: { id: payment.id },
      // A voided payment holds no credit, so nothing stays unapplied on it.
      data: { status: 'voided', unapplied_sen: 0n, reviewed_by: caller.userId, reviewed_at: new Date(), review_reason: reason },
    })
    await writeAudit(tx, {
      orgId: payment.org_id,
      actorId: caller.userId,
      action: 'payment.voided',
      entityId: payment.id,
      details: {
        leaseId: payment.lease_id,
        amountSen: Number(payment.amount_sen),
        unappliedSenBefore: Number(payment.unapplied_sen),
        allocationsRemoved: removed.count,
        reason,
      },
    })
    return { status: 'voided' as const }
  })
}
