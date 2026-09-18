import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { prisma } from '@/lib/db'
import BottomNav from '@/components/BottomNav'
import RunClient from '@/components/run/RunClient'

export const dynamic = 'force-dynamic'

export default async function RunPage() {
  const profile = await prisma.athlete_profile.findFirst()
  if (!profile) redirect('/onboarding')

  const today = format(new Date(), 'EEEE, MMM d')

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 py-3 flex items-baseline gap-2.5">
          <h1 className="font-serif text-head text-ink">Run</h1>
          <p className="font-serif text-note italic text-pencil">{today}</p>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4">
        <RunClient />
      </main>

      <BottomNav />
    </div>
  )
}
