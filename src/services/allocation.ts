import type { InvoiceKind } from '@/lib/billing'

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
