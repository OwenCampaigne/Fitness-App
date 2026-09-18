/**
 * Garmin backfill — pull history so the system starts from real numbers.
 *
 *   npx tsx scripts/garmin-backfill.ts                     # last 28 days
 *   npx tsx scripts/garmin-backfill.ts 60                  # last 60 days
 *   npx tsx scripts/garmin-backfill.ts 28 --dry            # show what it would fetch
 *   npx tsx scripts/garmin-backfill.ts 90 --splits-only    # only fill in missing laps
 *   npx tsx scripts/garmin-backfill.ts 28 --refresh-splits # re-pull laps already stored
 *
 * Why this exists: framework §5b — "if the watch already has weeks of history,
 * backfill and shorten the window." Without it the calibration window runs a
 * full 21 days from a standing start, and the app is deliberately conservative
 * that entire time, even though the watch has been recording all along.
 *
 * Garmin rate-limits. This walks days sequentially with a pause between them
 * rather than firing 28 parallel requests, which gets you a 429 and nothing.
 *
 * Resumability here is the query, not bookkeeping: the splits pass selects run
 * rows whose `splits` column is still null, so a run that dies to a 429 halfway
 * leaves every completed row stored and the next run resumes at the first row
 * that still has nothing. Re-running is always safe and always cheap.
 */

// Must come first: it populates process.env from .env.local before anything
// below reads it.
import './loadEnv'
import { addDays, format, subDays } from 'date-fns'
import { backfillActivitySplits, syncGarmin } from '../src/lib/syncGarmin'
import { prisma } from '../src/lib/db'

const days = Number(process.argv[2]) || 28
const dryRun = process.argv.includes('--dry')
const splitsOnly = process.argv.includes('--splits-only')
const refreshSplits = process.argv.includes('--refresh-splits')
const PAUSE_MS = 1500

function reportSplits(result: Awaited<ReturnType<typeof backfillActivitySplits>>) {
  console.log(
    `\nSplits: ${result.fetched} of ${result.candidates} run(s) fetched, ${result.decouplingComputed} produced an aerobic decoupling figure.`,
  )
  if (result.rateLimited) {
    console.log(
      'Garmin rate-limited part way through. Wait an hour and re-run — rows already stored are skipped.',
    )
  }
  if (result.stillMissing > 0) {
    console.log(
      `${result.stillMissing} run(s) still have no per-split data — either re-run with --splits-only, or Garmin recorded no laps for them.`,
    )
  }
}

async function main() {
  if (days < 1 || days > 365) {
    console.error('Pick a day count between 1 and 365.')
    process.exit(1)
  }

  const hasCreds =
    !!(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD) ||
    !!(process.env.GARMIN_OAUTH1 && process.env.GARMIN_OAUTH2)

  if (!hasCreds) {
    console.error(
      'No Garmin credentials found. Put GARMIN_USERNAME and GARMIN_PASSWORD in .env.local first — see GARMIN-SETUP.md.',
    )
    process.exit(1)
  }

  const today = new Date()
  const dates = Array.from({ length: days }, (_, i) =>
    format(subDays(today, days - 1 - i), 'yyyy-MM-dd'),
  )
  const windowStart = subDays(today, days - 1)

  if (dryRun) {
    const missing = await prisma.activities.count({
      where: { date: { gte: windowStart }, splits: null, type: { contains: 'run' } },
    })
    console.log(`Would fetch ${dates.length} days: ${dates[0]} → ${dates[dates.length - 1]}`)
    console.log(`${missing} stored run(s) in that window still have no per-split data.`)
    return
  }

  // ── Splits-only pass ────────────────────────────────────────────────────────
  // For when the days are already stored and only the laps are missing — which
  // is the state every database written before the splits sync landed is in.
  if (splitsOnly) {
    console.log(
      `Filling in per-split data for runs since ${format(windowStart, 'yyyy-MM-dd')}\n`,
    )
    const result = await backfillActivitySplits({
      since: windowStart,
      refresh: refreshSplits,
      onProgress: (line) => process.stdout.write(`${line}\n`),
    })
    reportSplits(result)
    return
  }

  console.log(`Backfilling ${dates.length} days: ${dates[0]} → ${dates[dates.length - 1]}\n`)

  let ok = 0
  let failed = 0
  let activities = 0
  let splits = 0
  let decoupled = 0

  for (const date of dates) {
    try {
      const result = await syncGarmin(date, { refreshSplits })
      if (result.ok) {
        ok++
        activities += result.activitiesCount
        splits += result.splitsStored
        decoupled += result.decouplingComputed
        const extra =
          result.splitsStored > 0
            ? `, ${result.splitsStored} with splits${
                result.decouplingComputed > 0 ? `, ${result.decouplingComputed} decoupled` : ''
              }`
            : ''
        process.stdout.write(`  ✓ ${date}  (${result.activitiesCount} activities${extra})\n`)
      } else {
        failed++
        process.stdout.write(`  · ${date}  skipped — ${result.error}\n`)
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      process.stdout.write(`  ✗ ${date}  ${msg}\n`)

      // Garmin is rate-limiting; backing off further will not help this run.
      if (msg.includes('429')) {
        console.error(
          '\nGarmin is rate-limiting. Wait an hour and re-run — already-stored days are skipped cheaply.',
        )
        break
      }
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }

  // ── Shorten the calibration window to credit the history just pulled ────────
  const dayCount = await prisma.readiness_daily.count()
  const calibration = await prisma.calibration_state.findFirst({ orderBy: { id: 'desc' } })

  if (calibration && dayCount > 0) {
    const startedOn = calibration.startedOn ?? new Date()
    // Same rule as onboarding: never shorter than 7 days, one day credited per
    // day of existing history, capped at the standard 21-day window.
    const remaining = Math.max(7, 21 - dayCount)
    const windowEnd = addDays(new Date(), remaining)

    await prisma.calibration_state.update({
      where: { id: calibration.id },
      data: {
        startedOn,
        windowEnd,
        recoveryBaselineReady: dayCount >= 14,
        graduated: dayCount >= 21,
      },
    })

    console.log(
      `\nCalibration: ${dayCount} days of history → ${
        dayCount >= 21
          ? 'graduated, full confidence'
          : `${remaining} days remaining, baseline ${dayCount >= 14 ? 'ready' : 'not ready'}`
      }`,
    )
  }

  console.log(`\nDone: ${ok} days stored, ${failed} skipped, ${activities} activities.`)

  // ── Sweep up whatever the day walk could not reach ──────────────────────────
  // A day sync only fetches laps for the activities it saw on that date. Rows
  // written by an earlier build, or by a day whose splits call was rate-limited,
  // are left behind — this pass catches them, and it is the same pass that
  // `--splits-only` runs on its own.
  const sweep = await backfillActivitySplits({
    since: windowStart,
    refresh: false,
    onProgress: (line) => process.stdout.write(`${line}\n`),
  })
  reportSplits({
    ...sweep,
    fetched: sweep.fetched + splits,
    candidates: sweep.candidates + splits,
    decouplingComputed: sweep.decouplingComputed + decoupled,
  })

  if (ok === 0) {
    console.log('Nothing stored — run `curl localhost:3030/api/garmin/check` to see why.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
