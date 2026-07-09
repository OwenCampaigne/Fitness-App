import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { prisma } from '@/lib/db'
import { computeReadiness } from '@/lib/readiness'
import { getScenario } from '@/lib/scenario'
import BottomNav from '@/components/BottomNav'
import ReadinessBand from '@/components/ReadinessBand'

export default async function HomePage() {
  // Gate: onboarding required first
  const profile = await prisma.athlete_profile.findFirst()
  if (!profile) redirect('/onboarding')

  // Scenario mode: skip DB entirely
  const scenario = getScenario()
  const scenarioMode = scenario ? (process.env.SCENARIO ?? undefined) : undefined

  const result = scenario ?? (await computeReadiness())
  const today = format(new Date(), 'EEEE, MMM d')

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3">
          <p className="text-[11px] text-muted uppercase tracking-widest">{today}</p>
          <h1 className="text-sm font-bold text-primary">Today&#39;s Readiness</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-3">
        <ReadinessBand result={result} scenarioMode={scenarioMode} />
      </main>

      <BottomNav />
    </div>
  )
}
