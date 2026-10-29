import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { isStaff } from '@/lib/auth/getCaller'
import { requirePageCaller } from '@/lib/auth/page'
import { prisma } from '@/lib/db/prisma'

export default async function StaffLayout({ children }: LayoutProps<'/'>) {
  const caller = await requirePageCaller()
  if (!isStaff(caller)) redirect('/portal')
  const org = await prisma.organizations.findUniqueOrThrow({ where: { id: caller.orgId }, select: { name: true } })
  return (
    <>
      <AppHeader
        title={org.name}
        email={caller.email}
        role={caller.kind}
        nav={[
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/leases', label: 'Leases' },
        ]}
      />
      <main className="mx-auto w-full max-w-[70rem] flex-1 px-5 py-8">{children}</main>
    </>
  )
}
