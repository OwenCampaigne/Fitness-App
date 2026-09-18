// ── Environment for standalone scripts ────────────────────────────────────────
// Next loads `.env.local` on its own, so the API routes have always seen these
// values. A script run through `npx tsx` does not, which is why
// `garmin-backfill.ts` reported "No Garmin credentials found" against a
// correctly filled-in file — the credentials were there, nothing had read them.
//
// Import this first, for the side effect, before anything that touches
// process.env. Every read in `garmin.ts` happens inside a function, so import
// order is enough; no lazy-import dance is needed.

import { existsSync } from 'fs'
import { join } from 'path'
import { config } from 'dotenv'

const root = join(__dirname, '..')

// Local overrides win, matching Next's own precedence.
for (const file of ['.env.local', '.env']) {
  const path = join(root, file)
  if (existsSync(path)) config({ path, override: false })
}

export function requireGarminCredentials(): boolean {
  return (
    !!(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD) ||
    !!(process.env.GARMIN_OAUTH1 && process.env.GARMIN_OAUTH2)
  )
}
