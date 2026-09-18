// ── /niggle — the niggle tracker (framework §9) ───────────────────────────────
// The entry point for coach-prescribed prehab. You log a region and a number;
// the engine matches a protocol, down-weights the tissue, and escalates when it
// should. Everything on this page is medical-adjacent, which is why §15's
// disclaimer is a required part of every API response it reads rather than a
// line the UI is trusted to remember.

import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { prisma } from '@/lib/db'
import BottomNav from '@/components/BottomNav'
import NiggleClient from '@/components/niggle/NiggleClient'

export const dynamic = 'force-dynamic'

export default async function NigglePage() {
  const profile = await prisma.athlete_profile.findFirst()
  if (!profile) redirect('/onboarding')

  const today = format(new Date(), 'EEEE, MMM d')

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-md mx-auto px-4 py-2.5">
          <p className="font-serif text-note italic text-pencil">{today}</p>
          <h1 className="font-serif text-head text-ink">Niggles</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4">
        <NiggleClient />
      </main>

      <BottomNav />
    </div>
  )
}
