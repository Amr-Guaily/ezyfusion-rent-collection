import Link from 'next/link'
import { Money } from '@/components/money'
import { canSee, isStaff } from '@/lib/auth/getCaller'
import { requirePageCaller } from '@/lib/auth/page'
import { prisma } from '@/lib/db/prisma'
import { formatMalaysia } from '@/lib/myt'

// Where the gateway sends the tenant back: /payments/return?bill_id=...&paid=true.
// Read-only. It shows the bill's real status from the database and ignores `paid`:
// only the signed webhook can settle a bill.
const COPY = {
  paid: { title: 'Payment received', body: 'The gateway confirmed this payment and it has been applied to your invoices.' },
  pending: {
    title: 'Waiting for the gateway',
    body: 'We have not heard from the gateway about this bill yet. Refresh this page in a moment; nothing is charged twice.',
  },
  failed: { title: 'Payment did not go through', body: 'The gateway reported this payment as unsuccessful. You can start a new payment from your lease.' },
} as const

export default async function PaymentReturnPage({ searchParams }: PageProps<'/payments/return'>) {
  const caller = await requirePageCaller()
  const { bill_id: billIdParam } = await searchParams
  const billId = typeof billIdParam === 'string' ? billIdParam : ''

  const bill = billId
    ? await prisma.gateway_bills.findUnique({
        where: { id: billId },
        select: { id: true, org_id: true, status: true, amount_sen: true, paid_at: true, leases: { select: { tenant_id: true } } },
      })
    : null
  // Same visibility rule as the API: someone else's bill looks exactly like a missing one.
  const visible = bill && canSee(caller, { org_id: bill.org_id, tenant_id: bill.leases.tenant_id }) ? bill : null
  const home = isStaff(caller) ? '/dashboard' : '/portal'

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-5 py-16">
      {visible ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight">{COPY[visible.status].title}</h1>
          <p className="mt-3 text-muted-foreground">{COPY[visible.status].body}</p>
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-y border-rule py-4 text-sm">
            <dt className="text-muted-foreground">Bill</dt>
            <dd className="font-mono text-xs break-all">{visible.id}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd>
              <Money sen={Number(visible.amount_sen)} className="font-semibold" />
            </dd>
            {visible.paid_at && (
              <>
                <dt className="text-muted-foreground">Paid at</dt>
                <dd className="figures">{formatMalaysia(visible.paid_at)} Malaysia time</dd>
              </>
            )}
          </dl>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold tracking-tight">Payment not found</h1>
          <p className="mt-3 text-muted-foreground">
            {billId
              ? 'There is no payment with this reference on your account. Check the link from the payment gateway.'
              : 'This link has no payment reference. Open your lease to see your payments.'}
          </p>
        </>
      )}
      <Link href={home} className="mt-8 inline-block font-medium text-primary underline underline-offset-4">
        {isStaff(caller) ? 'Back to the dashboard' : 'Back to my lease'}
      </Link>
    </main>
  )
}
