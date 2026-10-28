# Project rules

Rent collection system for property managers. Next.js 16 (App Router, TypeScript), Supabase local (Postgres, Auth, RLS), Prisma 7 with pg adapter, shadcn/ui, Tailwind, Vitest, npm (graders run npm install / npm run seed / npm run build && npm start).

## Non-negotiables
- Money is integer sen (`*_sen` bigint); currency MYR. No float arithmetic on money. Rounding happens only in `src/lib/billing.ts` (pure, tested directly by the graders).
- Due dates and billing periods are `date` columns. Timestamps are `timestamptz`. Date math uses the property's IANA timezone. Never mutate a `Date` with setMonth for billing periods.
- Every mutation checks authorization server-side from the `profiles` table and scopes by `organization_id`. Never trust role or org from the client.
- Payments are idempotent: unique `idempotency_key`; webhook events deduped by unique `(provider, event_id)`; webhook signature verified with a timing-safe compare before any processing.
- Payment application runs in one transaction with `SELECT ... FOR UPDATE` on the invoice.
- Zod validates every request body, query and env var. Amounts in the API are integers.
- One error helper maps domain errors to HTTP responses. No stack traces to clients.

## Stack rules
- Next.js 16: `proxy.ts` (not middleware.ts); `cookies()`, `headers()`, `params`, `searchParams` are awaited; route handlers in `app/api/**/route.ts`; webhook route reads raw body with `req.text()`.
- Supabase SSR client from `@supabase/ssr` for auth; service-role client only in server code, never in `NEXT_PUBLIC_*`.
- Migrations: `supabase/migrations/*.sql` is the single source of truth. Prisma schema is the model; generate SQL with `prisma migrate diff`. Never run `prisma migrate dev`. Hand-written SQL for RLS, triggers, constraints.
- Prisma pinned to 7.10.1 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`).
- Seed: `npx supabase db reset` then `npm run seed` (tsx script: auth users via admin API, then domain data THROUGH the real service functions, as the brief requires). Deterministic.

## Working style
- Small slices. Each slice: plan, test for the edge case, implement, run `npm test`, summarise diff.
- No new dependencies without saying why in the response.
- Do not build what the spec did not ask for. If something seems needed but isn't in the spec, say so and stop.
- When unsure, ask one precise question instead of guessing.

## Commands
- `npm run dev` / `npm run build` / `npm run lint` / `npm run typecheck` / `npm test` / `npm run seed`
- `npx supabase start|stop|status` / `npx supabase db reset`
