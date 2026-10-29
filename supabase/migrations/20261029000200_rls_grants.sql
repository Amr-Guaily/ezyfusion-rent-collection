-- RLS and grants: the wall for the Supabase Data API (brief section 6).
-- Prisma connects as the table owner and is not subject to RLS (RLS is not forced).
-- Matrix: anon none; tenant reads own rows and updates only tenants.phone;
-- staff/manager read own org; audit_log manager only. No other writes for anyone.

-- Helpers. SECURITY DEFINER so policies on memberships/tenants don't recurse into themselves.
-- Schema `app` is not in [api].schemas, so none of these are reachable via /rest/v1/rpc.
create function app.member_org_id() returns uuid
  language sql stable security definer set search_path = ''
  as $$ select m.org_id from public.memberships m where m.user_id = auth.uid() $$;

create function app.member_role() returns public.membership_role
  language sql stable security definer set search_path = ''
  as $$ select m.role from public.memberships m where m.user_id = auth.uid() $$;

create function app.tenant_ids() returns setof uuid
  language sql stable security definer set search_path = ''
  as $$ select t.id from public.tenants t where t.user_id = auth.uid() $$;

create function app.tenant_org_ids() returns setof uuid
  language sql stable security definer set search_path = ''
  as $$ select t.org_id from public.tenants t where t.user_id = auth.uid() $$;

create function app.tenant_lease_ids() returns setof uuid
  language sql stable security definer set search_path = ''
  as $$ select l.id from public.leases l join public.tenants t on t.id = l.tenant_id where t.user_id = auth.uid() $$;

create function app.tenant_unit_ids() returns setof uuid
  language sql stable security definer set search_path = ''
  as $$ select l.unit_id from public.leases l join public.tenants t on t.id = l.tenant_id where t.user_id = auth.uid() $$;

alter table public.organizations       enable row level security;
alter table public.memberships         enable row level security;
alter table public.units               enable row level security;
alter table public.tenants             enable row level security;
alter table public.leases              enable row level security;
alter table public.invoices            enable row level security;
alter table public.gateway_bills       enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.audit_log           enable row level security;

create policy organizations_select on public.organizations for select to authenticated
  using (id = (select app.member_org_id()) or id in (select app.tenant_org_ids()));

create policy memberships_select on public.memberships for select to authenticated
  using (org_id = (select app.member_org_id()));

create policy units_select on public.units for select to authenticated
  using (org_id = (select app.member_org_id()) or id in (select app.tenant_unit_ids()));

create policy tenants_select on public.tenants for select to authenticated
  using (org_id = (select app.member_org_id()) or user_id = (select auth.uid()));

-- The only write policy. The column grant below limits it to `phone`.
create policy tenants_update_own_phone on public.tenants for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy leases_select on public.leases for select to authenticated
  using (org_id = (select app.member_org_id()) or tenant_id in (select app.tenant_ids()));

create policy invoices_select on public.invoices for select to authenticated
  using (org_id = (select app.member_org_id()) or lease_id in (select app.tenant_lease_ids()));

create policy gateway_bills_select on public.gateway_bills for select to authenticated
  using (org_id = (select app.member_org_id()) or lease_id in (select app.tenant_lease_ids()));

create policy payments_select on public.payments for select to authenticated
  using (org_id = (select app.member_org_id()) or lease_id in (select app.tenant_lease_ids()));

create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (
    org_id = (select app.member_org_id())
    or exists (
      select 1 from public.invoices i
      where i.id = invoice_id and i.lease_id in (select app.tenant_lease_ids())
    )
  );

create policy audit_log_select on public.audit_log for select to authenticated
  using (org_id = (select app.member_org_id()) and (select app.member_role()) = 'manager');

-- Grants. Supabase's default privileges give anon/authenticated ALL on new public objects; take it back.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

grant select on public.organizations, public.memberships, public.units, public.tenants, public.leases,
  public.invoices, public.payments, public.payment_allocations, public.gateway_bills, public.audit_log
  to authenticated;
grant update (phone) on public.tenants to authenticated;

-- Policies run as the caller, so authenticated needs EXECUTE on the helpers (and nobody else does).
revoke all on schema app from public;
grant usage on schema app to authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.member_org_id(), app.member_role(), app.tenant_ids(),
  app.tenant_org_ids(), app.tenant_lease_ids(), app.tenant_unit_ids() to authenticated;
