# Running on AI — Project Context for Claude

## What this is

A recovery-driven training system built on top of the garmin-health-dashboard. It tells you the single best thing to do today across running, lifting, plyos, and prehab — calibrated to your real numbers, explained exercise-by-exercise, and editable in one sentence by you or the AI coach.

Full spec: `RUNNING-ON-AI-Framework.md` (repo root — read this first for any non-trivial task)

## Stack

- **Next.js 14** (App Router), TypeScript, Tailwind, Recharts
- **Database**: SQLite via Prisma (`better-sqlite3`)
- **AI**: Anthropic API — already wired in `src/app/api/ai-summary/route.ts`
- **Data**: Garmin Connect via `garmin-connect` npm package
- **Testing**: Jest

## Commands

```bash
npm run dev        # dev server at http://localhost:3030
npm run build      # production build
npm test           # Jest tests
npm run test:ci    # CI test run with coverage
```

## Key existing files

- `src/lib/garmin.ts` — Garmin client (warm singleton, 15-min cache, mock fallback)
- `src/lib/scoring.ts` — Recovery/strain/sleep scoring (HRV+RHR+sleep → recovery; Bannister TRIMP → strain)
- `src/lib/mockData.ts` — Mock data for dev/testing
- `src/lib/types.ts` — Shared TypeScript types
- `src/app/api/ai-summary/route.ts` — Anthropic API integration (expand into Coach Brain)
- `src/components/Dashboard.tsx` — Main dashboard component

## Architecture rules

1. **Never call Garmin in a request path** — always read from the DB (nightly job populates it)
2. **Mock mode first** — every feature must work with mock data before wiring live Garmin
3. **SQLite is the single source of truth** — all Garmin data lands in DB via nightly sync
4. **Safety logic in code, not prompts** — Claude does judgment; deterministic TS does math/safety

## Database schema location

- `prisma/schema.prisma` — Prisma schema (see spec §3 for full table list)
- `prisma/seed.ts` — Seed script for exercise library and starter data
- `src/lib/db.ts` — Prisma client singleton

## Phase status

See `BUILD-STATE.md` in the project root for the authoritative, always-current
state and the remaining-work list. Summary: **all six phases are built.**

- **Phases 0–3:** foundation, readiness + intro ramp, strength tracker, run engine.
- **Phase 4 — Plyo / prehab / stretch:** `plyoEngine.ts`, `prehabEngine.ts`,
  `stretchEngine.ts`, the `niggle_log` tracker and `/niggle`.
- **Phase 5 — Allocator + Session + editing:** `load.ts` (load currency + ACWR),
  `allocator.ts`, `session.ts` (`applySessionPatch` + validator), the Today
  screen, and eight session/niggle API routes. This is the product.
- **Phase 6 — NL editing, learning, write-back:** `coach.ts` (NL → validated
  patch), `preferences.ts` (§13 inference), `deload.ts`, `garminWorkout.ts`.

Gates as of 2026-09-16: 1163 tests green, `tsc` clean, `next build` clean.

## Rules that are load-bearing — do not quietly undo these

1. **One edit funnel.** Coach and user both go through `validateSessionPatch` /
   `applySessionPatch`. The coach's `actor` is hardcoded to `'coach'` and it
   never sets `override`, so a model response cannot launder itself past
   `edit_history`. Preview is the default; applying is opt-in (§11).
2. **Re-validate on apply, never trust a preview.** A previewed patch is not a
   token. The session may have moved underneath it.
3. **Estimates are labelled and the label is load-bearing.** `resolveTarget`
   refuses to issue a pace target from an `estimate` anchor. Never upgrade a
   `source` without the observation that earns it.
4. **Clearance is never invented.** Blank stays blank; the engines stay
   conservative and say so on screen. A half-filled clearance form is rejected
   rather than stored, because a `null` field reads as *unrestricted*.
5. **No diagnosis language reaches the UI.** `containsDiagnosisLanguage` gates
   engine output, model output, and authored catalog `rationale` copy.
6. **Charts never appear on the Today screen** (§14). They live on `/trends`.
7. **`npx prisma generate` after any schema change**, then `npx prisma db push`.

## Key files added since the original dashboard

- `src/types/session.ts` — the Session object (framework §3). Fixed shape; later
  phases add item kinds, they do not restructure it.
- `src/lib/strengthEngine.ts` — pure strength math and safety rails
- `src/lib/keyLifts.ts` + `src/data/key-lifts.json` — the 20 curated,
  auto-progressed runner lifts
- `src/lib/strengthScenario.ts` — `STRENGTH_SCENARIO` presets
- `scripts/seed-dev.ts` — 28 days of realistic local history
- `src/lib/runEngine.ts` — run taxonomy, the return-to-run ladder, readiness veto
- `src/lib/runAnalysis.ts` — easy-day audit, pace at matched HR, LTHR estimation
- `src/lib/runScenario.ts` — `RUN_SCENARIO` presets
- `scripts/garmin-backfill.ts` + `/api/garmin/check` — the go-live path
- `GARMIN-SETUP.md` — Forerunner 965 setup, three commands

## Data sources

- **free-exercise-db** (public domain) — primary exercise library, 800+ exercises
  - Fetch from GitHub: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`
  - Fields: `name`, `primaryMuscles`, `secondaryMuscles`, `equipment`, `mechanic`, `level`, `force`, `category`, `instructions`, `images`
- **wger** (CC-BY-SA) — secondary supplement, REST API at `https://wger.de/api/v2/`
- **Plyo/prehab/stretch** — authored JSON in `src/data/`

## Licensing note

free-exercise-db: public domain (safe). wger: CC-BY-SA (attribute if redistributing). ExerciseDB GIFs: commercially licensed (Kaggle re-upload fine for personal use). rehabhero/muscleandstrength: proprietary (use facts + links only).
