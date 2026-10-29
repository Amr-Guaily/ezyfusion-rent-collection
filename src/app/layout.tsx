import type { Metadata } from 'next'
import { Public_Sans } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const publicSans = Public_Sans({ variable: '--font-public-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Rent collection',
  description: 'Leases, invoices and payments for property managers in Malaysia',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-MY" className={`${publicSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
