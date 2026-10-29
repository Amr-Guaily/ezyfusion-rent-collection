import type { InvoiceStatus } from '@/lib/billing'
import { cn } from '@/lib/utils'

// Statuses read like a stamp in coloured ink: outlined, sentence case.
const INVOICE: Record<InvoiceStatus, { label: string; ink: string }> = {
  paid: { label: 'Paid', ink: 'text-ink-paid border-ink-paid/40' },
  partially_paid: { label: 'Part paid', ink: 'text-ink-partial border-ink-partial/45' },
  unpaid: { label: 'Unpaid', ink: 'text-muted-foreground border-rule' },
  overdue: { label: 'Overdue', ink: 'text-ink-overdue border-ink-overdue/45 bg-ink-overdue/5' },
}

export type PaymentStatus = 'pending_verification' | 'approved' | 'rejected' | 'voided'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'online'

const PAYMENT: Record<PaymentStatus, { label: string; ink: string }> = {
  pending_verification: { label: 'Awaiting approval', ink: 'text-ink-partial border-ink-partial/45' },
  approved: { label: 'Approved', ink: 'text-ink-paid border-ink-paid/40' },
  rejected: { label: 'Rejected', ink: 'text-muted-foreground border-rule' },
  voided: { label: 'Voided', ink: 'text-ink-overdue border-ink-overdue/40' },
}

function Mark({ label, ink }: { label: string; ink: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-sm border px-1.5 py-px text-xs font-semibold whitespace-nowrap', ink)}>
      {label}
    </span>
  )
}

export function InvoiceStatusMark({ status }: { status: InvoiceStatus }) {
  return <Mark {...INVOICE[status]} />
}

export function PaymentStatusMark({ status }: { status: PaymentStatus }) {
  return <Mark {...PAYMENT[status]} />
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  online: 'Online',
}
