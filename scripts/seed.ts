// npm run seed — creates exactly the brief's section 2 data on a freshly reset database:
//   npx supabase db reset && npm run seed
// Accounts are created with the auth admin API. Organizations, memberships, units and
// tenants are plain inserts (the app has no endpoints for them). Leases and payments go
// through the real services with the right actor, so the invoices and allocations are
// exactly what the app itself would produce. Deterministic; not re-runnable without a reset.

import { createClient } from '@supabase/supabase-js'
import { loadCaller } from '@/lib/auth/getCaller'
import { prisma } from '@/lib/db/prisma'
import { serverEnv } from '@/lib/env'
import { parseMalaysiaLocal, toMalaysiaIso } from '@/lib/myt'
import { createAdminClient, SLIP_BUCKET } from '@/lib/supabase/admin'
import { createLease } from '@/services/leases'
import { approvePayment, recordPayment } from '@/services/payments'

const PASSWORD = 'Rent2026!demo'

// 1x1 transparent PNG: the slip for Aisyah's bank transfer.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
)

const ACCOUNTS = [
  'manager@northwind.test',
  'staff@northwind.test',
  'aisyah@northwind.test',
  'ben@northwind.test',
  'probe@northwind.test',
  'manager@beta.test',
  'chen@beta.test',
] as const
type Email = (typeof ACCOUNTS)[number]

/** Malaysia wall-clock 'YYYY-MM-DDTHH:mm' as the API's ISO-with-offset instant. */
const myt = (local: string) => toMalaysiaIso(parseMalaysiaLocal(local))

async function createUsers(): Promise<Record<Email, string>> {
  const admin = createAdminClient()
  const ids = {} as Record<Email, string>
  for (const email of ACCOUNTS) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error) throw new Error(`Could not create ${email}: ${error.message}`)
    ids[email] = data.user.id
  }
  return ids
}

/** Uploads the slip as the staff member, through the storage RLS policy a real upload uses. */
async function uploadSlipAsStaff(orgId: string): Promise<string> {
  const env = serverEnv()
  const staff = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: signInError } = await staff.auth.signInWithPassword({ email: 'staff@northwind.test', password: PASSWORD })
  if (signInError) throw new Error(`Staff sign-in failed: ${signInError.message}`)
  const path = `${orgId}/seed-aisyah-bank-transfer-2026-03-01.png`
  const { error } = await staff.storage.from(SLIP_BUCKET).upload(path, TINY_PNG, { contentType: 'image/png', upsert: false })
  if (error) throw new Error(`Slip upload failed: ${error.message}`)
  return path
}

async function main() {
  if ((await prisma.organizations.count()) > 0) {
    throw new Error('The database already has data. Run `npx supabase db reset` first, then `npm run seed`.')
  }

  const users = await createUsers()

  const northwind = await prisma.organizations.create({ data: { name: 'Northwind Properties' } })
  const beta = await prisma.organizations.create({ data: { name: 'Beta Realty' } })

  await prisma.memberships.createMany({
    data: [
      { user_id: users['manager@northwind.test'], org_id: northwind.id, role: 'manager' },
      { user_id: users['staff@northwind.test'], org_id: northwind.id, role: 'staff' },
      { user_id: users['manager@beta.test'], org_id: beta.id, role: 'manager' },
    ],
  })

  const unit = async (orgId: string, name: string) =>
    (await prisma.units.create({ data: { org_id: orgId, name }, select: { id: true } })).id
  const tenant = async (orgId: string, email: Email, fullName: string) =>
    (
      await prisma.tenants.create({
        data: { org_id: orgId, user_id: users[email], full_name: fullName, email },
        select: { id: true },
      })
    ).id

  const unitA = await unit(northwind.id, 'A-12-3')
  const unitB = await unit(northwind.id, 'B-05-1')
  const unitC = await unit(northwind.id, 'C-01-7')
  await unit(northwind.id, 'D-03-2') // no lease
  const unitKL = await unit(beta.id, 'KL-1')

  const aisyah = await tenant(northwind.id, 'aisyah@northwind.test', 'Aisyah Rahman')
  const ben = await tenant(northwind.id, 'ben@northwind.test', 'Ben Lim')
  const probe = await tenant(northwind.id, 'probe@northwind.test', 'Probe Tenant')
  const chen = await tenant(beta.id, 'chen@beta.test', 'Chen Wei')

  // Actors, loaded the same way getCaller does for a request.
  const northwindManager = await loadCaller(users['manager@northwind.test'])
  const northwindStaff = await loadCaller(users['staff@northwind.test'])
  const betaManager = await loadCaller(users['manager@beta.test'])

  const aisyahLease = await createLease(northwindManager, {
    unitId: unitA, tenantId: aisyah, startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000,
  })
  await createLease(northwindManager, {
    unitId: unitB, tenantId: ben, startDate: '2026-01-01', endDate: '2026-04-15', monthlyRentSen: 100029, depositSen: 0,
  })
  await createLease(northwindManager, {
    unitId: unitC, tenantId: probe, startDate: '2026-02-28', endDate: '2027-02-27', monthlyRentSen: 200000, depositSen: 400000,
  })
  await createLease(betaManager, {
    unitId: unitKL, tenantId: chen, startDate: '2026-03-15', endDate: '2027-03-14', monthlyRentSen: 220000, depositSen: 440000,
  })

  // Aisyah's payments. Cash recorded by the manager: approved and allocated at once.
  const cash = await recordPayment(northwindManager, aisyahLease, {
    amountSen: 300000, method: 'cash', receivedAt: myt('2026-01-31T10:00'),
  })
  // Bank transfer recorded by staff with a slip (pending), then approved by the manager.
  const slipPath = await uploadSlipAsStaff(northwind.id)
  const transfer = await recordPayment(northwindStaff, aisyahLease, {
    amountSen: 200000, method: 'bank_transfer', receivedAt: myt('2026-03-01T00:30'), slipPath,
  })
  const approved = await approvePayment(northwindManager, transfer.id)

  console.log('Seeded:')
  console.log(`  ${ACCOUNTS.length} accounts, password ${PASSWORD}`)
  console.log('  Northwind Properties: units A-12-3, B-05-1, C-01-7, D-03-2; leases for Aisyah, Ben, Probe')
  console.log('  Beta Realty: unit KL-1; lease for Chen')
  console.log(`  Aisyah lease ${aisyahLease}: cash ${cash.status}, bank transfer ${transfer.status} -> ${approved.status}`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
