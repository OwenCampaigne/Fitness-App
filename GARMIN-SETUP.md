# Going live with your Forerunner 965

Everything in this app is built to run on mock data, so it works before it ever
touches your watch. This page is the switch. It is three commands and one file
edit, and nothing in the code changes.

---

## The short version

```bash
# 1. Put your Garmin Connect login in .env.local
#    GARMIN_USERNAME=you@email.com
#    GARMIN_PASSWORD=your-password

# 2. Restart the dev server, then check it took
npm run dev
curl localhost:3030/api/garmin/check

# 3. Pull your history
npx tsx scripts/garmin-backfill.ts 28
```

If step 2 says `"connected": true`, you are done. Step 3 backfills four weeks so
the app starts from your real baselines instead of spending three weeks
calibrating from scratch.

---

## Step 1 — credentials

Open `.env.local` in the project root and add:

```env
GARMIN_USERNAME=you@email.com
GARMIN_PASSWORD=your-password
```

That is the same email and password you use for Garmin Connect. They stay on
your machine — `.env.local` is gitignored, and the app only ever reads Garmin
server-side.

**If your Garmin account has two-factor auth**, password login will not work.
Garmin emails you a code and the library cannot answer it from a background job.
Run the token script once instead:

```bash
node scripts/get-garmin-tokens.js
```

It logs you in, waits for you to type the emailed code, and prints
`GARMIN_OAUTH1` and `GARMIN_OAUTH2`. Put those in `.env.local` in place of the
username and password. Tokens last about 90 days; re-run the script when they
expire. The app prefers tokens over a password whenever both are present,
because token login never triggers MFA or a rate limit.

---

## Step 2 — check it worked

```bash
curl localhost:3030/api/garmin/check
```

You get a plain-language verdict rather than a stack trace:

```json
{
  "connected": true,
  "verdict": "Connected. Every metric came through for 2026-08-20.",
  "nextStep": "Nothing in the database yet — run `npx tsx scripts/garmin-backfill.ts 28`.",
  "metrics": {
    "hrvLastNight": 54, "hrvWeeklyAverage": 51, "restingHr": 48,
    "sleepScore": 82, "sleepHours": 7.4, "bodyBattery": 71,
    "stress": 24, "activities": 1
  },
  "missing": []
}
```

Add `?date=2026-08-18` to test a specific day.

### When something is empty

| What you see | What it means |
|---|---|
| `hrvLastNight: null` on every day | The 965 needs roughly three weeks of consistent overnight wear before Garmin reports HRV status at all. Nothing is broken — wear it to sleep and it fills in. |
| Everything empty for one date | The watch had not synced to Garmin Connect for that day, or you did not wear it. Try a day you know you wore it. |
| `"verdict": "Credentials are set but the login failed."` | Almost always two-factor auth. Use the token script above. |
| A `429` error | Garmin is rate-limiting you. Wait an hour. Backfill pauses between days for exactly this reason; do not run it in a loop. |

---

## Step 3 — backfill your history

```bash
npx tsx scripts/garmin-backfill.ts 28      # or 60, or 90
npx tsx scripts/garmin-backfill.ts 28 --dry  # show what it would fetch
```

This matters more than it looks. The readiness engine compares last night's HRV
and resting HR against a 28-day rolling median. With an empty database it has
nothing to compare against, so it labels everything *provisional*, tightens the
ACWR ceiling from 1.3 to 1.1, and stays deliberately conservative for three
weeks — while your watch has been recording the whole time.

Backfilling hands it that history immediately. The script credits it against the
calibration window: 14+ days flips the recovery baseline to ready, 21+ days
graduates it to full confidence outright.

It walks days sequentially with a pause between each. Twenty-eight days takes
about a minute. Re-running is safe — stored days are upserted, not duplicated.

---

## Step 4 — keep it fed (optional, but this is the point)

The app never calls Garmin in a request path; it reads from SQLite, which a
scheduled job fills. Locally, run the sync by hand or from Task Scheduler:

```bash
curl "localhost:3030/api/sync?secret=$CRON_SECRET"
```

Deployed, point [cron-job.org](https://cron-job.org) (free) at three jobs:

```
https://<your-app>.vercel.app/api/sync?secret=<CRON_SECRET>
```

at 06:00, 12:00 and 21:00 UTC. Three a day rather than one because the 965
uploads at different times depending on when you sync it, and a missed morning
pull should not cost you the day. `CRON_SECRET` is any random string —
`openssl rand -hex 32` will do — and it goes in `.env.local` and in your Vercel
environment variables.

**One caveat if you deploy to Vercel:** serverless filesystems are ephemeral, so
`prisma/dev.db` will not survive. Point `DATABASE_URL` at Turso or another hosted
SQLite before deploying, or run it on a small always-on box. Locally none of this
applies.

---

## What the 965 gives you

Everything the readiness engine wants, which is why it was chosen as the single
source of truth over Strava:

| Metric | Used for |
|---|---|
| Overnight HRV | The primary readiness signal — ratio against a 28-day median |
| Resting HR | Second readiness signal — delta above baseline |
| Sleep score, duration, stages | Third signal, and the one that carries most weight during calibration |
| Body Battery | Displayed as supporting context |
| All-day stress | Supporting context |
| Activities: duration, distance, HR | Training load → ACWR → the injury-risk guard |

Training Readiness and Training Status are on the watch too and are not read yet.
They are a useful cross-check against this app's own scoring rather than a
replacement for it — worth wiring up later, not needed now.

---

## What does *not* change when you go live

Nothing in the code. No feature flag, no rebuild, no migration.

Scenario mode stays exactly where it is: set `SCENARIO=red_day` in `.env.local`
and the app serves that preset instead of your real data, which is still the only
sane way to test what a bad day looks like without waiting for one. Remove the
line and you are back on live data. Same for `STRENGTH_SCENARIO`.

If Garmin goes down, the app serves the last successfully synced day with a
"last synced X ago" note rather than a blank screen. A sync failure is stale
data, never a crash.
