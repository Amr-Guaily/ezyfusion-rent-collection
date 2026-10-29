import Link from 'next/link'
import { Money } from '@/components/money'
import { requireStaff } from '@/lib/auth/getCaller'
import { requirePageCaller } from '@/lib/auth/page'
import { formatDate } from '@/lib/format'
import { listLeases } from '@/services/leases'

export default async function LeasesPage() {
  const caller = await requirePageCaller()
  requireStaff(caller)
  const leases = await listLeases(caller)

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Leases</h1>
      <p className="mt-1 text-muted-foreground">
        {leases.length === 0
          ? 'There are no leases yet. A manager creates them through the leases API.'
          : `${leases.length} ${leases.length === 1 ? 'lease' : 'leases'}. Open one to see its invoices and record a payment.`}
      </p>
      {leases.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-md border border-rule bg-card">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-foreground text-left">
                <th scope="col" className="px-4 py-2.5 font-semibold">Unit</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Tenant</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Term</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Monthly rent</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {leases.map((lease) => (
                <tr key={lease.id} className="border-b border-rule last:border-b-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/leases/${lease.id}`}
                      className="font-semibold underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {lease.unitName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{lease.tenantName}</td>
                  <td className="figures px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money sen={lease.monthlyRentSen} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money sen={lease.outstandingSen} className={lease.outstandingSen === 0 ? 'text-muted-foreground' : 'font-semibold'} />
                    {lease.overdueCount > 0 && (
                      <span className="figures block text-xs text-ink-overdue">{lease.overdueCount} overdue</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
