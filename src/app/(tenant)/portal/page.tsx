import { TenantPortal } from './tenant-portal'

// The portal reads the tenant's own rows straight from Supabase in the browser
// (RLS limits them to the tenant's own leases), as the brief asks.
export default function PortalPage() {
  return <TenantPortal />
}
