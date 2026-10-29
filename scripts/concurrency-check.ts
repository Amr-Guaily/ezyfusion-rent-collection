// Concurrency check: fires truly parallel requests at a running app and verifies the
// database invariants afterwards. It mutates data, so run it on a fresh seed:
//
//   npx supabase db reset && npm run seed
//   npm run dev            (or npm run build && npm start), then in another shell:
//   npm run check:concurrency
//
// BASE_URL defaults to http://localhost:3000. Exits non-zero if any invariant fails.
//
// 1. cap      two staff payments on Ben's lease that together exceed the cap   -> one 201, one 422
// 2. approve  two approves of the same pending payment                          -> one 200, one 409, allocated once
// 3. overlap  two POST /api/leases overlapping on unit D-03-2                    -> one 201, one 409, one lease
// 4. webhook  two identical paid=true deliveries for one bill                    -> 200 + 200, one payment

import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db/prisma'
import { serverEnv } from '@/lib/env'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const PASSWORD = 'Rent2026!demo'
const ROUNDS = 5

type Result = { status: number; body: Record<string, unknown> }

let failures = 0
function check(ok: boolean, message: string) {
  if (!ok) failures++
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${message}`)
}

async function token(email: string): Promise<string> {
  const env = serverEnv()
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD })
  if (error || !data.session) throw new Error(`Sign-in failed for ${email}: ${error?.message}`)
  return data.session.access_token
}

async function api(method: string, path: string, accessToken: string, body?: unknown): Promise<Result> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function webhook(form: Record<string, string>): Promise<Result> {
  const res = await fetch(`${BASE_URL}/api/webhooks/gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** Signs exactly like the gateway (brief section 5). Never prints the key. */
function signed(fields: Record<string, string>): Record<string, string> {
  const source = Object.keys(fields).sort().map((k) => `${k}${fields[k]}`).join('|')
  const x_signature = createHmac('sha256', serverEnv().GATEWAY_X_SIGNATURE_KEY).update(source).digest('hex')
  return { ...fields, x_signature }
}

const statuses = (results: Result[]) => results.map((r) => r.status).sort((a, b) => a - b)
const fmt = (results: Result[]) => results.map((r) => `${r.status} ${JSON.stringify(r.body)}`).join('\n             ')

async function leaseIdForUnit(unitName: string): Promise<string> {
  const lease = await prisma.leases.findFirstOrThrow({ where: { units: { name: unitName } }, select: { id: true } })
  return lease.id
}

/** Cap = invoices - allocated - pending, read straight from the database. */
async function capSen(leaseId: string): Promise<bigint> {
  const [row] = await prisma.$queryRaw<{ cap: bigint }[]>`
    SELECT (SELECT COALESCE(SUM(amount_sen), 0) FROM invoices WHERE lease_id = ${leaseId}::uuid)
         - (SELECT COALESCE(SUM(a.amount_sen), 0) FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id
             WHERE i.lease_id = ${leaseId}::uuid)
         - (SELECT COALESCE(SUM(amount_sen), 0) FROM payments WHERE lease_id = ${leaseId}::uuid AND status = 'pending_verification')
         AS cap`
  return BigInt(row.cap)
}

async function main() {
  console.log(`Concurrency check against ${BASE_URL}, ${ROUNDS} rounds per race\n`)
  const [manager, staff, aisyah, probe, chen] = await Promise.all(
    ['manager@northwind.test', 'staff@northwind.test', 'aisyah@northwind.test', 'probe@northwind.test', 'chen@beta.test'].map(token),
  )
  const benLease = await leaseIdForUnit('B-05-1')
  const receivedAt = '2026-04-01T09:00:00+08:00'

  // ------------------------------------------------------------------ 1. cap
  console.log("1. Two staff payments on Ben's lease that together exceed the cap")
  for (let round = 1; round <= ROUNDS; round++) {
    const cap = await capSen(benLease)
    const each = cap / 2n + 1n // each fits under the cap alone; both together exceed it by 2 sen
    const results = await Promise.all([
      api('POST', `/api/leases/${benLease}/payments`, staff, { amountSen: Number(each), method: 'cash', receivedAt }),
      api('POST', `/api/leases/${benLease}/payments`, staff, { amountSen: Number(each), method: 'cash', receivedAt }),
    ])
    console.log(`  round ${round}: cap ${cap} sen, 2 x ${each} sen`)
    console.log(`    responses  ${fmt(results)}`)
    check(JSON.stringify(statuses(results)) === '[201,422]', 'exactly one accepted (201) and one refused (422)')
    const capAfter = await capSen(benLease)
    check(capAfter >= 0n, `cap never goes negative (now ${capAfter} sen)`)
    // Reject the accepted one so the next round starts from the full cap again.
    const accepted = results.find((r) => r.status === 201)
    if (accepted) await api('POST', `/api/payments/${String(accepted.body.id)}/reject`, manager, { reason: 'concurrency check' })
  }

  // ------------------------------------------------------------------ 2. approve
  console.log('\n2. Two approves of the same pending payment')
  for (let round = 1; round <= ROUNDS; round++) {
    const recorded = await api('POST', `/api/leases/${benLease}/payments`, staff, { amountSen: 1000, method: 'cash', receivedAt })
    const paymentId = String(recorded.body.id)
    const results = await Promise.all([
      api('POST', `/api/payments/${paymentId}/approve`, manager),
      api('POST', `/api/payments/${paymentId}/approve`, manager),
    ])
    const allocations = await prisma.payment_allocations.aggregate({ where: { payment_id: paymentId }, _sum: { amount_sen: true }, _count: true })
    const auditRows = await prisma.audit_log.count({ where: { entity_id: paymentId, action: 'payment.approved' } })
    console.log(`  round ${round}: payment ${paymentId} (1000 sen)`)
    console.log(`    responses  ${fmt(results)}`)
    check(JSON.stringify(statuses(results)) === '[200,409]', 'exactly one approved (200) and one refused (409)')
    check(allocations._sum.amount_sen === 1000n, `allocated exactly once: ${allocations._count} allocation row(s) summing to ${allocations._sum.amount_sen} sen`)
    check(auditRows === 1, `one payment.approved audit row (found ${auditRows})`)
  }

  // ------------------------------------------------------------------ 3. overlap
  console.log('\n3. Two POST /api/leases overlapping on unit D-03-2')
  const unitD = await prisma.units.findFirstOrThrow({ where: { name: 'D-03-2' }, select: { id: true } })
  const probeTenant = await prisma.tenants.findFirstOrThrow({ where: { email: 'probe@northwind.test' }, select: { id: true } })
  for (let round = 1; round <= ROUNDS; round++) {
    const year = 2030 + round // each round uses its own year so rounds never overlap each other
    const a = { startDate: `${year}-01-01`, endDate: `${year}-06-30` }
    const b = { startDate: `${year}-06-30`, endDate: `${year}-12-31` } // shares one day with a (both ends inclusive)
    const lease = (dates: { startDate: string; endDate: string }) => ({
      unitId: unitD.id, tenantId: probeTenant.id, monthlyRentSen: 100000, depositSen: 0, ...dates,
    })
    const results = await Promise.all([api('POST', '/api/leases', manager, lease(a)), api('POST', '/api/leases', manager, lease(b))])
    const stored = await prisma.leases.count({
      where: { unit_id: unitD.id, start_date: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
    })
    console.log(`  round ${round}: ${a.startDate}..${a.endDate} and ${b.startDate}..${b.endDate}`)
    console.log(`    responses  ${fmt(results)}`)
    check(JSON.stringify(statuses(results)) === '[201,409]', 'exactly one created (201) and one refused (409)')
    check(stored === 1, `one lease stored for ${year} (found ${stored})`)
  }
  const orphanInvoices = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM leases l WHERE l.id = i.lease_id)`
  check(orphanInvoices[0].n === 0n, 'no invoices left behind by the refused leases')

  // ------------------------------------------------------------------ 4. webhook
  console.log('\n4. Two identical paid=true webhook deliveries for one bill')
  const payers = [
    { name: 'Aisyah', token: aisyah, lease: await leaseIdForUnit('A-12-3') },
    { name: 'Probe', token: probe, lease: await leaseIdForUnit('C-01-7') },
    { name: 'Chen', token: chen, lease: await leaseIdForUnit('KL-1') },
  ]
  for (const [index, payer] of payers.entries()) {
    const bill = await api('POST', `/api/leases/${payer.lease}/gateway-bills`, payer.token)
    const billId = String(bill.body.billId)
    const form = signed({
      id: billId,
      paid: 'true',
      paid_amount: String(bill.body.amountSen),
      paid_at: '2026-10-29 12:00:00 +0800',
      transaction_id: `TX-CHECK-${index + 1}`,
      transaction_status: 'completed',
    })
    const results = await Promise.all([webhook(form), webhook(form)]) // byte-identical bodies
    const payments = await prisma.payments.findMany({ where: { gateway_bill_id: billId }, select: { amount_sen: true, received_at: true } })
    const billRow = await prisma.gateway_bills.findUniqueOrThrow({ where: { id: billId }, select: { status: true } })
    console.log(`  ${payer.name}: bill ${billId} for ${String(bill.body.amountSen)} sen`)
    console.log(`    responses  ${fmt(results)}`)
    check(JSON.stringify(statuses(results)) === '[200,200]', 'both deliveries answered 200')
    check(payments.length === 1, `one payment for the bill (found ${payments.length})`)
    check(billRow.status === 'paid', `bill is paid (${billRow.status})`)
    check(payments[0]?.received_at.toISOString() === '2026-10-29T04:00:00.000Z', 'received_at = paid_at (2026-10-29 12:00 MYT)')
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
