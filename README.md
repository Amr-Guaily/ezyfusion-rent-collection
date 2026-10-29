# Rent collection

Rent collection for Malaysian property management companies: leases produce a deposit and monthly rent invoices, and tenants pay by cash, bank transfer (with a slip) or online through a payment gateway. Staff record payments, managers approve, reject and void them, and tenants see their own lease and pay online.

Stack: Next.js 16 (App Router), TypeScript (strict), Supabase local (Postgres, Auth, Storage), Prisma 7 with the pg adapter, shadcn/ui, Tailwind CSS, Vitest. Business timezone Asia/Kuala_Lumpur, currency MYR.

## Run it

Needs Docker and Node 24 (npm 11). From a fresh clone, exactly as the brief's section 2:

```bash
npx supabase start          # starts the stack from supabase/config.toml
npx supabase db reset       # rebuilds the database from supabase/migrations/
npm install                 # also runs prisma generate
cp .env.example .env.local  # replace keys with `npx supabase status` values if they differ
npm run seed
npm run build && npm start  # http://localhost:3000
```

`npm run seed` only runs on a freshly reset database; it refuses otherwise. To start over: `npx supabase db reset && npm run seed`.

### Environment

All six variables are in `.env.example` with local values and a comment saying where each comes from.

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` in `npx supabase status` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` in `npx supabase status` (safe in the browser) |
| `SUPABASE_SECRET_KEY` | `SECRET_KEY` in `npx supabase status` (server only, never `NEXT_PUBLIC_`) |
| `DATABASE_URL` | `DB_URL` in `npx supabase status` (Prisma at runtime) |
| `DIRECT_URL` | same as `DB_URL` locally (Prisma CLI) |
| `GATEWAY_X_SIGNATURE_KEY` | shared with the gateway; `test_x_signature_key` locally, matching the brief's test vector |

## Seeded accounts

Every account's password is **`Rent2026!demo`**.

| Organization | Account | Role | Notes |
|---|---|---|---|
| Northwind Properties | manager@northwind.test | manager | |
| Northwind Properties | staff@northwind.test | staff | |
| Northwind Properties | aisyah@northwind.test | tenant | Aisyah Rahman |
| Northwind Properties | ben@northwind.test | tenant | Ben Lim |
| Northwind Properties | probe@northwind.test | tenant | Probe Tenant |
| Beta Realty | manager@beta.test | manager | |
| Beta Realty | chen@beta.test | tenant | Chen Wei |

| Organization | Unit | Tenant | Start | End | Monthly rent | Deposit |
|---|---|---|---|---|---|---|
| Northwind | A-12-3 | Aisyah Rahman | 2026-01-31 | 2026-07-15 | RM 1,500.00 | RM 3,000.00 |
| Northwind | B-05-1 | Ben Lim | 2026-01-01 | 2026-04-15 | RM 1,000.29 | none |
| Northwind | C-01-7 | Probe Tenant | 2026-02-28 | 2027-02-27 | RM 2,000.00 | RM 4,000.00 |
| Northwind | D-03-2 | (no lease) | | | | |
| Beta | KL-1 | Chen Wei | 2026-03-15 | 2027-03-14 | RM 2,200.00 | RM 4,400.00 |

Aisyah's payments: RM 3,000.00 cash received 2026-01-31 10:00 Malaysia time, recorded by the manager (approved at once); and RM 2,000.00 bank transfer received 2026-03-01 00:30 Malaysia time, recorded by staff with a slip and then approved by the manager. The seed creates leases and payments through the real services (`createLease`, `recordPayment`, `approvePayment`) with the right actor, and uploads the slip as the staff user through the storage policy. Northwind's collections for 2026-01 to 2026-03 are 300000 / 0 / 200000 sen.

## Tests and checks

```bash
npm run lint
npm run typecheck   # next typegen && tsc --noEmit
npm test            # vitest
```

The unit tests cover:

- `src/lib/billing.ts`: the Aisyah worked example, half-up proration (Ben's last period, 50014.5 sen rounds to 50015), anchors on the 31st and on Feb 29, invalid dates and amounts, the overdue boundary at 2026-03-01T16:00:00Z, and the `parseRinggitToSen` vectors. All of it runs under `TZ=UTC`, `Asia/Kuala_Lumpur` and `America/New_York`.
- `src/lib/myt.ts` and the gateway signature, including the brief's test vector.
- Webhook form parsing, the pure allocation planner, error-to-status mapping, and display formatting.

### Concurrency check

[`scripts/concurrency-check.ts`](scripts/concurrency-check.ts) fires truly parallel HTTP requests at a running app, then checks the database. It changes data, so run it on a fresh seed:

```bash
npx supabase db reset && npm run seed
npm run build && npm start         # or npm run dev; keep it running
npm run check:concurrency          # in a second shell; BASE_URL defaults to http://localhost:3000
```

Each race runs for several rounds:

| Race | Expected result |
|---|---|
| Two staff payments on Ben's lease that together exceed the cap | one 201, one 422 |
| Two approves of the same payment | one 200, one 409, allocated once |
| Two overlapping leases on D-03-2 | one 201, one 409, one lease stored |
| Two identical `paid=true` webhook deliveries | 200 and 200, one payment |

The script exits non-zero if any check fails.

## Paying online with the gateway simulator

1. Sign in as a tenant, for example `ben@northwind.test`, and press **Pay now** on the portal. The page shows the new bill id and amount. To create a bill over the API instead, use `POST /api/leases/:leaseId/gateway-bills` with the tenant's Bearer token.
2. Play the gateway:

   ```bash
   GATEWAY_X_SIGNATURE_KEY=test_x_signature_key node gateway-sim.mjs <bill_id> <amount_sen> true
   ```

   Pass `false` instead of `true` for a failed payment. Set `WEBHOOK_URL` to call something other than `http://localhost:3000/api/webhooks/gateway`.
3. Open `/payments/return?bill_id=<bill_id>&paid=true`. The page only reads the bill's status from the database. It ignores `paid` and changes nothing: only the signed webhook settles a bill.

The webhook's responses follow the brief's table:

| Callback | Response |
|---|---|
| Missing or wrong signature | 401 |
| Unknown bill | 404 |
| `paid=true` with the wrong amount | 422 |
| Anything else, including repeat and late deliveries | 200 |

A bill creates at most one payment, ever, and `received_at` is the gateway's `paid_at`.

## What works

- **Billing rules** (`src/lib/billing.ts`): pure and independent of the machine's timezone. The app uses them for lease creation, statuses and payment amounts.
- **HTTP API**: every endpoint in the brief's section 7. They accept a Bearer token or the session cookie, and return 401, 403 and 404 per section 6.
- **Lease creation**: stores the lease and exactly the invoices `generateSchedule` returns, all or nothing. Overlaps on a unit are refused (409), even for simultaneous requests.
- **Payments**:
  - Record with the cap, which counts pending payments.
  - Approve, which re-checks the remaining balance.
  - Reject and void, each with a reason.
  - Allocation by due date, then deposit before rent, then period index; anything left over is stored as `unapplied_sen`.
  - An `audit_log` row for every lease creation, approval, rejection and void.
- **Slips**: private `payment-slips` bucket, stored under `<org_id>/…`. A slip must be a JPEG, PNG or PDF of at most 5 MB. An unused slip is deleted when recording fails, and staff view slips through short-lived signed URLs.
- **Gateway**: unguessable bill ids (128 random bits), a signed webhook with a timing-safe compare, and idempotent, concurrency-safe settlement.
- **Collections report**: totals by Malaysia calendar month, including months with nothing collected.
- **Data API and Storage**:
  - RLS and grants follow the brief's matrix.
  - Anonymous users get nothing.
  - A tenant can update only their own phone number.
  - `audit_log` is append-only for every role, including the table owner.
  - Public signups are disabled.
- **UI**:
  - Staff and managers: dashboard (overdue count, last 6 months of collections), leases list, lease page, and record, approve, reject and void with confirmation and a reason.
  - Tenants: a portal that reads through supabase-js under RLS, amount due now, Pay now, phone editing, and the read-only return page.
  - Every date and time is shown in Malaysia time, whatever the viewer's timezone.

## Known issues

- **Orphaned slips.** If the browser uploads a slip and then loses its connection before it calls the API, the slip stays in the bucket. The server only removes slips when the API call itself fails.
- **Several pending bills per lease.** A tenant can create more than one pending gateway bill for the same lease. If both are paid, the second becomes `unapplied_sen` on its payment.
- **Unapplied credit is never re-applied.** After a void reopens invoices, an online payment's `unapplied_sen` stays where it is, because other payments' allocations do not change. A manager has to sort it out.
- **No FK from `memberships.user_id` / `tenants.user_id` to `auth.users`.** `prisma db pull` rejects cross-schema foreign keys.
- **audit_log isn't tamper-proof against the owner.** Its append-only rule is a trigger, so the database owner could still disable or drop it.
- **Some summaries are computed in application code.** The overdue counts and the leases list do this, which is fine at seed scale but would need SQL aggregation for thousands of invoices.
- **Slip links expire.** They are created when the lease page renders and last 5 minutes; reload the page to get fresh ones.
- **Install scripts are blocked by default.** npm 11 does this for dependencies (esbuild, prisma). The app, tests and seed work without them, but `npm install` prints a warning.

## What I would do next

- A create-lease form with a live schedule preview. Leases are API-only today.
- Server-side search and pagination for the leases list, kept in the URL.
- Realtime updates on the tenant portal when the webhook settles a bill.
- Reuse a lease's open pending bill instead of creating another, and expire stale bills.
- A manager action to apply `unapplied_sen` credit to reopened invoices, recorded in the audit log.
- Integration tests for the API, RLS and Storage in CI, against a disposable Supabase stack.

## Design notes

1. Money is integer sen everywhere: `bigint` columns, `BigInt` in Prisma, `number` only at the JSON edge, and rounding only in `billing.ts`.
2. Every money movement (record, approve, void, webhook settle) runs in one transaction that first runs `SELECT … FOR UPDATE` on the lease row.
3. That lock serialises all payments on a lease, so the cap and balance checks read figures nobody can change before commit.
4. Lock order is always lease, then gateway bill, then invoices. `payments.gateway_bill_id` is UNIQUE as a backstop.
5. Lease overlap is a `btree_gist` exclusion constraint, so concurrent creations are refused by the database (23P01, mapped to 409).
6. RLS and grants are the wall for the Data API and Storage. Helper functions live in an unexposed `app` schema, so `/rpc` exposes nothing.
7. Prisma connects as the owner and bypasses RLS. Authorization happens in code: `getCaller` loads the role from `memberships` / `tenants.user_id`, and the services scope every query.
8. One timezone module, `src/lib/myt.ts`, handles every "today" and every date/instant conversion with a fixed +08:00 and never reads the machine's zone.
9. The collections report groups in SQL by Malaysia midnights (`AT TIME ZONE 'Asia/Kuala_Lumpur'`) with `generate_series`, so empty months appear.
10. `supabase/migrations/*.sql` is the single source of truth. `prisma db pull` regenerates `prisma/schema.prisma` from the database, so they cannot drift.
