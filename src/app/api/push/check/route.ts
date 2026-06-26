/**
 * GET /api/push/check
 *
 * Called by Vercel Cron every 30 minutes (see vercel.json).
 * Also callable manually for testing: GET /api/push/check?force=1
 *
 * Flow:
 *  1. Verify CRON_SECRET (Vercel sets this automatically for cron requests)
 *  2. Fetch current body battery from Garmin (15-min cache)
 *  3. If battery ≤ stored threshold AND not in 3-hour cooldown → send push
 */
import { NextRequest, NextResponse } from 'next/server';
import * as webpush from 'web-push';
import { getStoredSubscription, isCoolingDown, markSent } from '@/lib/pushStore';
import { fetchDailyMetrics } from '@/lib/garmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // ── Auth: Vercel passes CRON_SECRET automatically for scheduled calls ──────
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isForced   = req.nextUrl.searchParams.get('force') === '1';

  if (!isForced && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stored = getStoredSubscription();
  if (!stored) {
    return NextResponse.json({ skipped: 'no_subscription' });
  }

  // ── Fetch current body battery ────────────────────────────────────────────
  let battery: number;
  try {
    const metrics = await fetchDailyMetrics();
    battery = metrics.bodyBattery.current;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[push/check] fetchDailyMetrics error:', msg);
    return NextResponse.json({ error: 'fetch_failed', detail: msg }, { status: 500 });
  }

  const { subscription, threshold } = stored;

  // ── Should we fire? ────────────────────────────────────────────────────────
  if (battery <= 0) {
    return NextResponse.json({ skipped: 'no_battery_data', battery });
  }
  if (battery > threshold) {
    return NextResponse.json({ skipped: 'above_threshold', battery, threshold });
  }
  if (!isForced && isCoolingDown()) {
    return NextResponse.json({ skipped: 'cooldown', battery, threshold });
  }

  // ── Send push ─────────────────────────────────────────────────────────────
  const vapidPublic  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail   = process.env.VAPID_EMAIL ?? 'mailto:admin@example.com';

  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 });
  }

  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

  const urgencyLabel = battery <= 15 ? '¡Muy baja!' : 'Baja';
  const payload = JSON.stringify({
    title: `🔋 Batería Corporal ${urgencyLabel}`,
    body:  `Tu batería corporal está al ${battery}% — es momento de descansar.`,
    icon:  '/icon-192x192.png',
    badge: '/icon-96x96.png',
    tag:   'battery-alert',
    url:   '/',
  });

  try {
    await webpush.sendNotification(subscription, payload);
    markSent();
    console.log(`[push/check] Notification sent — battery: ${battery}%`);
    return NextResponse.json({ sent: true, battery, threshold });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[push/check] sendNotification error:', msg);
    return NextResponse.json({ error: 'send_failed', detail: msg }, { status: 500 });
  }
}
