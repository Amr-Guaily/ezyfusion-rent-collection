import { LoginForm } from './login-form'

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { error } = await searchParams
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Sign in to rent collection</h1>
      <p className="mt-2 text-sm text-muted-foreground">Use the email and password your property manager gave you.</p>
      {error === 'no-access' && (
        <p role="alert" className="mt-4 rounded-md border border-ink-overdue/40 bg-ink-overdue/5 px-3 py-2 text-sm text-ink-overdue">
          This account is not linked to an organization or a tenancy yet. Ask your property manager to add you.
        </p>
      )}
      <LoginForm />
    </main>
  )
}
