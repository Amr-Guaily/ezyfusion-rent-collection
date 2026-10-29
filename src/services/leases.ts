import { canSee, requireManager, requireStaff, type Caller } from '@/lib/auth/getCaller'
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

export interface LeaseListItem {
  id: string
  unitName: string
  tenantName: string
  startDate: string
  endDate: string
  monthlyRentSen: number
  outstandingSen: number
  overdueCount: number
}

/** Leases of the caller's org for the staff list, with what is still owed and how many invoices are overdue. */
export async function listLeases(caller: Caller, now: Date = new Date()): Promise<LeaseListItem[]> {
  requireStaff(caller)
  const leases = await prisma.leases.findMany({
    where: { org_id: caller.orgId },
    orderBy: [{ units: { name: 'asc' } }, { start_date: 'asc' }],
    include: {
      units: { select: { name: true } },
      tenants: { select: { full_name: true } },
      invoices: { include: { payment_allocations: { select: { amount_sen: true } } } },
    },
  })
  return leases.map((lease) => {
    let outstandingSen = 0
    let overdueCount = 0
    for (const invoice of lease.invoices) {
      const amountSen = Number(invoice.amount_sen)
      const paidSen = Number(invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0n))
      outstandingSen += Math.max(amountSen - paidSen, 0)
      if (invoiceStatus({ dueDate: dateColumnToString(invoice.due_date), amountSen, paidSen }, now) === 'overdue') overdueCount++
    }
    return {
      id: lease.id,
      unitName: lease.units.name,
      tenantName: lease.tenants.full_name,
      startDate: dateColumnToString(lease.start_date),
      endDate: dateColumnToString(lease.end_date),
      monthlyRentSen: Number(lease.monthly_rent_sen),
      outstandingSen,
      overdueCount,
    }
  })
}

export interface LeasePageData extends LeaseView {
  unitName: string
  tenant: { fullName: string; email: string; phone: string | null }
  paymentDetails: Record<string, { slipPath: string | null; reviewReason: string | null }>
  /** What a new manual payment may be at most: invoices - allocated - pending (the API's cap). */
  capSen: number
}

/** Everything the staff lease page shows. getLease does the authorization (404 for other orgs). */
export async function getLeasePage(caller: Caller, leaseId: string, now: Date = new Date()): Promise<LeasePageData> {
  requireStaff(caller)
  const view = await getLease(caller, leaseId, now)
  const extra = await prisma.leases.findUniqueOrThrow({
    where: { id: leaseId },
    select: {
      units: { select: { name: true } },
      tenants: { select: { full_name: true, email: true, phone: true } },
      payments: { select: { id: true, slip_path: true, review_reason: true } },
    },
  })
  const invoicedSen = view.invoices.reduce((sum, i) => sum + i.amountSen, 0)
  const paidSen = view.invoices.reduce((sum, i) => sum + i.paidSen, 0)
  const pendingSen = view.payments.filter((p) => p.status === 'pending_verification').reduce((sum, p) => sum + p.amountSen, 0)
  return {
    ...view,
    unitName: extra.units.name,
    tenant: { fullName: extra.tenants.full_name, email: extra.tenants.email, phone: extra.tenants.phone },
    paymentDetails: Object.fromEntries(
      extra.payments.map((p) => [p.id, { slipPath: p.slip_path, reviewReason: p.review_reason }]),
    ),
    capSen: Math.max(invoicedSen - paidSen - pendingSen, 0),
  }
}
