-- Tables, constraints and the audit_log append-only triggers (brief sections 4, 7, 8). RLS and grants: 0200. Storage: 0300.

-- Extension in `extensions`, NOT public: btree_gist adds ~100 functions; in public they'd be callable via /rest/v1/rpc.
create extension if not exists btree_gist with schema extensions;

create type public.membership_role     as enum ('manager','staff');
create type public.invoice_kind        as enum ('deposit','rent');
create type public.payment_method      as enum ('cash','bank_transfer','online');
create type public.payment_status      as enum ('pending_verification','approved','rejected','voided');
create type public.gateway_bill_status as enum ('pending','paid','failed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid primary key,   -- auth.users id; PK => exactly one org per staff/manager. No FK: Prisma db pull rejects cross-schema FKs
  org_id  uuid not null references public.organizations(id),
  role    public.membership_role not null,
  created_at timestamptz not null default now()
);
create index on public.memberships(org_id);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)                                   -- target for composite FKs
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid,   -- auth.users id (no FK, see memberships)
  full_name text not null,
  email text not null,
  phone text check (phone is null or length(btrim(phone)) between 3 and 32),  -- loose on purpose: Data API callers use unpredictable formats
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  unique (id, org_id)
);
create index on public.tenants(user_id);

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  unit_id uuid not null,
  tenant_id uuid not null,
  start_date date not null,
  end_date date not null,
  monthly_rent_sen bigint not null check (monthly_rent_sen > 0),
  deposit_sen bigint not null check (deposit_sen >= 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (unit_id, org_id)   references public.units(id, org_id),     -- DB refuses cross-org unit
  foreign key (tenant_id, org_id) references public.tenants(id, org_id),   -- DB refuses cross-org tenant
  unique (id, org_id),
  constraint leases_no_overlap exclude using gist
    (unit_id with =, daterange(start_date, end_date, '[]') with &&)       -- 23P01 -> 409
);
create index on public.leases(org_id);
create index on public.leases(tenant_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lease_id uuid not null,
  kind public.invoice_kind not null,
  period_index int,
  period_start date,
  period_end date,
  due_date date not null,
  amount_sen bigint not null check (amount_sen >= 0),   -- >= 0, not > 0: a 1-sen rent prorated over 1/31 rounds to 0
  created_at timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases(id, org_id),
  check (
    (kind = 'deposit' and period_index is null and period_start is null and period_end is null)
    or (kind = 'rent' and period_index >= 0 and period_start is not null and period_end >= period_start)
  ),
  unique nulls not distinct (lease_id, period_index),   -- only the deposit has a null period_index => one deposit per lease
  unique (id, org_id)
);
create index on public.invoices(lease_id, due_date);
create index on public.invoices(org_id, due_date);

create table public.gateway_bills (
  id text primary key check (id ~ '^bill_[0-9a-f]{32}$'),
  org_id uuid not null,
  lease_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  status public.gateway_bill_status not null default 'pending',
  transaction_id text,
  paid_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases(id, org_id),
  unique (id, org_id)
);
create index on public.gateway_bills(lease_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lease_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  unapplied_sen bigint not null default 0 check (unapplied_sen >= 0 and unapplied_sen <= amount_sen),
  method public.payment_method not null,
  status public.payment_status not null,
  received_at timestamptz not null,
  slip_path text unique,                                -- one slip, one payment (also makes orphan cleanup safe)
  gateway_bill_id text unique,                          -- a bill creates at most one payment, ever
  recorded_by uuid,                                     -- null for webhook
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases(id, org_id),
  foreign key (gateway_bill_id, org_id) references public.gateway_bills(id, org_id),
  unique (gateway_bill_id, org_id),                     -- lets Prisma model the composite FK as one-to-one
  check ((method = 'bank_transfer') = (slip_path is not null)),
  check ((method = 'online') = (gateway_bill_id is not null)),
  check (slip_path is null or starts_with(slip_path, org_id::text || '/')),
  check (method <> 'online' or status in ('approved','voided')),
  check (status not in ('rejected','voided') or length(btrim(review_reason)) >= 5),
  unique (id, org_id)
);
create index on public.payments(lease_id, status);
create index on public.payments(org_id, status, received_at);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  created_at timestamptz not null default now(),
  foreign key (payment_id, org_id) references public.payments(id, org_id),
  foreign key (invoice_id, org_id) references public.invoices(id, org_id),
  unique (payment_id, invoice_id)
);
create index on public.payment_allocations(invoice_id);
create index on public.payment_allocations(org_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  actor_id uuid,                                        -- null = gateway/system
  action text not null,                                 -- lease.created | payment.approved | payment.rejected | payment.voided
  entity_id text not null,                              -- text: holds uuids and bill ids
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_log(org_id, created_at desc);

create schema app;                                      -- not in config.toml [api].schemas => not reachable via REST/RPC
create function app.forbid_audit_change() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function app.forbid_audit_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.forbid_audit_change();   -- a row trigger does NOT cover TRUNCATE
