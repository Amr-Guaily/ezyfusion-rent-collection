import Link from 'next/link'
import { SignOutButton } from '@/components/sign-out-button'

const ROLE_LABEL = { manager: 'Manager', staff: 'Front desk', tenant: 'Tenant' } as const

export function AppHeader({
  title,
  email,
  role,
  nav,
}: {
  title: string
  email: string
  role: keyof typeof ROLE_LABEL
  nav: { href: string; label: string }[]
}) {
  return (
    <header className="border-b border-rule bg-card">
      <div className="mx-auto flex max-w-[70rem] flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3">
        <Link href="/" className="font-bold tracking-tight">
          {title}
        </Link>
        <nav aria-label="Main" className="flex gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {email} <span className="text-foreground">({ROLE_LABEL[role]})</span>
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  )
}
