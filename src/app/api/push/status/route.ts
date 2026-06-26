/**
 * GET /api/push/status
 *
 * Lightweight, public endpoint used by:
 *  - Service Worker Periodic Background Sync (checks battery when app is closed)
 *  - Client-side polling (checks battery when app is open)
 *
 * Returns current body battery and whether the stored threshold is exceeded.
 * No auth needed — only returns non-sensitive health summary data.
 */
import { NextResponse } from 'next/server';
import { fetchDailyMetrics } from '@/lib/garmin';
import { getStoredSubscription } from '@/lib/pushStore';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const metrics   = await fetchDailyMetrics();
    const battery   = metrics.bodyBattery.current;
    const stored    = getStoredSubscription();
    const threshold = stored?.threshold ?? 30;

    return NextResponse.json({
      battery,
      threshold,
      shouldAlert: battery > 0 && battery <= threshold,
      isDemo:      metrics.isDemo,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
