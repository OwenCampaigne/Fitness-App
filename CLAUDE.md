# Running on AI — Project Context for Claude

## What this is

A recovery-driven training system built on top of the garmin-health-dashboard. It tells you the single best thing to do today across running, lifting, plyos, and prehab — calibrated to your real numbers, explained exercise-by-exercise, and editable in one sentence by you or the AI coach.

Full spec: `../../RUNNING-ON-AI-Framework.md` (parent directory — read this first for any non-trivial task)

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

Currently implementing **Phase 0 — Foundation**:
- [ ] Prisma + SQLite schema (all tables from spec §3)
- [ ] Exercise library seed (free-exercise-db import)
- [ ] Plyo/prehab/stretch starter JSON catalogs
- [ ] ExerciseCard component
- [ ] Exercise library browse page `/exercises`

Phase 1 (Readiness + Intro Ramp) starts after Phase 0 ships.

## Data sources

- **free-exercise-db** (public domain) — primary exercise library, 800+ exercises
  - Fetch from GitHub: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`
  - Fields: `name`, `primaryMuscles`, `secondaryMuscles`, `equipment`, `mechanic`, `level`, `force`, `category`, `instructions`, `images`
- **wger** (CC-BY-SA) — secondary supplement, REST API at `https://wger.de/api/v2/`
- **Plyo/prehab/stretch** — authored JSON in `src/data/`

## Licensing note

free-exercise-db: public domain (safe). wger: CC-BY-SA (attribute if redistributing). ExerciseDB GIFs: commercially licensed (Kaggle re-upload fine for personal use). rehabhero/muscleandstrength: proprietary (use facts + links only).
