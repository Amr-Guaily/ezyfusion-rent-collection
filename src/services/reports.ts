import { requireStaff, type Caller } from '@/lib/auth/getCaller'
import { prisma } from '@/lib/db/prisma'

/**
 * Total of approved payments per calendar month of received_at in Malaysia time,
 * one entry per month from `from` to `to` inclusive, including months with nothing.
 *
 * Month boundaries are Malaysia midnights: `month::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur'`
 * turns a local midnight into the instant it happens, so a payment at 2026-03-01 00:30 MYT
 * (2026-02-28 16:30 UTC) lands in March. generate_series supplies the empty months.
 */
export async function collectionsReport(
  caller: Caller,
  from: string, // 'YYYY-MM'
  to: string, // 'YYYY-MM'
): Promise<{ month: string; collectedSen: number }[]> {
  requireStaff(caller)
  const rows = await prisma.$queryRaw<{ month: string; collected: bigint }[]>`
    WITH months AS (
      SELECT generate_series(to_date(${from}, 'YYYY-MM'), to_date(${to}, 'YYYY-MM'), interval '1 month')::date AS start
    )
    SELECT to_char(m.start, 'YYYY-MM') AS month,
           COALESCE(SUM(p.amount_sen), 0)::bigint AS collected
      FROM months m
      LEFT JOIN payments p
        ON p.org_id = ${caller.orgId}::uuid
       AND p.status = 'approved'
       AND p.received_at >= (m.start::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
       AND p.received_at <  ((m.start + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
     GROUP BY m.start
     ORDER BY m.start`
  return rows.map((row) => ({ month: row.month, collectedSen: Number(row.collected) }))
}
