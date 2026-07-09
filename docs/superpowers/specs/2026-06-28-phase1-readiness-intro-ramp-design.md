# Phase 1 — Readiness + Intro Ramp Design
**Date:** 2026-06-28
**Status:** Approved

---

## Goal

Ship a real "today's readiness" screen backed by actual Garmin data. When the app opens each morning it shows GREEN / AMBER / RED — derived from last night's HRV, resting HR, sleep, and Body Battery — with the two numbers that decided it and a plain-language explanation.

**Does not include:** AI coach, workout generator, NL editing, full Today screen, run/strength/plyo engines. Those are Phases 3–6.

---

## User Context

Post-surgical recovery: ACL tear + MACI cartilage transplant + High Tibial Osteotomy. Currently in walk/run intervals phase (cleared for alternating run/walk, not continuous running). Previously ran 6:30/mile; currently ~12:00/mile for a quarter mile. Expects rapid improvement — anchors will update weekly, not over months. Pain flagging is a hard cap on readiness band.

---

## Architecture & Data Flow

```
cron-job.org (06:00 / 12:00 / 21:00 UTC)
    │
    ▼
/api/sync?secret=CRON_SECRET
    │
    ├─ fetches from Garmin: HRV, RHR, sleep, body battery, stress, activities
    ├─ upserts → readiness_daily (one row/day)
    ├─ upserts → activities (one row/activity, keyed on garminActivityId)
    └─ updates → calibration_state.recoveryBaselineReady when 14+ days exist
    │
    ▼
SQLite (prisma/dev.db)
    │
    ▼
/api/readiness
    │
    ├─ reads last 28 days of readiness_daily
    ├─ computes HRV baseline, RHR baseline, ACWR, sleep debt
    ├─ applies calibration_state (provisional if < 21 days)
    └─ returns: band, two deciding numbers, plain-language line, sync timestamp
    │
    ▼
Home screen (app/page.tsx)
    └─ cold-start: empty DB → one-time live Garmin fetch → write to DB → DB-only forever after
```

**Sync security:** `CRON_SECRET` env var checked on every `/api/sync` call. Returns 401 if missing or wrong. Can be hit manually in browser during development.

---

## New Files

| File | Purpose |
|---|---|
| `src/app/api/sync/route.ts` | Sync handler — only place that calls Garmin |
| `src/lib/readiness.ts` | Baseline math + band computation from DB rows |
| `src/app/api/readiness/route.ts` | Serves computed readiness JSON to client |
| `src/app/onboarding/page.tsx` | Intake form (two screens) |
| `src/lib/scenario.ts` | Mock/scenario mode presets |
| Updates to `src/app/page.tsx` | Reads from `/api/readiness`, adds cold-start bootstrap |

---

## Sync Job (`/api/sync`)

**Fetches per run:**
- HRV (lastNight + weeklyAvg) from Garmin HRV service
- Resting HR from daily usersummary
- Sleep (duration, score, deep/REM/light seconds)
- Body Battery (current + drained)
- Stress average
- Activities for the date (type, duration, distance, avg HR, max HR, garminActivityId)

**Writes:**
- `readiness_daily` — one row per date, upsert. Midday sync updates the same row.
- `activities` — one row per activity, upsert on `garminActivityId`.
- `calibration_state.recoveryBaselineReady = true` once 14+ days of data exist.

**Error handling:**
- Garmin 401/429 → log, return 503, write nothing. Cron retries on next scheduled run.
- Individual endpoint failure → write available fields, leave missing fields null. Never block the whole sync on one bad endpoint.
- App always shows last successfully synced data with "last synced X ago" — never a blank screen.

**Cold-start bootstrap:**
`/api/readiness` detects empty DB → makes a server-side call to `/api/sync` (passing the `CRON_SECRET`) → sync fetches from Garmin, writes to DB → readiness reads from DB and returns. `/api/sync` remains the single place that calls Garmin, even during bootstrap.

---

## Onboarding Intake

One-time flow, two screens, under 3 minutes. Writes to `athlete_profile` and `calibration_state`.

**Screen 1 — Who you are:**
- Age (for Tanaka HR zone formula)
- Sex (for VO2max norms)
- Goal: `return_to_run` (only option for now; more added in later phases)

**Screen 2 — Where you are right now:**
- Surgical leg (left / right) + approximate surgery date
- Current weekly running time in minutes (total run segments, not including walks)
- Longest continuous run segment in minutes (the ceiling the system won't push past)
- Current knee pain/swelling: none / sometimes / yes

**What gets written:**

```ts
athlete_profile: {
  age, sex,
  injuryHistory: JSON.stringify(["ACL tear", "MACI", "HTO", "{left|right} knee"]),
  plyoTier: 1,
  plyoTierSource: "estimate",
  plyoTierConfidence: "estimate",
  trainingPacesJson: JSON.stringify({
    easy: { value: null, source: "unknown", confidence: "estimate" }
  }),
  keyLiftLoadsJson: JSON.stringify({}),
}

calibration_state: {
  startedOn: today,
  windowEnd: today + 21 days,  // longer than standard due to surgical context
  recoveryBaselineReady: false,
  graduated: false,
}
```

All anchors start as `estimate`. The system labels them provisional and says so on screen.

If Garmin history already exists (backfilled rows), calibration window shortens proportionally — `windowEnd` recalculates to `startedOn + max(7, 21 - existingDays)`.

---

## Baselines & Readiness Scoring (`src/lib/readiness.ts`)

**Four signals:**

```
1. HRV ratio   = lastNight HRV ÷ 28-day rolling median HRV
2. RHR delta   = today RHR − 28-day rolling median RHR  (bpm above baseline)
3. Sleep score = Garmin sleep score (0–100), or calculated from duration+quality
4. ACWR        = 7-day load sum ÷ 28-day rolling load average
```

**Load currency for ACWR:**
`session_load = duration_min × sRPE_estimated`
sRPE estimated from avg HR as % of max HR (Tanaka): maps to 1–10 scale. Labeled `estimated_load` throughout. When user logs RPE manually (later phase), this upgrades to observed.

**Band thresholds:**

| Band | Condition |
|---|---|
| GREEN | HRV ratio ≥ 0.95 AND RHR delta ≤ +3 AND sleep ≥ 60 AND ACWR 0.8–1.3 |
| RED | HRV ratio < 0.80 OR RHR delta > +7 OR sleep < 40 OR ACWR > 1.5 |
| AMBER | Anything not GREEN or RED |

RED is a veto — any single red flag overrides all other signals.

**Two separate calibration thresholds:**
- `recoveryBaselineReady = true` at 14 days — enough data for HRV/RHR baselines to be meaningful. Scoring switches from "lean on sleep only" to full four-signal model.
- Calibration window ends at 21 days — provisional UI labels and tightened ACWR cap (1.1) remain until then, even after baseline is ready. The extra week lets the system prove its numbers before claiming full confidence.

**During calibration window (< 21 days of data):**
- Baselines built from available rows (even 3 days beats nothing)
- Band labeled "provisional" in UI
- ACWR ceiling tightened: 1.3 → 1.1 (surgical context)
- Screen shows: *"Still calibrating — being conservative"*

**Post-surgical pain cap:**
If `athlete_profile.injuryHistory` contains knee surgery AND intake pain = "yes" → band capped at AMBER regardless of signals. GREEN never shown while active pain is flagged. User can update pain status anytime via a tappable "⚠ Knee pain flagged" chip on the home screen — tapping opens a small modal with three options: None / Sometimes / Yes. Updates `athlete_profile` immediately.

**The two deciding numbers:**
Always the two signals that most influenced the band. Computed by comparing each signal's deviation from its threshold — the two largest deviations are shown. Explainable, not a wall of numbers.

---

## Mock / Scenario Mode (`src/lib/scenario.ts`)

Controlled via `SCENARIO` env var in `.env.local`. Ignored in `NODE_ENV=production`.

| Value | What it simulates |
|---|---|
| `green_day` | Full recovery, solid sleep, ACWR 0.95 |
| `amber_day` | One signal off — borderline |
| `red_day` | HRV crashed, RHR elevated, poor sleep |
| `high_acwr` | Overreaching — ACWR 1.6 |
| `calibrating` | Mid-window, 8 days of data, provisional labels |
| `pain_flagged` | Active knee pain, capped at AMBER, prehab note |
| *(empty)* | Live DB data, normal operation |

Each preset provides a full mock `readiness_daily` row + mock `calibration_state`. `/api/readiness` checks `process.env.SCENARIO` first; if set, returns preset without touching the DB.

A small `SCENARIO: red_day` chip appears in the corner of the readiness screen when active.

---

## Today's Readiness Screen (updated `app/page.tsx`)

```
┌─────────────────────────────────────────┐
│  Saturday, Jun 28          [SCENARIO]   │
├─────────────────────────────────────────┤
│                                         │
│   ●  GREEN                              │
│      Ready to train                     │
│                                         │
│   HRV 1.04×  ·  ACWR 0.92             │
│                                         │
├─────────────────────────────────────────┤
│  Sleep        7.2h  ████████░░  82     │
│  Body Battery  71   ███████░░░         │
│  Stress        28   ████░░░░░░  Low    │
├─────────────────────────────────────────┤
│  ⚠ Still calibrating · 11 days left    │
│    or                                   │
│  ⚠ Knee pain flagged · Prehab only     │
├─────────────────────────────────────────┤
│  Last synced 2h ago                     │
└─────────────────────────────────────────┘
```

**Key decisions:**
- Band color is the dominant visual — first thing your eye lands on
- Plain-language line underneath (no jargon): "Ready to train" / "Take it easy today" / "Rest and recover"
- Two deciding numbers always visible — you know why it said what it said
- Secondary stats (sleep, body battery, stress) compact below — supporting context, not the headline
- Calibration + pain warnings as a single amber chip — non-intrusive but always present
- "Last synced X ago" so data freshness is always known

The existing dashboard pages (HRV detail, sleep detail, strain charts) stay accessible via bottom nav — demoted from home, not removed.

---

## What Phase 1 Does NOT Build

- Workout recommendation or Today screen card stack
- AI coach or NL editing
- Run/strength/plyo/prehab engines
- Preference learning
- Watch write-back
- Post-run analysis or weekly notes (Phase 3+)

---

## Deployment Notes

- **Sync trigger:** cron-job.org (free), 3 jobs pointing to `https://<app>.vercel.app/api/sync?secret=CRON_SECRET`
- **Env vars needed:** `CRON_SECRET`, `GARMIN_USERNAME`, `GARMIN_PASSWORD` (or OAuth tokens), `DATABASE_URL`
- **SQLite on Vercel:** Vercel's filesystem is ephemeral on serverless functions. For production, `DATABASE_URL` should point to a persistent volume or the DB should be migrated to Turso/PlanetScale before deploy. For local dev, `prisma/dev.db` works fine.
