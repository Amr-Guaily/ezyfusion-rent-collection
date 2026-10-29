'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/browser'

export function LoginForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    setError(null)
    startTransition(async () => {
      const { error: signInError } = await createClient().auth.signInWithPassword({ email, password })
      if (signInError) {
        setError('That email and password do not match an account.')
        toast.error('Sign-in failed')
        return
      }
      toast.success('Signed in')
      router.replace('/')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 grid gap-4" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={error !== null} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error !== null}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-ink-overdue">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
