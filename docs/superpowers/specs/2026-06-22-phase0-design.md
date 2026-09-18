# Phase 0 Design — Foundation
**Running on AI · 2026-06-22**

## Overview

Phase 0 establishes the project foundation: a renamed, restructured Next.js app running on mock data, a Prisma + SQLite database with all tables defined, a merged exercise library seeded from three sources with deduplication, hand-authored plyo/prehab/stretch catalogs, and a working library browser UI for all four modalities.

**Ships:** browsable, filterable card library for strength, plyo, prehab, and stretch — backed by real data.

---

## 1. Project Setup

### 1.1 Source

Copy `garmin-health-dashboard-1.1.0/garmin-health-dashboard-1.1.0/` to `Fitness App/running-on-ai/`. Keep the original zip as a reference backup. Update `package.json` `name` field to `"running-on-ai"`.

### 1.2 Directory structure

```
running-on-ai/
  prisma/
    schema.prisma
    migrations/
  src/
    app/
      page.tsx                    # existing home (becomes Today screen in Phase 5)
      layout.tsx                  # existing
      globals.css                 # existing
      strength/
        page.tsx                  # Phase 0: library browser
      plyo/
        page.tsx                  # Phase 0: library browser
      prehab/
        page.tsx                  # Phase 0: library browser
      stretch/
        page.tsx                  # Phase 0: library browser
      onboarding/                 # stub dir (Phase 1)
      run/                        # stub dir (Phase 3)
      api/
        ai-summary/               # existing
        health/                   # existing
        trends/                   # existing
        push/                     # existing
        debug/                    # existing
        library/
          route.ts                # Phase 0: search/filter API endpoint
        sync/                     # stub dir (Phase 1)
        coach/                    # stub dir (Phase 5)
    components/
      ExerciseCard.tsx            # Phase 0: shared card, all modalities
      LibraryBrowser.tsx          # Phase 0: search + filter shell
      BottomNav.tsx               # existing — add 4 new tabs
      [all other existing components untouched]
    lib/
      db.ts                       # Phase 0: Prisma client singleton
      garmin.ts                   # existing
      scoring.ts                  # existing
      mockData.ts                 # existing
      allocator.ts                # stub (Phase 5)
      calibration.ts              # stub (Phase 1)
      runEngine.ts                # stub (Phase 3)
      strengthEngine.ts           # stub (Phase 2)
      plyoEngine.ts               # stub (Phase 4)
      prehabEngine.ts             # stub (Phase 4)
      stretchEngine.ts            # stub (Phase 4)
      preferences.ts              # stub (Phase 6)
    data/
      exercises.seed.ts           # Phase 0: field-mapping adapter (ExerciseDB → canonical schema)
      plyos.seed.json             # Phase 0: hand-authored plyo catalog (~25 entries)
      prehab.seed.json            # Phase 0: hand-authored prehab catalog (~30 entries)
      stretch.seed.json           # Phase 0: hand-authored stretch catalog (~20 entries)
  scripts/
    seed.ts                       # Phase 0: runs all seeds in order, idempotent
  .env                            # DATABASE_URL=file:./prisma/dev.db
```

### 1.3 OneDrive note

Add `node_modules` to OneDrive excluded folders (Settings → Sync and backup → Manage backup → Advanced settings) to avoid sync churn on the package directory.

---

## 2. Database — Prisma + SQLite

### 2.1 Configuration

```
datasource db { provider = "sqlite"; url = env("DATABASE_URL") }
DATABASE_URL = file:./prisma/dev.db
```

### 2.2 Array fields

SQLite with Prisma does not support native array columns. All array-typed fields (muscles, instructions, equipment, etc.) are stored as JSON strings. A `parseJson<T>(field: string): T` helper in `src/lib/db.ts` deserializes them at read time.

### 2.3 Schema — library tables (active Phase 0)

```prisma
model ExerciseLibrary {
  id               String   @id @default(uuid())
  name             String   @unique
  slug             String   @unique   // normalized: lowercase, no punctuation
  gifUrl           String?            // ExerciseDB animated GIF
  images           String   @default("[]")  // JSON: free-exercise-db static images
  bodyPart         String?
  category         String?
  equipment        String   @default("[]")  // JSON
  level            String?            // beginner | intermediate | expert
  mechanic         String?            // compound | isolation
  force            String?            // push | pull | static
  primaryMuscles   String   @default("[]")  // JSON
  secondaryMuscles String   @default("[]")  // JSON
  muscleText       String?            // authored prose for coach context
  instructions     String   @default("[]")  // JSON: step array
  rationale        String?            // static "why this exercise"
  evidence         String?            // research backing
  source           String             // exercisedb | free-exercise-db | wger | manual | exercisedb+free-exercise-db
  createdAt        DateTime @default(now())
  setLogs          SetLog[]
  @@map("exercise_library")
}

model PlyoLibrary {
  id              String   @id @default(uuid())
  name            String   @unique
  intensity       String             // low | moderate | high
  contactLoad     String             // low | moderate | high
  progressionTier Int                // 0=foundational 1=moderate 2=high
  prerequisites   String   @default("[]")  // JSON: exercise ids
  target          String?
  primaryMuscles  String   @default("[]")  // JSON
  muscleText      String?
  instructions    String   @default("[]")  // JSON
  videoUrl        String?
  rationale       String?
  evidence        String?
  @@map("plyo_library")
}

model PrehabLibrary {
  id            String   @id @default(uuid())
  name          String   @unique
  bodyRegion    String             // knee | ankle | hip | low-back | shoulder | foot | shin | it-band
  category      String             // stretch | strengthen | mobility | stability | proprioception
  niggles       String   @default("[]")  // JSON: niggle tags e.g. ["achilles","heel"]
  targetTissue  String?
  primaryMuscles String  @default("[]")  // JSON
  muscleText    String?
  instructions  String   @default("[]")  // JSON
  videoUrl      String?            // link to rehabhero YouTube (never host)
  rationale     String?
  evidence      String?
  @@map("prehab_library")
}

model StretchLibrary {
  id            String   @id @default(uuid())
  name          String   @unique
  type          String             // dynamic | static
  target        String?
  whenToUse     String             // pre | post | recovery | any
  duration      String?            // e.g. "30s" or "10 reps"
  primaryMuscles String  @default("[]")  // JSON
  muscleText    String?
  instructions  String   @default("[]")  // JSON
  videoUrl      String?
  rationale     String?
  @@map("stretch_library")
}
```

### 2.4 Schema — profile + calibration (stubbed, used Phase 1)

```prisma
model AthleteProfile {
  id            String   @id @default("singleton")
  age           Int?
  sex           String?
  heightCm      Float?
  weightKg      Float?
  goalRace      String?
  goalRaceDate  DateTime?
  fitnessLevel  String?            // beginner | intermediate | advanced
  injuryHistory String?
  // Anchor JSON shape: { value, source: "estimate"|"observed"|"confirmed", confidence: 0–1 }
  hrZones       String?            // JSON: { z1: Anchor, z2: Anchor, z3: Anchor, z4: Anchor, z5: Anchor }
  trainingPaces String?            // JSON: { easy: Anchor, threshold: Anchor, interval: Anchor }
  workingLoads  String?            // JSON: { squat: Anchor, deadlift: Anchor, ... }
  plyoTier      String?            // JSON: Anchor (value 0|1|2)
  maxHR         String?            // JSON: Anchor
  lthr          String?            // JSON: Anchor
  updatedAt     DateTime @updatedAt
  @@map("athlete_profile")
}

model CalibrationState {
  id                    String    @id @default("singleton")
  startedOn             DateTime?
  windowEnd             DateTime?
  recoveryBaselineReady Boolean   @default(false)
  graduated             Boolean   @default(false)
  notes                 String?   // JSON: per-anchor confidence snapshots
  updatedAt             DateTime  @updatedAt
  @@map("calibration_state")
}
```

### 2.5 Schema — remaining tables (stubbed, used Phase 1–6)

All defined in `schema.prisma` now so later phases only add data, never restructure:

- `ReadinessDaily` — HRV, RHR, sleep, recovery score per day (Phase 1)
- `Activity` — every Garmin run (Phase 1)
- `Session` — today's prescription as ordered JSON blocks (Phase 5)
- `SetLog` — per-set weight/reps/RIR, relation to Session + ExerciseLibrary (Phase 2)
- `EditHistory` — versioned diffs with actor/reason (Phase 5)
- `Plan` — periodization macro/meso (Phase 3)
- `PlannedSession` — what the plan wants per day (Phase 3)
- `Preference` — explicit + inferred rules (Phase 6)
- `DecisionLog` — agent's memory of decisions + overrides (Phase 5)
- `FieldTest` — optional baseline test results (Phase 1)

---

## 3. Data Pipeline

### 3.1 Sources

| Source | Role | License |
|---|---|---|
| Kaggle ExerciseDB dataset | Primary — ~1,300 exercises with animated GIFs | Commercially licensed; Kaggle personal use OK |
| free-exercise-db (yuhonas/free-exercise-db, GitHub) | Enrichment — adds `level`, `mechanic`, `force`, `category`, static images | Public domain |
| wger REST API (`wger.de/api/v2/`) | Gap filler — exercises not covered by either above | CC-BY-SA (attribute, share-alike if redistributing) |

### 3.2 Seed script — `scripts/seed.ts`

Single entry point, idempotent (upserts on `slug`), runs inside a Prisma transaction per table.

**Step 1 — ExerciseDB (Kaggle JSON)**

User downloads the dataset JSON from Kaggle and places it at `scripts/data/exercisedb.json`. The seed reads it and maps to `exercise_library`:

```
ExerciseDB.id               → slug (normalized name)
ExerciseDB.name             → name
ExerciseDB.gifUrl           → gifUrl
ExerciseDB.bodyPart         → bodyPart
ExerciseDB.target           → primaryMuscles[0]
ExerciseDB.secondaryMuscles → secondaryMuscles
ExerciseDB.equipment        → equipment[0]
ExerciseDB.instructions     → instructions (array of "Step N: ..." strings, prefix stripped)
source = "exercisedb"
```

**Step 2 — free-exercise-db**

Cloned from GitHub into `scripts/data/free-exercise-db/`. Runs after ExerciseDB. For each exercise:
- **Match found** (normalized name): fills in missing fields only — `level`, `mechanic`, `force`, `category`, `images`. Existing ExerciseDB fields (gifUrl, instructions) are not overwritten.
- **No match**: inserted as a new row. `source = "free-exercise-db"`.

**Step 3 — wger**

Fetched live from `https://wger.de/api/v2/exercise/?format=json&language=2&limit=100` (paginated). Exercises not already in the library are inserted. `source = "wger"`. Attribution comment in seed file per CC-BY-SA.

**Step 4 — Deduplication**

Runs after all three sources are loaded, inside the same transaction:

1. Normalize all names → lowercase, strip punctuation, collapse whitespace → `slug`
2. Group rows by `slug`
3. For each group with >1 row, merge into one canonical row:
   - `gifUrl` → prefer ExerciseDB
   - `images` → prefer free-exercise-db
   - `mechanic`, `level`, `force`, `category` → prefer free-exercise-db
   - `primaryMuscles`, `secondaryMuscles` → union, deduplicated
   - `instructions` → prefer ExerciseDB
   - `source` → joined string e.g. `"exercisedb+free-exercise-db"`
4. Delete duplicate rows, keep the merged one
5. Log summary: "X exercises total, Y duplicates merged"

Note: dedup uses exact normalized-name equality only. Fuzzy name variants (e.g. "Barbell Squat" vs "Barbell Back Squat") remain as separate entries and can be cleaned manually.

**Step 5 — Plyo / Prehab / Stretch**

Read from `src/data/plyos.seed.json`, `prehab.seed.json`, `stretch.seed.json` and upserted into their respective tables. Upsert key is `name`.

### 3.3 Hand-authored seed catalogs

**`plyos.seed.json`** (~25 entries, covering all 3 tiers):
- Foundational: pogos, ankling, low skips, jump rope, broad jumps
- Moderate: bounding, split-squat jumps, box jumps, lateral bounds
- High: depth jumps, single-leg hops, reactive single-leg bounds

**`prehab.seed.json`** (~30 entries, using rehabhero `bodyRegion × category` taxonomy):
- Body regions: knee, ankle/foot, hip, low-back, shin, IT-band/lateral hip, shoulder, calf/Achilles
- Categories: stretch, strengthen, mobility, stability, proprioception
- Key entries: eccentric heel drops, tibialis raises, hip abductor strengthening, Nordic curls, single-leg balance, glute-med clams, calf raises, ankle dorsiflexion drills
- `videoUrl` fields link to rehabhero YouTube where available (never hosted)

**`stretch.seed.json`** (~20 entries):
- Dynamic (pre-run/lift): leg swings, hip circles, ankle rotations, dynamic hip flexor, arm circles
- Static (post/recovery): standing quad stretch, pigeon, seated hamstring, calf stretch, hip flexor lunge, doorframe chest stretch

---

## 4. Library Browser UI

### 4.1 API endpoint — `/api/library`

```
GET /api/library?type=strength&muscle=hamstrings&equipment=barbell&level=intermediate
GET /api/library?type=plyo&tier=0
GET /api/library?type=prehab&bodyRegion=knee&category=strengthen
GET /api/library?type=stretch&stretchType=dynamic
```

Reads from the appropriate library table via Prisma, applies filter params as `WHERE` clauses, returns JSON. Full catalog fetched once on page load; subsequent filter changes are client-side against the cached array. For a personal app, ~1,300 exercises ≈ 1–2 MB of JSON (GIF URLs only, images lazy-loaded by the browser) — acceptable for instant client-side filtering. If load time becomes an issue, add server-side pagination later.

### 4.2 Shared components

**`LibraryBrowser`** (parameterized by `type`):
- Search input — client-side name search, instant results
- Filter dropdowns (top bar, AND-combined):
  - Strength: Muscle / Equipment / Level
  - Plyo: Tier / Intensity
  - Prehab: Body Region / Category
  - Stretch: Type (dynamic/static) / When to use
- Renders a list of `ExerciseCard` components

**`ExerciseCard`** (horizontal compact):
- Collapsed: thumbnail GIF or static image (left) + name + primary muscles + mechanic/level chips (right) + chevron
- Expanded inline (no modal, no navigation): full how-to steps list + rationale chip + `muscleText` + video link if present
- One card component handles all four modalities; non-applicable fields simply don't render

### 4.3 Routes

| Route | Content |
|---|---|
| `/strength` | `<LibraryBrowser type="strength" />` |
| `/plyo` | `<LibraryBrowser type="plyo" />` |
| `/prehab` | `<LibraryBrowser type="prehab" />` |
| `/stretch` | `<LibraryBrowser type="stretch" />` |

### 4.4 Navigation

`BottomNav.tsx` extended with four new tabs: **Strength**, **Plyo**, **Prehab**, **Stretch**, alongside the existing tabs (Home, HRV, Sleep, Strain, Stress, Trends, Profile). If the nav becomes crowded, the four library tabs can be grouped under a single "Library" tab with a sub-nav — deferred decision.

---

## 5. Out of Scope for Phase 0

- Garmin live data (mock data only — existing mock fallback in `garmin.ts` is sufficient)
- Strength logging / set tracking (Phase 2)
- Any recommendation logic (Phase 2+)
- Onboarding intake / calibration (Phase 1)
- The Session object and Today screen (Phase 5)
- Niggle tracker (Phase 4)
- Watch write-back (Phase 6)
- Fuzzy dedup of exercise name variants

---

## 6. Success Criteria

- `npm run dev` starts the app with no Garmin credentials (mock data mode)
- `npx tsx scripts/seed.ts` completes and logs a summary (X exercises, Y merged)
- `/strength`, `/plyo`, `/prehab`, `/stretch` all load with cards populated from the DB
- Search and filter work client-side with instant response
- Expanding a card shows how-to steps and rationale
- All Phase 5+ stub files and directories exist in the right locations
- `npx prisma studio` shows all tables defined (even if most are empty)
