import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Money } from '@/components/money'
import { InvoiceStatusMark, PAYMENT_METHOD_LABEL, PaymentStatusMark } from '@/components/status-mark'
import { requireStaff } from '@/lib/auth/getCaller'
import { requirePageCaller } from '@/lib/auth/page'
import { formatDate, formatPeriod } from '@/lib/format'
import { DomainError } from '@/lib/http'
import { formatMalaysia, parseIsoInstant, toMalaysiaLocalInput } from '@/lib/myt'
import { createAdminClient, SLIP_BUCKET } from '@/lib/supabase/admin'
import { getLeasePage, type LeasePageData } from '@/services/leases'
import { PaymentActions } from './payment-actions'
import { RecordPaymentForm } from './record-payment-form'

const SLIP_URL_SECONDS = 300

async function loadLease(leaseId: string, caller: Parameters<typeof getLeasePage>[0]): Promise<LeasePageData> {
  if (!/^[0-9a-f-]{36}$/i.test(leaseId)) notFound()
  try {
    return await getLeasePage(caller, leaseId)
  } catch (error) {
    if (error instanceof DomainError && error.kind === 'not_found') notFound()
    throw error
  }
}

/** Short-lived signed URLs for the slips, created only after the caller was authorized for this lease. */
async function signSlips(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await createAdminClient().storage.from(SLIP_BUCKET).createSignedUrls(paths, SLIP_URL_SECONDS)
  if (error || !data) return {}
  return Object.fromEntries(data.flatMap((entry) => (entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl]] : [])))
}

export default async function LeasePage({ params }: PageProps<'/leases/[leaseId]'>) {
  const { leaseId } = await params
  const caller = await requirePageCaller()
  requireStaff(caller)
  const data = await loadLease(leaseId, caller)
  const slipUrls = await signSlips(
    Object.values(data.paymentDetails).flatMap((detail) => (detail.slipPath ? [detail.slipPath] : [])),
  )

  const invoicedSen = data.invoices.reduce((sum, i) => sum + i.amountSen, 0)
  const paidSen = data.invoices.reduce((sum, i) => sum + i.paidSen, 0)
  const isManager = caller.kind === 'manager'

  return (
    <div>
      <Link href="/leases" className="text-sm text-muted-foreground hover:text-foreground">
        All leases
      </Link>
      <header className="mt-2 flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b-2 border-foreground pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{data.unitName}</h1>
          <p className="mt-1">
            {data.tenant.fullName}
            <span className="text-muted-foreground">
              {', '}
              {data.tenant.email}
              {data.tenant.phone ? `, ${data.tenant.phone}` : ''}
            </span>
          </p>
          <p className="figures mt-1 text-sm text-muted-foreground">
            {formatDate(data.lease.startDate)} to {formatDate(data.lease.endDate)}, rent <Money sen={data.lease.monthlyRentSen} /> a
            month{data.lease.depositSen > 0 && <>, deposit <Money sen={data.lease.depositSen} /></>}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Invoiced</dt>
          <dd className="text-right">
            <Money sen={invoicedSen} />
          </dd>
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="text-right">
            <Money sen={paidSen} />
          </dd>
          <dt className="font-semibold">Still owed</dt>
          <dd className="text-right font-semibold">
            <Money sen={invoicedSen - paidSen} />
          </dd>
        </dl>
      </header>

      <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-1 gap-10">
          <section aria-labelledby="invoices-heading">
            <h2 id="invoices-heading" className="text-lg font-bold">
              Invoices
            </h2>
            <p className="text-sm text-muted-foreground">In the order payments are applied to them.</p>
            <div className="mt-3 overflow-x-auto rounded-md border border-rule bg-card">
              <table className="w-full min-w-[38rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-foreground/70 text-left">
                    <th scope="col" className="px-3 py-2 font-semibold">Period</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Due</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Paid</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-rule last:border-b-0">
                      <td className="figures px-3 py-2.5">
                        {invoice.kind === 'deposit' ? (
                          <span className="font-medium">Deposit</span>
                        ) : (
                          formatPeriod(invoice.periodStart ?? invoice.dueDate, invoice.periodEnd ?? invoice.dueDate)
                        )}
                      </td>
                      <td className="figures px-3 py-2.5 whitespace-nowrap">{formatDate(invoice.dueDate)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Money sen={invoice.amountSen} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Money sen={invoice.paidSen} className={invoice.paidSen === 0 ? 'text-muted-foreground' : undefined} />
                      </td>
                      <td className="px-3 py-2.5">
                        <InvoiceStatusMark status={invoice.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="payments-heading">
            <h2 id="payments-heading" className="text-lg font-bold">
              Payments
            </h2>
            {data.payments.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No payments yet. Record one with the form{' '}
                <span className="lg:hidden">below</span>
                <span className="hidden lg:inline">on the right</span>.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-md border border-rule bg-card">
                <table className="w-full min-w-[40rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-foreground/70 text-left">
                      <th scope="col" className="px-3 py-2 font-semibold">Received (Malaysia time)</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Method</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((payment) => {
                      const detail = data.paymentDetails[payment.id]
                      const slipUrl = detail?.slipPath ? slipUrls[detail.slipPath] : undefined
                      return (
                        <tr key={payment.id} className="border-b border-rule align-top last:border-b-0">
                          <td className="figures px-3 py-2.5 whitespace-nowrap">{formatMalaysia(parseIsoInstant(payment.receivedAt))}</td>
                          <td className="px-3 py-2.5">
                            {PAYMENT_METHOD_LABEL[payment.method]}
                            {payment.method === 'bank_transfer' &&
                              (slipUrl ? (
                                <a
                                  href={slipUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ml-2 text-primary underline underline-offset-4"
                                >
                                  View slip
                                </a>
                              ) : (
                                <span className="ml-2 text-xs text-muted-foreground">slip unavailable</span>
                              ))}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Money sen={payment.amountSen} />
                            {payment.unappliedSen > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                <Money sen={payment.unappliedSen} /> unapplied
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <PaymentStatusMark status={payment.status} />
                            {detail?.reviewReason && (
                              <span className="mt-1 block max-w-[14rem] text-xs text-muted-foreground">{detail.reviewReason}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {isManager ? (
                              <PaymentActions
                                paymentId={payment.id}
                                status={payment.status}
                                summary={`${PAYMENT_METHOD_LABEL[payment.method].toLowerCase()} payment received ${formatMalaysia(parseIsoInstant(payment.receivedAt))}`}
                                amountSen={payment.amountSen}
                              />
                            ) : (
                              payment.status === 'pending_verification' && (
                                <span className="text-xs text-muted-foreground">A manager approves this</span>
                              )
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-6">
          <RecordPaymentForm
            leaseId={data.lease.id}
            orgId={caller.orgId}
            capSen={data.capSen}
            defaultReceivedAt={toMalaysiaLocalInput(new Date())}
            approvesImmediately={isManager}
          />
        </aside>
      </div>
    </div>
  )
}
