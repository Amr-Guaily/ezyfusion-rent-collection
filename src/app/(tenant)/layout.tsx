import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { requirePageCaller } from '@/lib/auth/page'

export default async function TenantLayout({ children }: LayoutProps<'/'>) {
  const caller = await requirePageCaller()
  if (caller.kind !== 'tenant') redirect('/dashboard')
  return (
    <>
      <AppHeader title="My tenancy" email={caller.email} role="tenant" nav={[{ href: '/portal', label: 'My lease' }]} />
      <main className="mx-auto w-full max-w-[70rem] flex-1 px-5 py-8">{children}</main>
    </>
  )
}
