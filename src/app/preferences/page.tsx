// ── /preferences — the preference library (framework §13) ─────────────────────
// Everything the coach believes about how you want to train, and — the part
// that matters — everything it used to believe. A rule stated in March is not
// automatically true in September, so retirement is shown, dated, and kept
// rather than being an edit that erases what came before.
//
// The shell only: the header lives in the client component so its wording goes
// through `t(...)` like everything else. Reached from the nav via /profile.

import { format } from 'date-fns'
import BottomNav from '@/components/BottomNav'
import PreferencesClient from '@/components/preferences/PreferencesClient'

export const dynamic = 'force-dynamic'

export default function PreferencesPage() {
  return (
    <div className="min-h-screen bg-paper">
      <PreferencesClient today={format(new Date(), 'EEEE, MMM d')} />
      <BottomNav />
    </div>
  )
}
