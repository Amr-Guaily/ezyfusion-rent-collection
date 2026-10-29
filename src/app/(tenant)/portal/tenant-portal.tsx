'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Money } from '@/components/money'
import { InvoiceStatusMark, PAYMENT_METHOD_LABEL, PaymentStatusMark } from '@/components/status-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { callApi } from '@/lib/api-client'
import { formatDate, formatPeriod, formatRinggit } from '@/lib/format'
import { formatMalaysia, parseIsoInstant, todayInMalaysia } from '@/lib/myt'
import { createClient } from '@/lib/supabase/browser'
import { loadPortal, type PortalData, type PortalLease, type TenantProfile } from './portal-data'

// Rendered in the browser only (data loads after mount), so the server HTML is just the
// skeleton and there is nothing to mismatch. Every date goes through myt.ts / format.ts,
// which never read the device's timezone.
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: PortalData }

export function TenantPortal() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  // Bumping the version re-reads everything; the previous data stays on screen meanwhile.
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    const now = new Date()
    loadPortal(now, todayInMalaysia(now)).then(
      (data) => {
        if (!cancelled) setState({ kind: 'ready', data })
      },
      (error: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not load your tenancy.' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [version])

  if (state.kind === 'loading') return <PortalSkeleton />
  if (state.kind === 'error') {
    return (
      <div role="alert" className="max-w-prose">
        <h1 className="text-2xl font-bold">Your tenancy could not be loaded</h1>
        <p className="mt-2 text-muted-foreground">{state.message}</p>
        <Button className="mt-4" onClick={reload}>
          Try again
        </Button>
      </div>
    )
  }

  const { profile, leases } = state.data
  return (
    <div className="grid gap-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Hello, {profile.full_name}</h1>
        {leases.length === 0 && (
          <p className="mt-2 text-muted-foreground">You have no leases yet. Your property manager adds them.</p>
        )}
      </div>
      {leases.map((lease) => (
        <LeaseSection key={lease.id} lease={lease} onChanged={reload} />
      ))}
      <PhoneForm profile={profile} onSaved={reload} />
    </div>
  )
}

function LeaseSection({ lease, onChanged }: { lease: PortalLease; onChanged: () => void }) {
  const [pending, startTransition] = useTransition()
  const [bill, setBill] = useState<{ billId: string; amountSen: number } | null>(null)

  function payNow() {
    startTransition(async () => {
      const result = await callApi<{ billId: string; amountSen: number }>(`/api/leases/${lease.id}/gateway-bills`, { method: 'POST' })
      if (!result.ok) {
        toast.error(`Could not start the payment: ${result.error}`)
        return
      }
      setBill(result.data)
      toast.success(`Bill created for ${formatRinggit(result.data.amountSen)}.`)
      onChanged()
    })
  }

  return (
    <section aria-labelledby={`lease-${lease.id}`} className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-foreground pb-4">
        <div>
          <h2 id={`lease-${lease.id}`} className="text-2xl font-bold tracking-tight">
            Unit {lease.unitName}
          </h2>
          <p className="figures mt-1 text-sm text-muted-foreground">
            {formatDate(lease.startDate)} to {formatDate(lease.endDate)}, rent <Money sen={lease.monthlyRentSen} /> a month
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Due now</p>
          <Money sen={lease.dueNowSen} className="text-3xl font-bold" />
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-4 rounded-md border border-rule bg-card p-4">
        {lease.dueNowSen > 0 ? (
          <>
            <p className="max-w-prose flex-1 text-sm">
              Pay what is due up to today online. You will get a bill to settle with the payment gateway; your invoices update once
              the gateway confirms it.
            </p>
            <Button size="lg" onClick={payNow} disabled={pending}>
              {pending ? 'Creating bill…' : `Pay ${formatRinggit(lease.dueNowSen)} now`}
            </Button>
          </>
        ) : (
          <p className="text-sm">Nothing is due today. Your next invoice appears here on its due date.</p>
        )}
        {bill && (
          <div className="w-full rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" role="status">
            <p>
              Bill <span className="font-mono text-xs break-all">{bill.billId}</span> for <Money sen={bill.amountSen} /> is waiting
              for the gateway. In production you would be sent to the gateway now.
            </p>
            <Link
              className="mt-1 inline-block text-primary underline underline-offset-4"
              href={`/payments/return?bill_id=${encodeURIComponent(bill.billId)}`}
            >
              Check this bill’s status
            </Link>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-lg font-bold">Invoices</h3>
        <div className="mt-3 overflow-x-auto rounded-md border border-rule bg-card">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
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
              {lease.invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-rule last:border-b-0">
                  <td className="figures px-3 py-2.5">
                    {invoice.kind === 'deposit'
                      ? 'Deposit'
                      : formatPeriod(invoice.periodStart ?? invoice.dueDate, invoice.periodEnd ?? invoice.dueDate)}
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
      </div>

      <div>
        <h3 className="text-lg font-bold">Payments</h3>
        {lease.payments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-rule bg-card">
            <table className="w-full min-w-[30rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-foreground/70 text-left">
                  <th scope="col" className="px-3 py-2 font-semibold">Received (Malaysia time)</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Method</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {lease.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-rule last:border-b-0">
                    <td className="figures px-3 py-2.5 whitespace-nowrap">{formatMalaysia(parseIsoInstant(payment.received_at))}</td>
                    <td className="px-3 py-2.5">{PAYMENT_METHOD_LABEL[payment.method]}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Money sen={payment.amount_sen} />
                    </td>
                    <td className="px-3 py-2.5">
                      <PaymentStatusMark status={payment.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function PhoneForm({ profile, onSaved }: { profile: TenantProfile; onSaved: () => void }) {
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = phone.trim()
    if (value.length < 3 || value.length > 32) {
      setError('Enter a phone number of 3 to 32 characters, for example +60 12-345 6789.')
      return
    }
    setError(null)
    startTransition(async () => {
      // Straight to the Data API: RLS lets a tenant update only the phone on their own row.
      const { error: updateError } = await createClient()
        .from('tenants')
        .update({ phone: value })
        .eq('id', profile.id)
        .select('phone')
        .single()
      if (updateError) {
        toast.error(`Phone number not saved: ${updateError.message}`)
        return
      }
      toast.success('Phone number saved.')
      onSaved()
    })
  }

  return (
    <section aria-labelledby="contact-heading" className="max-w-md">
      <h2 id="contact-heading" className="text-lg font-bold">
        Contact details
      </h2>
      <p className="text-sm text-muted-foreground">
        {profile.email}. Your property manager uses this number to reach you.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-3 grid gap-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <div className="flex gap-2">
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+60 12-345 6789"
            aria-invalid={error !== null}
            aria-describedby={error ? 'phone-error' : undefined}
          />
          <Button type="submit" disabled={pending || phone.trim() === (profile.phone ?? '')}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {error && (
          <p id="phone-error" className="text-xs text-ink-overdue">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}

function PortalSkeleton() {
  return (
    <div className="grid gap-6" role="status" aria-label="Loading your tenancy">
      <Skeleton className="h-9 w-72" />
      <div className="flex justify-between border-b-2 border-rule pb-4">
        <Skeleton className="h-12 w-60" />
        <Skeleton className="h-12 w-40" />
      </div>
      <Skeleton className="h-16 w-full" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}
