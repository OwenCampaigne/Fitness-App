import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { fetchDailyMetrics } from '@/lib/garmin'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Garmin connection self-test.
 *
 * Answers one question in plain language: is this thing actually reading my
 * watch? Hit it right after putting credentials in .env.local — it says which
 * metrics arrived, which came back empty, and what to do about the empty ones.
 *
 * In production it requires the CRON_SECRET, because the response describes
 * which credentials are configured.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const secret =
      req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-cron-secret')
    if (!secret || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const dateStr =
    req.nextUrl.searchParams.get('date') ?? format(new Date(), 'yyyy-MM-dd')

  const configured = {
    usernamePassword: !!(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD),
    oauthTokens: !!(process.env.GARMIN_OAUTH1 && process.env.GARMIN_OAUTH2),
    cronSecret: !!process.env.CRON_SECRET,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
  }

  if (!configured.usernamePassword && !configured.oauthTokens) {
    return NextResponse.json({
      connected: false,
      verdict: 'No Garmin credentials configured — the app is running on demo data.',
      nextStep:
        'Add GARMIN_USERNAME and GARMIN_PASSWORD to .env.local, restart the dev server, and reload this page. See GARMIN-SETUP.md.',
      configured,
    })
  }

  try {
    const metrics = await fetchDailyMetrics(dateStr)

    if (metrics.isDemo) {
      const reason = metrics.demoReason ?? 'unknown'
      return NextResponse.json({
        connected: false,
        verdict:
          reason === 'login_failed'
            ? 'Credentials are set but the login failed.'
            : `Running on demo data (${reason}).`,
        nextStep:
          reason === 'login_failed'
            ? 'If your Garmin account has two-factor auth, password login will not work — run `node scripts/get-garmin-tokens.js` once to generate OAuth tokens. See GARMIN-SETUP.md.'
            : 'Check GARMIN-SETUP.md.',
        configured,
      })
    }

    // Which metrics actually came back with something in them.
    const arrived: Record<string, unknown> = {
      hrvLastNight: metrics.hrv.lastNight || null,
      hrvWeeklyAverage: metrics.hrv.weeklyAverage || null,
      restingHr: metrics.recovery.restingHR || null,
      sleepScore: metrics.sleep.sleepScore || null,
      sleepHours:
        metrics.sleep.totalSleepSeconds > 0
          ? Math.round((metrics.sleep.totalSleepSeconds / 3600) * 10) / 10
          : null,
      bodyBattery: metrics.bodyBattery.isAvailable ? metrics.bodyBattery.current || null : null,
      stress: metrics.stress.average || null,
      activities: metrics.activities.length,
    }

    const missing = Object.entries(arrived)
      .filter(([, v]) => v === null || v === 0)
      .map(([k]) => k)

    const dbDays = await prisma.readiness_daily.count()

    return NextResponse.json({
      connected: true,
      verdict:
        missing.length === 0
          ? `Connected. Every metric came through for ${dateStr}.`
          : `Connected, but ${missing.length} metric(s) came back empty for ${dateStr}.`,
      nextStep:
        missing.length === 0
          ? dbDays === 0
            ? 'Nothing in the database yet — run `npx tsx scripts/garmin-backfill.ts 28` to pull your history.'
            : `${dbDays} day(s) of history stored. You are live.`
          : 'Empty metrics on a single day usually mean the watch had not synced to Garmin Connect for that date, or you did not wear it. Try ?date=YYYY-MM-DD on a day you know you wore it. If HRV is persistently empty, the watch needs about 3 weeks of overnight wear before Garmin reports HRV status at all.',
      date: dateStr,
      metrics: arrived,
      missing,
      daysInDatabase: dbDays,
      configured,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/garmin/check]', msg)
    return NextResponse.json(
      {
        connected: false,
        verdict: 'The Garmin call threw an error.',
        error: msg,
        nextStep:
          'A 401 means bad credentials or expired tokens. A 429 means Garmin is rate-limiting — wait an hour. See GARMIN-SETUP.md.',
        configured,
      },
      { status: 503 },
    )
  }
}
