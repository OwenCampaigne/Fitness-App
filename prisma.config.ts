// ── Prisma CLI config ─────────────────────────────────────────────────────────
// `import "dotenv/config"` loads .env and nothing else. This project keeps its
// real values in .env.local (Next loads that automatically, and it is the file
// .gitignore covers), so on any machine without a stray .env the CLI came up
// with DATABASE_URL undefined and refused:
//
//   Error: The datasource.url property is required in your Prisma config file
//
// It worked on the machine this was written on purely because a .env happened
// to exist there. Load both, local first, matching Next's own precedence.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'prisma/config'

for (const file of ['.env.local', '.env']) {
  const path = join(process.cwd(), file)
  if (existsSync(path)) loadEnv({ path, override: false })
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
