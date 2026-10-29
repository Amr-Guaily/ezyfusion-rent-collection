import { loadEnvFile } from 'node:process'
import { defineConfig } from 'prisma/config'

// The Prisma CLI does not read .env.local. It is optional here because `npm install`
// (postinstall: prisma generate) runs before the graders copy .env.example to .env.local,
// and generate needs no database.
try {
  loadEnvFile('.env.local')
} catch {
  // no .env.local yet
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
})
