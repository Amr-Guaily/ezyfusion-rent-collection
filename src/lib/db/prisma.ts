import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { serverEnv } from '@/lib/env'

// Connects as the database owner: RLS does not apply. Authorization is enforced
// in getCaller and the services, which scope every query by the caller's org.

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: serverEnv().DATABASE_URL, max: 20 })
  return new PrismaClient({
    adapter,
    // Payment mutations serialise on a lease row lock; concurrent requests on one
    // lease queue behind it, so allow more than the 2s/5s defaults.
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  })
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>

const globalForPrisma = globalThis as unknown as { prisma?: AppPrismaClient }

export const prisma: AppPrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export type Tx = Parameters<Parameters<AppPrismaClient['$transaction']>[0]>[0]
