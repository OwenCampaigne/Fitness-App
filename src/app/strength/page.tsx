import Link from 'next/link'
import { redirect } from 'next/navigation'
import { format, startOfDay } from 'date-fns'
import { prisma } from '@/lib/db'
import BottomNav from '@/components/BottomNav'
import StrengthClient from '@/components/strength/StrengthClient'
import { KEY_LIFTS_BY_ID } from '@/lib/keyLifts'
import { loadExerciseHistories, latestByExercise } from '@/lib/strengthSession'
import { getStrengthScenario } from '@/lib/strengthScenario'
import { meanRir, topWeight, completedSets } from '@/lib/strengthEngine'

export const dynamic = 'force-dynamic'

export default async function StrengthPage() {
  const profile = await prisma.athlete_profile.findFirst()
  if (!profile) redirect('/onboarding')

  const scenario = getStrengthScenario()
  const histories = scenario ? scenario.histories : await loadExerciseHistories()
  const latest = latestByExercise(histories, { before: startOfDay(new Date()) })

  // "last time: 3×8 @ 60 · RIR 2" — precomputed on the server so the card can
  // render it without a second round trip.
  const lastSessionSummaries: Record<string, string | null> = {}
  for (const [exerciseId, history] of Object.entries(latest)) {
    const sets = completedSets(history.sets)
    if (sets.length === 0) {
      lastSessionSummaries[exerciseId] = null
      continue
    }
    const weight = topWeight(sets)
    const rir = meanRir(sets)
    const reps = sets.map((s) => s.reps).join('/')
    const loadPart = weight !== null ? ` @ ${weight}` : ''
    const rirPart = rir !== null ? ` · RIR ${rir}` : ''
    lastSessionSummaries[exerciseId] = `${sets.length}×${reps}${loadPart}${rirPart}`
  }

  const today = format(new Date(), 'EEEE, MMM d')

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 py-3 flex items-baseline gap-2.5">
          <h1 className="font-serif text-head text-ink">Strength</h1>
          <p className="font-serif text-note italic text-pencil">{today}</p>
          {/* The 873-exercise library lost its tab to /preferences. Lifting is
              where you actually go looking for an exercise, so it lives here
              now rather than nowhere. */}
          <Link
            href="/exercises"
            className="ml-auto font-serif text-note italic text-pencil hover:text-ink underline decoration-rule underline-offset-4 transition-colors py-1"
          >
            Library
          </Link>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4">
        <StrengthClient
          liftsById={KEY_LIFTS_BY_ID}
          lastSessionSummaries={lastSessionSummaries}
        />
      </main>

      <BottomNav />
    </div>
  )
}
