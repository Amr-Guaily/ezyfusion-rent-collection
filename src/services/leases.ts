import { canSee, requireManager, type Caller } from '@/lib/auth/getCaller'
import { generateSchedule, invoiceStatus, type InvoiceKind, type InvoiceStatus } from '@/lib/billing'
import { prisma } from '@/lib/db/prisma'
import { badRequest, notFound } from '@/lib/http'
import { dateColumnToString, dateStringToColumn, toMalaysiaIso } from '@/lib/myt'
import type { CreateLeaseInput } from '@/lib/validation'
import { compareAllocationOrder } from '@/services/allocation'
import { writeAudit } from '@/services/audit'

/**
 * Creates the lease and exactly the invoices generateSchedule returns, all or nothing.
 * Overlap on the unit is refused by the leases_no_overlap exclusion constraint (23P01 -> 409),
 * which also holds for concurrent requests.
 */
export async function createLease(caller: Caller, input: CreateLeaseInput): Promise<string> {
  requireManager(caller)

  // IDs in the body are untrusted: they must name records in the caller's own org.
  const [unit, tenant] = await Promise.all([
    prisma.units.findUnique({ where: { id: input.unitId }, select: { org_id: true } }),
    prisma.tenants.findUnique({ where: { id: input.tenantId }, select: { org_id: true } }),
  ])
  if (!unit || unit.org_id !== caller.orgId) throw notFound('Unit not found')
  if (!tenant || tenant.org_id !== caller.orgId) throw notFound('Tenant not found')

  let schedule
  try {
    schedule = generateSchedule(input)
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'Invalid lease')
  }

  return prisma.$transaction(async (tx) => {
    const lease = await tx.leases.create({
      data: {
        org_id: caller.orgId,
        unit_id: input.unitId,
        tenant_id: input.tenantId,
        start_date: dateStringToColumn(input.startDate),
        end_date: dateStringToColumn(input.endDate),
        monthly_rent_sen: BigInt(input.monthlyRentSen),
        deposit_sen: BigInt(input.depositSen),
        created_by: caller.userId,
      },
      select: { id: true },
    })
    await tx.invoices.createMany({
      data: schedule.map((invoice) => ({
        org_id: caller.orgId,
        lease_id: lease.id,
        kind: invoice.kind,
        period_index: invoice.periodIndex,
        period_start: invoice.periodStart === null ? null : dateStringToColumn(invoice.periodStart),
        period_end: invoice.periodEnd === null ? null : dateStringToColumn(invoice.periodEnd),
        due_date: dateStringToColumn(invoice.dueDate),
        amount_sen: BigInt(invoice.amountSen),
      })),
    })
    await writeAudit(tx, {
      orgId: caller.orgId,
      actorId: caller.userId,
      action: 'lease.created',
      entityId: lease.id,
      details: { ...input, invoiceCount: schedule.length },
    })
    return lease.id
  })
}

export interface LeaseInvoiceView {
  id: string
  kind: InvoiceKind
  periodIndex: number | null
  periodStart: string | null
  periodEnd: string | null
  dueDate: string
  amountSen: number
  paidSen: number
  status: InvoiceStatus
}

export interface LeaseView {
  lease: {
    id: string
    unitId: string
    tenantId: string
    startDate: string
    endDate: string
    monthlyRentSen: number
    depositSen: number
  }
  invoices: LeaseInvoiceView[]
  payments: {
    id: string
    amountSen: number
    unappliedSen: number
    method: 'cash' | 'bank_transfer' | 'online'
    status: 'pending_verification' | 'approved' | 'rejected' | 'voided'
    receivedAt: string
  }[]
}

/** GET /api/leases/:leaseId. Staff and managers of the lease's org, or the lease's tenant; anyone else gets 404. */
export async function getLease(caller: Caller, leaseId: string, now: Date = new Date()): Promise<LeaseView> {
  const lease = await prisma.leases.findUnique({
    where: { id: leaseId },
    include: {
      invoices: { include: { payment_allocations: { select: { amount_sen: true } } } },
      payments: { orderBy: [{ received_at: 'asc' }, { created_at: 'asc' }] },
    },
  })
  if (!lease || !canSee(caller, lease)) throw notFound('Lease not found')

  const invoices = lease.invoices
    .map((invoice): LeaseInvoiceView => {
      const amountSen = Number(invoice.amount_sen)
      const paidSen = Number(invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n))
      const dueDate = dateColumnToString(invoice.due_date)
      return {
        id: invoice.id,
        kind: invoice.kind,
        periodIndex: invoice.period_index,
        periodStart: invoice.period_start === null ? null : dateColumnToString(invoice.period_start),
        periodEnd: invoice.period_end === null ? null : dateColumnToString(invoice.period_end),
        dueDate,
        amountSen,
        paidSen,
        status: invoiceStatus({ dueDate, amountSen, paidSen }, now),
      }
    })
    .sort(compareAllocationOrder)

  return {
    lease: {
      id: lease.id,
      unitId: lease.unit_id,
      tenantId: lease.tenant_id,
      startDate: dateColumnToString(lease.start_date),
      endDate: dateColumnToString(lease.end_date),
      monthlyRentSen: Number(lease.monthly_rent_sen),
      depositSen: Number(lease.deposit_sen),
    },
    invoices,
    payments: lease.payments.map((payment) => ({
      id: payment.id,
      amountSen: Number(payment.amount_sen),
      unappliedSen: Number(payment.unapplied_sen),
      method: payment.method,
      status: payment.status,
      receivedAt: toMalaysiaIso(payment.received_at),
    })),
  }
}
