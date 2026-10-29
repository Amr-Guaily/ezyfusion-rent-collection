import { z } from 'zod'

// Server-side environment, validated on first use (not at import) so that modules
// importing this stay loadable in unit tests. NEXT_PUBLIC_* values are inlined into
// the browser bundle by Next; everything else stays on the server.
const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  GATEWAY_X_SIGNATURE_KEY: z.string().min(1),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | undefined

export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverEnvSchema.safeParse(process.env)
    if (!parsed.success) {
      // Report names only, never values.
      const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
      throw new Error(`Invalid or missing environment variables: ${names}`)
    }
    cached = parsed.data
  }
  return cached
}

// The browser can only see NEXT_PUBLIC_* values, and Next inlines them only when
// they are referenced literally as process.env.NEXT_PUBLIC_..., so read them that way.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
})

export function publicEnv(): z.infer<typeof publicEnvSchema> {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  })
}
