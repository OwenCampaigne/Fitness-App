// ── The Today home screen (framework §14) ─────────────────────────────────────
// The screen the whole product exists to show: one answer for today, explained
// and editable in place. §19 is blunt about it — "the product doesn't exist
// until Phase 5" — and this is that.
//
// Split server/client on purpose. The readiness band is rendered here, on the
// server, from the same `computeReadiness` the rest of the app uses, so the
// first paint already answers the question you opened the app to ask. The
// session below it is a client component because every part of it is an edit
// surface.
//
// The catalog is built here too: a Session item carries an id and a name, and
// there is no route that turns an id back into its library row, so the authored
// catalogs come down as a prop — cleared of diagnosis language on the way (§15).

import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { prisma } from '@/lib/db'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import { KEY_LIFTS } from '@/lib/keyLifts'
import { PLYOS } from '@/lib/plyos'
import { PREHAB } from '@/lib/prehab'
import { STRETCHES } from '@/lib/stretches'
import { buildCatalog } from '@/lib/todayView'
import BottomNav from '@/components/BottomNav'
import ReadinessBand from '@/components/ReadinessBand'
import TodayClient from '@/components/today/TodayClient'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  // Gate: onboarding required first
  const profile = await prisma.athlete_profile.findFirst()
  if (!profile) redirect('/onboarding')

  // Scenario mode: skip DB entirely (§16)
  const scenario = getScenario()
  const scenarioMode = scenario ? (process.env.SCENARIO ?? undefined) : undefined

  const result = scenario ?? (await computeReadiness())
  const today = format(new Date(), 'EEEE, MMM d')

  const catalog = buildCatalog({
    lifts: KEY_LIFTS,
    plyos: PLYOS,
    prehab: PREHAB,
    stretches: STRETCHES,
  })

  return (
    <div className="min-h-screen bg-paper">
      {/* The date is the only thing at the top of a diary page. The answer is
          the verdict below it, so nothing competes with it up here. */}
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 py-2.5">
          <h1 className="font-serif text-note italic text-pencil">{today}</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-5">
        {/* §14 step 1 — band, the two deciding numbers, the plain line, the
            calibration note. Compact: trends belong on /trends, never here. */}
        <ReadinessBand result={result} scenarioMode={scenarioMode} compact />

        {/* §14 steps 2–6 */}
        <TodayClient catalog={catalog} />
      </main>

      <BottomNav />
    </div>
  )
}
