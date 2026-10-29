# Project rules

Rent collection system for property managers. Next.js 16 (App Router, TypeScript), Supabase local (Postgres, Auth, RLS, Storage), Prisma 7 with pg adapter, shadcn/ui, Tailwind, Vitest, npm (graders run npm install / npm run seed / npm run build && npm start).

`docs/brief.md` is the contract: its table names, column names, endpoint paths, file paths and response shapes are used verbatim by hidden tests. `docs/plan.md` is the approved build plan.

## Non-negotiables
- Money is integer sen (`*_sen` bigint); currency MYR. `BigInt` in Prisma, `number` only at the JSON edge. No float arithmetic on money. Rounding happens only in `src/lib/billing.ts` (pure, tested directly by the graders).
- Due dates and billing periods are `date` columns. Timestamps are `timestamptz`. Business timezone is fixed: Asia/Kuala_Lumpur (UTC+8, no DST). Every "today" and every date<->instant conversion goes through `src/lib/myt.ts`; billing.ts inlines its own +8h shift so it stays self-contained. Date math on (year, month, day) integers or `Date.UTC` only; never local getters, never `new Date('YYYY-MM-DD...')` local parsing, never `setMonth`.
- Authorization is server-side in `src/lib/auth/getCaller.ts`: role and org come from `memberships` (staff/manager) or `tenants.user_id` (tenant), never `user_metadata`. No login -> 401; record in another org or another tenant's record -> 404; visible record but role not allowed -> 403. IDs in bodies are checked against the caller's org (foreign unit/tenant -> 404).
- Prisma connects as the DB owner, so RLS does not apply to it. RLS + grants are the wall for the Data API and Storage, exactly per the brief's matrix.
- Payment mutations (record, approve, void, webhook settle) run in one transaction that first locks the lease: `SELECT id FROM leases WHERE id = $1 FOR UPDATE`. Lock order everywhere: lease -> gateway bill -> invoices. A bill creates at most one payment (`payments.gateway_bill_id` UNIQUE + bill row `FOR UPDATE`).
- Webhook signature verified with a timing-safe compare before any processing. Never log the secret key or whole callback payloads.
- Zod validates every request body, query and env var. Amounts in the API are integers.
- One error helper (`src/lib/http.ts`) maps domain errors to HTTP responses. Errors are `{ "error": "message" }`. No stack traces to clients.

## Stack rules
- Next.js 16: `src/proxy.ts` (not middleware.ts); `cookies()`, `headers()`, `params`, `searchParams` are awaited; route handlers in `src/app/api/**/route.ts`; webhook route reads raw body with `req.text()`.
- Supabase SSR client from `@supabase/ssr` for auth, `supabase.auth.getUser()` on the server (never `getSession()`); secret-key client only in server code, never in `NEXT_PUBLIC_*`.
- Migrations: `supabase/migrations/*.sql` is the single source of truth, hand-written (tables, constraints, RLS, grants, triggers, storage). After `npx supabase db reset`, `prisma db pull` regenerates `prisma/schema.prisma` so it matches the database. Never run `prisma migrate dev`.
- Prisma pinned to 7.10.1 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`).
- Seed: `npx supabase db reset` then `npm run seed` (tsx script: auth users via admin API, then domain data THROUGH the real service functions, as the brief requires). Deterministic; runs once on a fresh reset.

## Working style
- Small slices. Each slice: plan, test for the edge case, implement, run `npm test`, summarise diff, commit.
- No new dependencies without saying why in the response.
- Do not build what the spec did not ask for. If something seems needed but isn't in the spec, say so and stop.
- When unsure, ask one precise question instead of guessing.

## Commands
- `npm run dev` / `npm run build` / `npm run lint` / `npm run typecheck` / `npm test` / `npm run seed`
- `npx supabase start|stop|status` / `npx supabase db reset`
