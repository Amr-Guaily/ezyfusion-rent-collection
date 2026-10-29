'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/browser'

export function SignOutButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const { error } = await createClient().auth.signOut()
          if (error) {
            toast.error(`Could not sign out: ${error.message}`)
            return
          }
          toast.success('Signed out')
          router.replace('/login')
          router.refresh()
        })
      }
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
