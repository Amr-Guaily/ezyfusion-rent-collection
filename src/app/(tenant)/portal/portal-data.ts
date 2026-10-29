import { z } from 'zod'
import { invoiceStatus, type InvoiceStatus } from '@/lib/billing'
import { createClient } from '@/lib/supabase/browser'
import { compareAllocationOrder } from '@/services/allocation'

// Row shapes returned by PostgREST for the tenant's own data. Parsed with Zod so the
// browser never works with untyped rows. bigint columns arrive as JSON numbers.
const sen = z.number().int()

const tenantRow = z.object({ id: z.uuid(), full_name: z.string(), email: z.string(), phone: z.string().nullable() })
const leaseRow = z.object({
  id: z.uuid(),
  start_date: z.string(),
  end_date: z.string(),
  monthly_rent_sen: sen,
  deposit_sen: sen,
  units: z.object({ name: z.string() }).nullable(),
})
const invoiceRow = z.object({
  id: z.uuid(),
  lease_id: z.uuid(),
  kind: z.enum(['deposit', 'rent']),
  period_index: z.number().int().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  due_date: z.string(),
  amount_sen: sen,
  payment_allocations: z.array(z.object({ amount_sen: sen })),
})
const paymentRow = z.object({
  id: z.uuid(),
  lease_id: z.uuid(),
  amount_sen: sen,
  method: z.enum(['cash', 'bank_transfer', 'online']),
  status: z.enum(['pending_verification', 'approved', 'rejected', 'voided']),
  received_at: z.string(),
})

export type TenantProfile = z.infer<typeof tenantRow>

export interface PortalInvoice {
  id: string
  kind: 'deposit' | 'rent'
  periodIndex: number | null
  periodStart: string | null
  periodEnd: string | null
  dueDate: string
  amountSen: number
  paidSen: number
  status: InvoiceStatus
}

export interface PortalLease {
  id: string
  unitName: string
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
  invoices: PortalInvoice[]
  payments: z.infer<typeof paymentRow>[]
  dueNowSen: number
}

export interface PortalData {
  profile: TenantProfile
  leases: PortalLease[]
}

/** Loads everything the portal shows through supabase-js with the tenant's own session. */
export async function loadPortal(now: Date, today: string): Promise<PortalData> {
  const supabase = createClient()
  const [tenants, leases, invoices, payments] = await Promise.all([
    supabase.from('tenants').select('id, full_name, email, phone'),
    supabase.from('leases').select('id, start_date, end_date, monthly_rent_sen, deposit_sen, units(name)').order('start_date'),
    supabase
      .from('invoices')
      .select('id, lease_id, kind, period_index, period_start, period_end, due_date, amount_sen, payment_allocations(amount_sen)'),
    supabase.from('payments').select('id, lease_id, amount_sen, method, status, received_at').order('received_at'),
  ])
  const failed = [tenants, leases, invoices, payments].find((result) => result.error)
  if (failed?.error) throw new Error(failed.error.message)

  const profile = z.array(tenantRow).parse(tenants.data)[0]
  if (!profile) throw new Error('No tenant profile is linked to this account.')
  const allInvoices = z.array(invoiceRow).parse(invoices.data)
  const allPayments = z.array(paymentRow).parse(payments.data)

  return {
    profile,
    leases: z
      .array(leaseRow)
      .parse(leases.data)
      .map((lease) => {
        const leaseInvoices = allInvoices
          .filter((invoice) => invoice.lease_id === lease.id)
          .map((invoice): PortalInvoice => {
            const paidSen = invoice.payment_allocations.reduce((sum, a) => sum + a.amount_sen, 0)
            return {
              id: invoice.id,
              kind: invoice.kind,
              periodIndex: invoice.period_index,
              periodStart: invoice.period_start,
              periodEnd: invoice.period_end,
              dueDate: invoice.due_date,
              amountSen: invoice.amount_sen,
              paidSen,
              status: invoiceStatus({ dueDate: invoice.due_date, amountSen: invoice.amount_sen, paidSen }, now),
            }
          })
          .sort(compareAllocationOrder)
        // Same rule as the server's gateway bill: unpaid amounts of invoices due on or before today (Malaysia).
        const dueNowSen = leaseInvoices
          .filter((invoice) => invoice.dueDate <= today)
          .reduce((sum, invoice) => sum + Math.max(invoice.amountSen - invoice.paidSen, 0), 0)
        return {
          id: lease.id,
          unitName: lease.units?.name ?? 'Unit',
          startDate: lease.start_date,
          endDate: lease.end_date,
          monthlyRentSen: lease.monthly_rent_sen,
          depositSen: lease.deposit_sen,
          invoices: leaseInvoices,
          payments: allPayments.filter((payment) => payment.lease_id === lease.id),
          dueNowSen,
        }
      }),
  }
}
