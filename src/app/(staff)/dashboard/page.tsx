import Link from 'next/link'
import { Money } from '@/components/money'
import { requireStaff } from '@/lib/auth/getCaller'
import { requirePageCaller } from '@/lib/auth/page'
import { formatMonth } from '@/lib/format'
import { todayInMalaysia } from '@/lib/myt'
import { listLeases } from '@/services/leases'
import { collectionsReport } from '@/services/reports'

/** 'YYYY-MM' shifted by a number of months, on integers only. */
function addMonths(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

export default async function DashboardPage() {
  const caller = await requirePageCaller()
  requireStaff(caller)
  const now = new Date()
  const thisMonth = todayInMalaysia(now).slice(0, 7)
  const from = addMonths(thisMonth, -5)
  const [leases, report] = await Promise.all([listLeases(caller, now), collectionsReport(caller, from, thisMonth)])

  const overdueCount = leases.reduce((sum, lease) => sum + lease.overdueCount, 0)
  const overdueLeases = leases.filter((lease) => lease.overdueCount > 0)
  const largest = Math.max(...report.map((row) => row.collectedSen), 1)
  const total = report.reduce((sum, row) => sum + row.collectedSen, 0)

  return (
    <div className="grid gap-12">
      <section aria-labelledby="overdue-heading">
        <h1 id="overdue-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {overdueCount === 0
            ? 'No invoices are overdue.'
            : `${overdueCount} ${overdueCount === 1 ? 'invoice is' : 'invoices are'} overdue.`}
        </h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          {overdueCount === 0
            ? 'Every invoice due up to today, Malaysia time, has been paid.'
            : 'Counted against today’s date in Malaysia. Open a lease to record a payment against it.'}
        </p>
        {overdueLeases.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2">
            {overdueLeases.map((lease) => (
              <li key={lease.id}>
                <Link
                  href={`/leases/${lease.id}`}
                  className="inline-flex items-baseline gap-2 rounded-md border border-ink-overdue/35 bg-card px-3 py-1.5 text-sm hover:border-ink-overdue focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="font-semibold">{lease.unitName}</span>
                  <span className="text-muted-foreground">{lease.tenantName}</span>
                  <span className="figures text-ink-overdue">{lease.overdueCount} overdue</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="collections-heading" className="max-w-2xl">
        <div className="flex items-baseline justify-between gap-4 border-b-2 border-foreground pb-2">
          <h2 id="collections-heading" className="text-lg font-bold">
            Collected, {formatMonth(from)} to {formatMonth(thisMonth)}
          </h2>
          <Money sen={total} className="text-lg font-bold" />
        </div>
        {total === 0 && (
          <p className="pt-3 text-sm text-muted-foreground">
            Nothing was collected in these six months. Approved payments appear here by the month they were received.
          </p>
        )}
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Approved payments by month received, Malaysia time</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Collected</th>
            </tr>
          </thead>
          <tbody>
            {report.map((row) => (
              <tr key={row.month} className="border-b border-rule">
                <th scope="row" className="w-24 py-2.5 pr-4 text-left font-medium whitespace-nowrap">
                  {formatMonth(row.month)}
                </th>
                <td className="relative py-2.5 text-right">
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 rounded-sm bg-primary/15"
                    style={{ width: `${(row.collectedSen / largest) * 100}%` }}
                  />
                  <Money
                    sen={row.collectedSen}
                    className={row.collectedSen === 0 ? 'relative text-muted-foreground' : 'relative font-semibold'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Approved payments only, grouped by the Malaysia date they were received.
        </p>
      </section>
    </div>
  )
}
