import { redirect } from 'next/navigation'
import { isStaff } from '@/lib/auth/getCaller'
import { requirePageCaller } from '@/lib/auth/page'

// Sends each signed-in person home: staff and managers to the dashboard, tenants to their portal.
export default async function Home() {
  const caller = await requirePageCaller()
  redirect(isStaff(caller) ? '/dashboard' : '/portal')
}
