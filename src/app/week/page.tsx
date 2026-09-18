// ── The week ahead (framework §10 step 5, §18 step 9) ─────────────────────────
// The other half of §14. Today's screen answers "what now" and refuses to show
// you anything else, on purpose. This one exists because a week is not seven
// independent todays: the long run has to land somewhere, heavy legs have to
// stay clear of it (§8), and the ACWR band it is all judged against is a weekly
// property (§3). None of that is visible one day at a time.
//
// The catalog is built here for the same reason the Today page builds it: a
// Session item carries an id and a name and nothing turns that id back into its
// library row, so the authored catalogs come down as a prop, cleared of
// diagnosis language on the way (§15).

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { KEY_LIFTS } from '@/lib/keyLifts'
import { PLYOS } from '@/lib/plyos'
import { PREHAB } from '@/lib/prehab'
import { STRETCHES } from '@/lib/stretches'
import { buildCatalog } from '@/lib/todayView'
import BottomNav from '@/components/BottomNav'
import WeekClient from '@/components/week/WeekClient'

export const dynamic = 'force-dynamic'

export default async function WeekPage() {
  const profile = await prisma.athlete_profile.findFirst()
  if (!profile) redirect('/onboarding')

  const catalog = buildCatalog({
    lifts: KEY_LIFTS,
    plyos: PLYOS,
    prehab: PREHAB,
    stretches: STRETCHES,
  })

  return (
    <div className="min-h-screen bg-paper">
      {/* The head of a page in the log: the book's name, then the date span it
          covers. No rule of its own beyond the one the paper already has. */}
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 py-3 flex items-baseline gap-2.5">
          <h1 className="font-serif text-head text-ink">Week</h1>
          <p className="font-serif text-note italic text-pencil">the next seven days</p>
          {/* §18 step 9 — the weekly review starts here and goes on to the
              charts, which is also what keeps /trends reachable now that the
              week took its tab. */}
          <Link
            href="/trends"
            className="ml-auto font-serif text-note italic text-pencil hover:text-ink underline decoration-rule underline-offset-4 transition-colors py-1"
          >
            Trends
          </Link>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4">
        <WeekClient catalog={catalog} />
      </main>

      <BottomNav />
    </div>
  )
}
