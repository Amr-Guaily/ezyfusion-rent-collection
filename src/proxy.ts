import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the Supabase session cookie on page requests. Not an authorization
// check: every route handler and page authorizes the caller itself.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
        },
      },
    },
  )
  await supabase.auth.getUser()
  return response
}

export const config = {
  // Pages only: API routes authorize per request (Bearer or cookie) and the webhook has no session.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
