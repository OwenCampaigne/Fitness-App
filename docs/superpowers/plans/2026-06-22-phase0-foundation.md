# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Running on AI project from the Garmin dashboard base — full Prisma schema, three-source exercise library seed pipeline with dedup, hand-authored plyo/prehab/stretch catalogs, and four working library browser pages.

**Architecture:** Copy the existing `garmin-health-dashboard` Next.js 14 app to `running-on-ai/`, add Prisma + SQLite, write all 15 DB tables upfront, seed from ExerciseDB → free-exercise-db → wger → dedup → hand-authored JSONs, then build shared `LibraryBrowser` + `ExerciseCard` components served by a single `/api/library` route.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Prisma 5, SQLite, Jest, tsx (for seed scripts)

---

## File Map

| File | Action | Notes |
|---|---|---|
| `running-on-ai/` | Create (copy) | Base: `garmin-health-dashboard-1.1.0/garmin-health-dashboard-1.1.0/` |
| `prisma/schema.prisma` | Create | All 15 tables |
| `prisma/migrations/` | Auto-generated | `prisma migrate dev` |
| `.env` | Create | `DATABASE_URL=file:./prisma/dev.db` |
| `src/lib/db.ts` | Create | Prisma singleton + `parseJson<T>()` |
| `src/lib/types.ts` | Modify | Add library types |
| `src/lib/allocator.ts` | Create (stub) | |
| `src/lib/calibration.ts` | Create (stub) | |
| `src/lib/runEngine.ts` | Create (stub) | |
| `src/lib/strengthEngine.ts` | Create (stub) | |
| `src/lib/plyoEngine.ts` | Create (stub) | |
| `src/lib/prehabEngine.ts` | Create (stub) | |
| `src/lib/stretchEngine.ts` | Create (stub) | |
| `src/lib/preferences.ts` | Create (stub) | |
| `src/data/exercises.seed.ts` | Create | ExerciseDB → canonical field mapper |
| `src/data/plyos.seed.json` | Create | ~25 hand-authored plyo entries |
| `src/data/prehab.seed.json` | Create | ~30 hand-authored prehab entries |
| `src/data/stretch.seed.json` | Create | ~20 hand-authored stretch entries |
| `scripts/seed.ts` | Create | Full seed: ExerciseDB→free-exercise-db→wger→dedup→plyo/prehab/stretch |
| `scripts/data/` | Create (stub dir) | User drops `exercisedb.json` here; `free-exercise-db/` cloned here |
| `src/app/api/library/route.ts` | Create | Query + filter across all 4 library tables |
| `src/app/strength/page.tsx` | Create | `<LibraryBrowser type="strength" />` |
| `src/app/plyo/page.tsx` | Create | `<LibraryBrowser type="plyo" />` |
| `src/app/prehab/page.tsx` | Create | `<LibraryBrowser type="prehab" />` |
| `src/app/stretch/page.tsx` | Create | `<LibraryBrowser type="stretch" />` |
| `src/app/onboarding/` | Create (stub dir) | Phase 1 |
| `src/app/run/` | Create (stub dir) | Phase 3 |
| `src/app/api/sync/` | Create (stub dir) | Phase 1 |
| `src/app/api/coach/` | Create (stub dir) | Phase 5 |
| `src/components/ExerciseCard.tsx` | Create | Horizontal compact card, all modalities |
| `src/components/LibraryBrowser.tsx` | Create | Search + filter shell, parameterized by type |
| `src/components/BottomNav.tsx` | Modify | Add Strength, Plyo, Prehab, Stretch tabs |
| `src/__tests__/lib/db.test.ts` | Create | Tests for `parseJson<T>()` |
| `src/__tests__/lib/seed-utils.test.ts` | Create | Tests for `slugify()` + `mergeExerciseRows()` |
| `src/__tests__/api/library.test.ts` | Create | Tests for `/api/library` route handler |
| `src/__tests__/components/ExerciseCard.test.tsx` | Create | Render tests for ExerciseCard |

---

## Task 1: Project Copy + Scaffold

**Files:**
- Create: `running-on-ai/` (copied from dashboard)
- Create: `.env`
- Create: `scripts/data/.gitkeep`
- Create: stub dirs for future phases

- [ ] **Step 1: Copy the dashboard**

  From a PowerShell terminal in `Fitness App/`:

  ```powershell
  Copy-Item -Recurse "garmin-health-dashboard-1.1.0\garmin-health-dashboard-1.1.0\" "running-on-ai\"
  ```

- [ ] **Step 2: Rename the project**

  Open `running-on-ai/package.json`, change:
  ```json
  "name": "running-on-ai"
  ```

- [ ] **Step 3: Init git**

  ```powershell
  cd "running-on-ai"
  git init
  git add .
  git commit -m "chore: initial copy from garmin-health-dashboard"
  ```

- [ ] **Step 4: Create .env**

  Create `running-on-ai/.env`:
  ```
  DATABASE_URL=file:./prisma/dev.db
  GARMIN_USERNAME=
  GARMIN_PASSWORD=
  ```

  Create `running-on-ai/.env.example`:
  ```
  DATABASE_URL=file:./prisma/dev.db
  GARMIN_USERNAME=your_garmin_email
  GARMIN_PASSWORD=your_garmin_password
  ```

  Verify `.gitignore` already contains `.env` (it will from the Next.js template). If not, add it.

- [ ] **Step 5: Create stub directories and placeholder files**

  From `running-on-ai/`:

  ```powershell
  # Data dir for seed inputs
  New-Item -ItemType Directory -Force "scripts\data"
  New-Item -ItemType File "scripts\data\.gitkeep"

  # Future phase stub dirs
  New-Item -ItemType Directory -Force "src\app\onboarding"
  New-Item -ItemType Directory -Force "src\app\run"
  New-Item -ItemType Directory -Force "src\app\api\sync"
  New-Item -ItemType Directory -Force "src\app\api\coach"
  New-Item -ItemType Directory -Force "src\data"
  ```

- [ ] **Step 6: Verify dev server still starts**

  ```powershell
  npm run dev
  ```

  Expected: app opens at `http://localhost:3000` showing the Garmin dashboard (mock data mode if no credentials). Stop the server.

- [ ] **Step 7: Commit**

  ```powershell
  git add .
  git commit -m "chore: scaffold dirs, .env, stub dirs for future phases"
  ```

---

## Task 2: Prisma Setup + Full Schema

**Files:**
- Create: `prisma/schema.prisma`
- Auto-generated: `prisma/migrations/`

- [ ] **Step 1: Install Prisma**

  ```powershell
  npm install prisma @prisma/client
  npm install -D tsx
  npx prisma init --datasource-provider sqlite
  ```

  This creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env` (already set).

- [ ] **Step 2: Write the full schema**

  Replace the contents of `prisma/schema.prisma` with:

  ```prisma
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "sqlite"
    url      = env("DATABASE_URL")
  }

  // ─── Phase 0: Active ──────────────────────────────────────────────────────────

  model ExerciseLibrary {
    id               String   @id @default(uuid())
    name             String   @unique
    slug             String   @unique
    gifUrl           String?
    images           String   @default("[]")
    bodyPart         String?
    category         String?
    equipment        String   @default("[]")
    level            String?
    mechanic         String?
    force            String?
    primaryMuscles   String   @default("[]")
    secondaryMuscles String   @default("[]")
    muscleText       String?
    instructions     String   @default("[]")
    rationale        String?
    evidence         String?
    source           String
    createdAt        DateTime @default(now())
    setLogs          SetLog[]
    @@map("exercise_library")
  }

  model PlyoLibrary {
    id              String   @id @default(uuid())
    name            String   @unique
    intensity       String
    contactLoad     String
    progressionTier Int
    prerequisites   String   @default("[]")
    target          String?
    primaryMuscles  String   @default("[]")
    muscleText      String?
    instructions    String   @default("[]")
    videoUrl        String?
    rationale       String?
    evidence        String?
    @@map("plyo_library")
  }

  model PrehabLibrary {
    id             String   @id @default(uuid())
    name           String   @unique
    bodyRegion     String
    category       String
    niggles        String   @default("[]")
    targetTissue   String?
    primaryMuscles String   @default("[]")
    muscleText     String?
    instructions   String   @default("[]")
    videoUrl       String?
    rationale      String?
    evidence       String?
    @@map("prehab_library")
  }

  model StretchLibrary {
    id             String   @id @default(uuid())
    name           String   @unique
    type           String
    target         String?
    whenToUse      String
    duration       String?
    primaryMuscles String   @default("[]")
    muscleText     String?
    instructions   String   @default("[]")
    videoUrl       String?
    rationale      String?
    @@map("stretch_library")
  }

  // ─── Phase 1: Stubbed ─────────────────────────────────────────────────────────

  model AthleteProfile {
    id            String    @id @default("singleton")
    age           Int?
    sex           String?
    heightCm      Float?
    weightKg      Float?
    goalRace      String?
    goalRaceDate  DateTime?
    fitnessLevel  String?
    injuryHistory String?
    hrZones       String?
    trainingPaces String?
    workingLoads  String?
    plyoTier      String?
    maxHR         String?
    lthr          String?
    updatedAt     DateTime  @updatedAt
    @@map("athlete_profile")
  }

  model CalibrationState {
    id                    String    @id @default("singleton")
    startedOn             DateTime?
    windowEnd             DateTime?
    recoveryBaselineReady Boolean   @default(false)
    graduated             Boolean   @default(false)
    notes                 String?
    updatedAt             DateTime  @updatedAt
    @@map("calibration_state")
  }

  model ReadinessDaily {
    id            String   @id @default(uuid())
    date          DateTime @unique
    hrv           Float?
    rhr           Float?
    sleepScore    Float?
    recoveryScore Float?
    bodyBattery   Float?
    createdAt     DateTime @default(now())
    @@map("readiness_daily")
  }

  model Activity {
    id          String   @id @default(uuid())
    garminId    String?  @unique
    date        DateTime
    type        String
    durationSec Int
    distanceM   Float?
    avgHR       Float?
    maxHR       Float?
    calories    Float?
    trimp       Float?
    createdAt   DateTime @default(now())
    @@map("activity")
  }

  // ─── Phase 2: Stubbed ─────────────────────────────────────────────────────────

  model SetLog {
    id         String          @id @default(uuid())
    sessionId  String
    exerciseId String
    setNumber  Int
    weightKg   Float?
    reps       Int?
    rir        Int?
    notes      String?
    createdAt  DateTime        @default(now())
    session    Session         @relation(fields: [sessionId], references: [id])
    exercise   ExerciseLibrary @relation(fields: [exerciseId], references: [id])
    @@map("set_log")
  }

  // ─── Phase 3: Stubbed ─────────────────────────────────────────────────────────

  model Plan {
    id              String           @id @default(uuid())
    name            String
    startDate       DateTime
    endDate         DateTime?
    phase           String?
    notes           String?
    createdAt       DateTime         @default(now())
    plannedSessions PlannedSession[]
    @@map("plan")
  }

  model PlannedSession {
    id     String   @id @default(uuid())
    planId String
    date   DateTime
    type   String
    target String?
    notes  String?
    plan   Plan     @relation(fields: [planId], references: [id])
    @@map("planned_session")
  }

  // ─── Phase 5: Stubbed ─────────────────────────────────────────────────────────

  model Session {
    id        String   @id @default(uuid())
    date      DateTime @unique
    type      String
    blocks    String   @default("[]")
    status    String   @default("planned")
    notes     String?
    createdAt DateTime @default(now())
    setLogs   SetLog[]
    @@map("session")
  }

  model EditHistory {
    id        String   @id @default(uuid())
    table     String
    recordId  String
    field     String
    oldValue  String?
    newValue  String?
    actor     String   @default("user")
    reason    String?
    createdAt DateTime @default(now())
    @@map("edit_history")
  }

  model DecisionLog {
    id        String   @id @default(uuid())
    date      DateTime
    context   String
    decision  String
    reasoning String?
    override  Boolean  @default(false)
    createdAt DateTime @default(now())
    @@map("decision_log")
  }

  // ─── Phase 6: Stubbed ─────────────────────────────────────────────────────────

  model Preference {
    id        String   @id @default(uuid())
    key       String   @unique
    value     String
    source    String   @default("user")
    updatedAt DateTime @updatedAt
    @@map("preference")
  }

  model FieldTest {
    id        String   @id @default(uuid())
    date      DateTime
    type      String
    result    String
    notes     String?
    createdAt DateTime @default(now())
    @@map("field_test")
  }
  ```

- [ ] **Step 3: Run the migration**

  ```powershell
  npx prisma migrate dev --name init
  ```

  Expected output:
  ```
  Environment variables loaded from .env
  Prisma schema loaded from prisma/schema.prisma
  Datasource "db": SQLite database "dev.db" at "file:./prisma/dev.db"

  Applying migration `20260622000000_init`

  The following migration(s) have been applied:

  migrations/
    └─ 20260622000000_init/
      └─ migration.sql

  Your database is now in sync with your schema.
  ✔ Generated Prisma Client
  ```

- [ ] **Step 4: Verify in Prisma Studio**

  ```powershell
  npx prisma studio
  ```

  Opens at `http://localhost:5555`. Confirm all 16 tables are listed. Close Studio.

- [ ] **Step 5: Commit**

  ```powershell
  git add prisma/ package.json package-lock.json
  git commit -m "feat: add Prisma + SQLite, define all 16 tables"
  ```

---

## Task 3: db.ts — Prisma Singleton + parseJson Helper

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/__tests__/lib/db.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `src/__tests__/lib/db.test.ts`:

  ```typescript
  import { parseJson } from '@/lib/db';

  describe('parseJson', () => {
    it('parses a valid JSON string into the given type', () => {
      const result = parseJson<string[]>('["hamstrings","glutes"]');
      expect(result).toEqual(['hamstrings', 'glutes']);
    });

    it('returns the fallback when the string is an empty JSON array', () => {
      const result = parseJson<string[]>('[]');
      expect(result).toEqual([]);
    });

    it('returns an empty array fallback when passed an empty string', () => {
      const result = parseJson<string[]>('');
      expect(result).toEqual([]);
    });

    it('returns null fallback when passed null', () => {
      const result = parseJson<string[] | null>(null, null);
      expect(result).toBeNull();
    });

    it('parses nested objects', () => {
      const json = '{"value":180,"source":"estimate","confidence":0.5}';
      const result = parseJson<{ value: number; source: string; confidence: number }>(json);
      expect(result).toEqual({ value: 180, source: 'estimate', confidence: 0.5 });
    });

    it('throws on malformed JSON', () => {
      expect(() => parseJson<string[]>('{bad json')).toThrow(SyntaxError);
    });
  });
  ```

- [ ] **Step 2: Run the test to confirm it fails**

  ```powershell
  npx jest src/__tests__/lib/db.test.ts --no-coverage
  ```

  Expected: FAIL — `Cannot find module '@/lib/db'`

- [ ] **Step 3: Write the implementation**

  Create `src/lib/db.ts`:

  ```typescript
  import { PrismaClient } from '@prisma/client';

  const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

  export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : [],
    });

  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

  export function parseJson<T>(value: string | null | undefined, fallback?: T): T {
    if (value === null || value === undefined || value === '') {
      return (fallback !== undefined ? fallback : []) as T;
    }
    return JSON.parse(value) as T;
  }
  ```

- [ ] **Step 4: Run the test to confirm it passes**

  ```powershell
  npx jest src/__tests__/lib/db.test.ts --no-coverage
  ```

  Expected:
  ```
  PASS src/__tests__/lib/db.test.ts
    parseJson
      ✓ parses a valid JSON string into the given type
      ✓ returns the fallback when the string is an empty JSON array
      ✓ returns an empty array fallback when passed an empty string
      ✓ returns null fallback when passed null
      ✓ parses nested objects
      ✓ throws on malformed JSON

  Test Suites: 1 passed, 1 total
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add src/lib/db.ts src/__tests__/lib/db.test.ts
  git commit -m "feat: add Prisma singleton and parseJson helper"
  ```

---

## Task 4: Stub Engine Files

**Files:**
- Create: `src/lib/allocator.ts`
- Create: `src/lib/calibration.ts`
- Create: `src/lib/runEngine.ts`
- Create: `src/lib/strengthEngine.ts`
- Create: `src/lib/plyoEngine.ts`
- Create: `src/lib/prehabEngine.ts`
- Create: `src/lib/stretchEngine.ts`
- Create: `src/lib/preferences.ts`

- [ ] **Step 1: Create all stub files**

  Create `src/lib/allocator.ts`:
  ```typescript
  // Phase 5 — daily training allocator driven by readiness + Claude
  export {};
  ```

  Create `src/lib/calibration.ts`:
  ```typescript
  // Phase 1 — 28-day calibration ramp: anchor confidence accumulation
  export {};
  ```

  Create `src/lib/runEngine.ts`:
  ```typescript
  // Phase 3 — run prescription: paces, distances, HR zones
  export {};
  ```

  Create `src/lib/strengthEngine.ts`:
  ```typescript
  // Phase 2 — strength prescription: progressive overload, working loads
  export {};
  ```

  Create `src/lib/plyoEngine.ts`:
  ```typescript
  // Phase 4 — plyo prescription: tier gating, contact load management
  export {};
  ```

  Create `src/lib/prehabEngine.ts`:
  ```typescript
  // Phase 4 — prehab prescription: niggle-driven selection
  export {};
  ```

  Create `src/lib/stretchEngine.ts`:
  ```typescript
  // Phase 4 — stretch prescription: pre/post selection by modality
  export {};
  ```

  Create `src/lib/preferences.ts`:
  ```typescript
  // Phase 6 — explicit and inferred user preference rules
  export {};
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```powershell
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```powershell
  git add src/lib/allocator.ts src/lib/calibration.ts src/lib/runEngine.ts src/lib/strengthEngine.ts src/lib/plyoEngine.ts src/lib/prehabEngine.ts src/lib/stretchEngine.ts src/lib/preferences.ts
  git commit -m "chore: stub engine and preference files for future phases"
  ```

---

## Task 5: Library Types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Append library types to types.ts**

  Add the following to the bottom of `src/lib/types.ts`:

  ```typescript
  // ─── Library Types ────────────────────────────────────────────────────────────

  export type LibraryType = 'strength' | 'plyo' | 'prehab' | 'stretch';

  export interface ExerciseEntry {
    id: string;
    name: string;
    slug: string;
    gifUrl: string | null;
    images: string[];
    bodyPart: string | null;
    category: string | null;
    equipment: string[];
    level: string | null;
    mechanic: string | null;
    force: string | null;
    primaryMuscles: string[];
    secondaryMuscles: string[];
    muscleText: string | null;
    instructions: string[];
    rationale: string | null;
    evidence: string | null;
    source: string;
  }

  export interface PlyoEntry {
    id: string;
    name: string;
    intensity: 'low' | 'moderate' | 'high';
    contactLoad: 'low' | 'moderate' | 'high';
    progressionTier: 0 | 1 | 2;
    prerequisites: string[];
    target: string | null;
    primaryMuscles: string[];
    muscleText: string | null;
    instructions: string[];
    videoUrl: string | null;
    rationale: string | null;
    evidence: string | null;
  }

  export interface PrehabEntry {
    id: string;
    name: string;
    bodyRegion: 'knee' | 'ankle' | 'hip' | 'low-back' | 'shoulder' | 'foot' | 'shin' | 'it-band';
    category: 'stretch' | 'strengthen' | 'mobility' | 'stability' | 'proprioception';
    niggles: string[];
    targetTissue: string | null;
    primaryMuscles: string[];
    muscleText: string | null;
    instructions: string[];
    videoUrl: string | null;
    rationale: string | null;
    evidence: string | null;
  }

  export interface StretchEntry {
    id: string;
    name: string;
    type: 'dynamic' | 'static';
    target: string | null;
    whenToUse: 'pre' | 'post' | 'recovery' | 'any';
    duration: string | null;
    primaryMuscles: string[];
    muscleText: string | null;
    instructions: string[];
    videoUrl: string | null;
    rationale: string | null;
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```powershell
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```powershell
  git add src/lib/types.ts
  git commit -m "feat: add library types — ExerciseEntry, PlyoEntry, PrehabEntry, StretchEntry"
  ```

---

## Task 6: Hand-Authored Seed Catalogs

**Files:**
- Create: `src/data/plyos.seed.json`
- Create: `src/data/prehab.seed.json`
- Create: `src/data/stretch.seed.json`

### 6a — plyos.seed.json

- [ ] **Step 1: Create src/data/plyos.seed.json**

  ```json
  [
    {
      "name": "Pogos (Two-Leg)",
      "intensity": "low",
      "contactLoad": "low",
      "progressionTier": 0,
      "prerequisites": [],
      "target": "reactive strength",
      "primaryMuscles": ["calves", "achilles tendon"],
      "muscleText": "Rapid ankle-stiffness drill — trains the elastic energy cycle of the Achilles tendon without high ground-contact forces.",
      "instructions": [
        "Stand with feet hip-width apart, slight bend in knees.",
        "Spring off both feet using only ankle plantar-flexion — keep hips and knees quiet.",
        "Land softly on mid-foot and rebound immediately, minimising ground contact time.",
        "Perform 2–3 sets of 20 contacts."
      ],
      "videoUrl": null,
      "rationale": "Foundational reactive drill that develops ankle stiffness and tendon elasticity with minimal eccentric load.",
      "evidence": "Stretch-shortening cycle training at low intensity improves tendon stiffness and running economy (Mero & Komi, 1994)."
    },
    {
      "name": "Ankling",
      "intensity": "low",
      "contactLoad": "low",
      "progressionTier": 0,
      "prerequisites": [],
      "target": "foot strike mechanics",
      "primaryMuscles": ["calves", "tibialis anterior"],
      "muscleText": "Cycling drill that reinforces quick, low-height foot contacts — trains the neural pattern of fast ground contact used in sprinting and tempo running.",
      "instructions": [
        "Walk or jog slowly forward.",
        "Focus on clawing the foot down quickly beneath the hip, not in front of it.",
        "Each foot contact should be brief — think 'hot pavement'.",
        "Perform 2 × 20 m."
      ],
      "videoUrl": null,
      "rationale": "Develops the quick-contact foot strike pattern that carries over to faster running speeds.",
      "evidence": null
    },
    {
      "name": "Low Skips",
      "intensity": "low",
      "contactLoad": "low",
      "progressionTier": 0,
      "prerequisites": [],
      "target": "single-leg power",
      "primaryMuscles": ["calves", "hip flexors", "glutes"],
      "muscleText": "Skipping at low height introduces the alternating single-leg push-off pattern needed for bounding, with minimal impact.",
      "instructions": [
        "Skip slowly, keeping height low (focus on rhythm, not airtime).",
        "Drive the free knee up to hip height.",
        "Push off the ball of the foot on each step.",
        "Perform 2 × 20 m."
      ],
      "videoUrl": null,
      "rationale": "Bridge between bilateral jumping and unilateral plyometric work.",
      "evidence": null
    },
    {
      "name": "Jump Rope Basic Bounce",
      "intensity": "low",
      "contactLoad": "low",
      "progressionTier": 0,
      "prerequisites": [],
      "target": "ankle stiffness",
      "primaryMuscles": ["calves", "achilles tendon"],
      "muscleText": "Two-leg jump rope at low cadence develops the same ankle stiffness pattern as pogos with a coordination demand.",
      "instructions": [
        "Hold handles loosely, elbows near ribs.",
        "Bounce on both feet, landing on mid-foot each time.",
        "Keep rebounds small — 2–5 cm off the ground.",
        "Perform 3 × 30 seconds."
      ],
      "videoUrl": null,
      "rationale": "Efficient prehab and warm-up tool for tendon health and neuromuscular coordination.",
      "evidence": null
    },
    {
      "name": "Standing Broad Jump",
      "intensity": "low",
      "contactLoad": "moderate",
      "progressionTier": 0,
      "prerequisites": [],
      "target": "horizontal power",
      "primaryMuscles": ["glutes", "quads", "calves"],
      "muscleText": "The broad jump trains the full power chain in the horizontal direction — the same direction as running.",
      "instructions": [
        "Stand behind a line, feet shoulder-width apart.",
        "Hinge at hips and swing arms back, loading the posterior chain.",
        "Drive arms forward and jump as far horizontally as possible.",
        "Land softly with knees bent, feet flat.",
        "Perform 3 × 5 reps with full recovery."
      ],
      "videoUrl": null,
      "rationale": "Horizontal power output correlates strongly with sprint acceleration.",
      "evidence": null
    },
    {
      "name": "Two-Leg Vertical Jump",
      "intensity": "low",
      "contactLoad": "moderate",
      "progressionTier": 0,
      "prerequisites": [],
      "target": "vertical power",
      "primaryMuscles": ["glutes", "quads", "calves"],
      "muscleText": "Counter-movement jump develops triple extension (ankle, knee, hip) power — the foundation of all advanced plyo work.",
      "instructions": [
        "Stand with feet shoulder-width apart.",
        "Rapidly dip by bending knees and hinging hips, swinging arms down.",
        "Reverse direction explosively — extend hips, knees, and ankles and swing arms up.",
        "Land softly with knees bent, absorbing impact through the full leg.",
        "Perform 3 × 5 reps, full recovery between sets."
      ],
      "videoUrl": null,
      "rationale": "Counter-movement jump height is a reliable indicator of lower-body power output.",
      "evidence": null
    },
    {
      "name": "Jump Rope Alternate Foot",
      "intensity": "low",
      "contactLoad": "low",
      "progressionTier": 0,
      "prerequisites": ["Jump Rope Basic Bounce"],
      "target": "single-leg ankle stiffness",
      "primaryMuscles": ["calves", "hip flexors"],
      "muscleText": "Alternating-foot jump rope shifts each contact to a single leg, doubling the per-leg demand of basic bounce.",
      "instructions": [
        "Use the same low-bounce technique as basic bounce.",
        "Alternate feet with each rotation — left, right, left, right.",
        "Keep contacts brief; don't let the heel touch.",
        "Perform 3 × 30 seconds."
      ],
      "videoUrl": null,
      "rationale": "Bridges bilateral ankle drills to single-leg reactive work at low impact.",
      "evidence": null
    },
    {
      "name": "Squat Jump",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 0,
      "prerequisites": [],
      "target": "lower-body power",
      "primaryMuscles": ["quads", "glutes", "calves"],
      "muscleText": "Loaded squat position into jump develops power through the full lower-body chain with a longer amortisation phase than counter-movement jumps.",
      "instructions": [
        "Start in a quarter-squat position, hands behind head.",
        "Without a counter-movement, jump as high as possible from the squat.",
        "Land softly, reset to the quarter-squat, and repeat.",
        "Perform 3 × 5 reps."
      ],
      "videoUrl": null,
      "rationale": "Eliminates the stretch reflex to train pure concentric power — complements counter-movement work.",
      "evidence": null
    },
    {
      "name": "Bounding",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 1,
      "prerequisites": ["Low Skips", "Standing Broad Jump"],
      "target": "single-leg horizontal power",
      "primaryMuscles": ["glutes", "hip flexors", "calves"],
      "muscleText": "Bounding is the primary transfer drill from plyometrics to running — each stride replicates the push-off mechanics of fast running.",
      "instructions": [
        "From a jog, push off one foot and reach forward with the opposite knee.",
        "Aim for maximum distance per stride, not height.",
        "Land on mid-foot of the opposite leg and immediately drive off again.",
        "Maintain tall posture; don't lean forward excessively.",
        "Perform 3 × 30 m."
      ],
      "videoUrl": null,
      "rationale": "Bounding directly trains the ground contact mechanics and power output of running.",
      "evidence": "Mikkola et al. (2011) — plyometric training including bounding improves running economy in distance runners."
    },
    {
      "name": "Split-Squat Jump",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 1,
      "prerequisites": ["Two-Leg Vertical Jump"],
      "target": "single-leg power + hip extension",
      "primaryMuscles": ["glutes", "quads", "hip flexors"],
      "muscleText": "Lunge-position jumps train single-leg drive in the split stance used during running.",
      "instructions": [
        "Start in a lunge position — front foot flat, back knee near the floor.",
        "Jump explosively, driving both arms up.",
        "Switch legs in the air and land in the opposite lunge.",
        "Land softly and immediately jump again.",
        "Perform 3 × 8 total contacts (4 per leg)."
      ],
      "videoUrl": null,
      "rationale": "Trains the asymmetric single-leg push pattern specific to running gait.",
      "evidence": null
    },
    {
      "name": "Box Jump",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 1,
      "prerequisites": ["Two-Leg Vertical Jump"],
      "target": "explosive leg power",
      "primaryMuscles": ["glutes", "quads", "calves"],
      "muscleText": "Jumping onto a box reduces landing impact, allowing high-intent takeoffs with controlled landings.",
      "instructions": [
        "Stand 30 cm in front of a box (40–50 cm height).",
        "Counter-movement dip, then jump explosively, driving arms up.",
        "Land softly on the box with both feet flat and knees bent.",
        "Step (don't jump) down to reset.",
        "Perform 3 × 5 reps."
      ],
      "videoUrl": null,
      "rationale": "Box target shifts focus to maximal takeoff intent without high eccentric landing load.",
      "evidence": null
    },
    {
      "name": "Lateral Bound",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 1,
      "prerequisites": ["Standing Broad Jump"],
      "target": "lateral power + hip stability",
      "primaryMuscles": ["glutes", "hip abductors", "calves"],
      "muscleText": "Lateral bounds train the frontal-plane hip stability and push-off power used when cornering and on uneven terrain.",
      "instructions": [
        "Balance on one leg, slight knee bend.",
        "Push off laterally as far as possible, driving the opposite arm across.",
        "Stick the landing on the opposite leg — hold for 1 second.",
        "Repeat to the other side.",
        "Perform 3 × 6 bounds per side."
      ],
      "videoUrl": null,
      "rationale": "Frontal-plane power is undertrained in most runners; lateral bounds address this gap.",
      "evidence": null
    },
    {
      "name": "Power Skip",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 1,
      "prerequisites": ["Low Skips"],
      "target": "single-leg vertical power",
      "primaryMuscles": ["calves", "hip flexors", "glutes"],
      "muscleText": "Power skips exaggerate the skip height, training maximal single-leg push-off with a knee drive.",
      "instructions": [
        "Skip with maximal height on each rep — push hard off the ball of the foot.",
        "Drive the free knee aggressively upward.",
        "Arms drive in opposition — same side as the knee drive goes up.",
        "Perform 3 × 20 m."
      ],
      "videoUrl": null,
      "rationale": "Power skips are a high-volume way to accumulate single-leg vertical power contacts.",
      "evidence": null
    },
    {
      "name": "Tuck Jump",
      "intensity": "moderate",
      "contactLoad": "high",
      "progressionTier": 1,
      "prerequisites": ["Two-Leg Vertical Jump"],
      "target": "explosive power + rapid eccentric absorption",
      "primaryMuscles": ["quads", "glutes", "calves", "hip flexors"],
      "muscleText": "Tuck jumps demand both maximal takeoff and rapid knee-pull — a higher neural demand than basic vertical jumps.",
      "instructions": [
        "Jump vertically and pull both knees to chest at peak height.",
        "Extend legs before landing and absorb softly through ankle→knee→hip.",
        "Rebound immediately for the next rep.",
        "Perform 3 × 5 reps."
      ],
      "videoUrl": null,
      "rationale": "Higher coordination demand trains explosive hip flexion used in sprint mechanics.",
      "evidence": null
    },
    {
      "name": "Lateral Box Jump",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 1,
      "prerequisites": ["Box Jump", "Lateral Bound"],
      "target": "lateral explosive power",
      "primaryMuscles": ["glutes", "hip abductors", "quads"],
      "muscleText": "Jumping laterally onto a box combines the frontal-plane demand of lateral bounds with the low-landing-impact benefit of box jumps.",
      "instructions": [
        "Stand beside a 30–40 cm box.",
        "Push off the near leg and jump sideways onto the box.",
        "Land with both feet, knees bent.",
        "Step down and repeat.",
        "Perform 3 × 4 reps per side."
      ],
      "videoUrl": null,
      "rationale": "Develops lateral power with controlled landing load.",
      "evidence": null
    },
    {
      "name": "Hurdle Hop Low",
      "intensity": "moderate",
      "contactLoad": "moderate",
      "progressionTier": 1,
      "prerequisites": ["Two-Leg Vertical Jump"],
      "target": "reactive bilateral power",
      "primaryMuscles": ["calves", "quads", "glutes"],
      "muscleText": "Hopping over low hurdles (30 cm) trains the reactive ground-contact cycle with a target that enforces height.",
      "instructions": [
        "Set 4–6 hurdles at 30 cm height, 60–80 cm apart.",
        "Hop over each hurdle on both feet, minimising ground contact time.",
        "Keep hips high; don't collapse on landing.",
        "Perform 3 sets."
      ],
      "videoUrl": null,
      "rationale": "Hurdle height provides an external cue to maintain ground contact quality.",
      "evidence": null
    },
    {
      "name": "Depth Jump",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Box Jump", "Hurdle Hop Low"],
      "target": "maximum reactive strength",
      "primaryMuscles": ["quads", "calves", "glutes"],
      "muscleText": "The gold-standard reactive strength drill — the drop pre-loads the Achilles and quad tendons to produce a maximal rebound jump.",
      "instructions": [
        "Stand on a 40–50 cm box.",
        "Step off (don't jump off) and land on both feet.",
        "The moment both feet contact the ground, jump as high as possible.",
        "Ground contact should be under 250 ms — 'touch and go'.",
        "Perform 3 × 4–5 reps with full recovery between sets."
      ],
      "videoUrl": null,
      "rationale": "Depth jumps improve reactive strength index (RSI), which correlates with distance running economy.",
      "evidence": "Flanagan & Comyns (2008) — reactive strength index as a measure of lower limb stiffness."
    },
    {
      "name": "Single-Leg Forward Hop",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Bounding", "Lateral Bound"],
      "target": "single-leg horizontal power",
      "primaryMuscles": ["glutes", "calves", "quads"],
      "muscleText": "Hop for maximum distance on one leg — a direct measure and trainer of single-leg propulsive power.",
      "instructions": [
        "Balance on one leg.",
        "Load by hinging at the hip and bending the knee slightly.",
        "Drive forward explosively — push through the full foot to triple extension.",
        "Land on the same leg, absorb, and hold for 2 seconds.",
        "Perform 3 × 5 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Single-leg hop distance is a validated return-to-sport test and a direct power measure.",
      "evidence": null
    },
    {
      "name": "Reactive Single-Leg Bound",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Bounding", "Single-Leg Forward Hop"],
      "target": "single-leg reactive power",
      "primaryMuscles": ["glutes", "calves", "hip flexors"],
      "muscleText": "Continuous single-leg bounding with minimal ground contact — the most specific plyometric drill for distance running.",
      "instructions": [
        "Bound continuously on one leg for 20 m.",
        "Each contact should be brief — push off immediately on touch-down.",
        "Drive the free knee forward aggressively.",
        "Alternate legs each 20 m rep.",
        "Perform 2–3 × 20 m per leg."
      ],
      "videoUrl": null,
      "rationale": "Replicates the reactive single-leg push-off of fast running more closely than any other drill.",
      "evidence": "Turner et al. (2003) — plyometric training improves running economy in female distance runners."
    },
    {
      "name": "Single-Leg Box Jump",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Box Jump", "Single-Leg Forward Hop"],
      "target": "single-leg explosive power",
      "primaryMuscles": ["glutes", "quads", "calves"],
      "muscleText": "Box jump performed on one leg — demands full single-leg power output with a low-impact landing.",
      "instructions": [
        "Stand on one leg 30 cm from a 30–40 cm box.",
        "Load by hinging and bending the knee.",
        "Jump explosively onto the box, landing on the same leg with knee bent.",
        "Step down to reset.",
        "Perform 3 × 4 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Single-leg loading catches asymmetries that bilateral jumps mask.",
      "evidence": null
    },
    {
      "name": "Max-Effort Bound",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Bounding"],
      "target": "peak horizontal power",
      "primaryMuscles": ["glutes", "hip flexors", "calves"],
      "muscleText": "Full-effort bounding with maximal distance per stride — peak neuromuscular demand for horizontal power.",
      "instructions": [
        "From a 3-step approach, bound for 6–8 contacts at maximum effort.",
        "Aim for maximum stride length, not speed.",
        "Full recovery (3+ minutes) between sets.",
        "Perform 3 sets."
      ],
      "videoUrl": null,
      "rationale": "Max-effort bounding achieves higher power outputs than standard bounding and is appropriate only once tier 1 is established.",
      "evidence": null
    },
    {
      "name": "Drop Jump",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Depth Jump"],
      "target": "ankle stiffness at high load",
      "primaryMuscles": ["calves", "achilles tendon", "quads"],
      "muscleText": "Similar to depth jump but from a higher box — increases the eccentric load and demands even stiffer ankle/tendon response.",
      "instructions": [
        "Step off a 60 cm box.",
        "Land and rebound as fast as possible — no pause at bottom.",
        "Minimise knee bend; absorb through ankle and hip, not knee.",
        "Perform 3 × 4 reps with full recovery."
      ],
      "videoUrl": null,
      "rationale": "Higher drop height increases the pre-load and trains stiffness at forces closer to those of sprinting.",
      "evidence": null
    },
    {
      "name": "Single-Leg Lateral Hop",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Lateral Bound", "Single-Leg Forward Hop"],
      "target": "single-leg lateral power",
      "primaryMuscles": ["glutes", "hip abductors", "calves"],
      "muscleText": "Hopping laterally on one leg trains the frontal-plane stability and power that bilateral lateral bounds develop, at single-leg load.",
      "instructions": [
        "Balance on one leg.",
        "Push laterally off that leg and land on the same leg.",
        "Stick the landing — hold 1 second.",
        "Repeat for distance.",
        "Perform 3 × 5 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Addresses single-leg frontal-plane deficit, a common asymmetry in distance runners.",
      "evidence": null
    },
    {
      "name": "Reactive Pogos Single-Leg",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Pogos (Two-Leg)", "Single-Leg Forward Hop"],
      "target": "single-leg reactive ankle stiffness",
      "primaryMuscles": ["calves", "achilles tendon"],
      "muscleText": "Single-leg version of pogos — the highest ankle-stiffness demand at low amplitude. Primary drill for Achilles tendon reactive loading.",
      "instructions": [
        "Balance on one leg.",
        "Spring rapidly off the ankle only — hips and knees stay quiet.",
        "Keep ground contact time minimal.",
        "Perform 2 × 20 contacts per leg."
      ],
      "videoUrl": null,
      "rationale": "Highest-specificity drill for the Achilles tendon's energy-return function during fast running.",
      "evidence": null
    },
    {
      "name": "Hurdle Hop Reactive",
      "intensity": "high",
      "contactLoad": "high",
      "progressionTier": 2,
      "prerequisites": ["Hurdle Hop Low", "Depth Jump"],
      "target": "reactive bilateral power over height",
      "primaryMuscles": ["quads", "calves", "glutes"],
      "muscleText": "Hurdle hops at moderate height (50–60 cm) with minimal ground contact — the hardest reactive bilateral drill in the catalog.",
      "instructions": [
        "Set 4–6 hurdles at 50–60 cm, 80 cm apart.",
        "Hop continuously, aiming for minimum ground contact time.",
        "Stay tall — don't let hips sink between contacts.",
        "Perform 3 sets with full recovery."
      ],
      "videoUrl": null,
      "rationale": "High hurdles demand both power and reactive stiffness simultaneously.",
      "evidence": null
    }
  ]
  ```

- [ ] **Step 2: Commit**

  ```powershell
  git add src/data/plyos.seed.json
  git commit -m "feat: hand-author plyo seed catalog (25 entries, 3 tiers)"
  ```

### 6b — prehab.seed.json

- [ ] **Step 3: Create src/data/prehab.seed.json**

  ```json
  [
    {
      "name": "Eccentric Heel Drop Straight Leg",
      "bodyRegion": "ankle",
      "category": "strengthen",
      "niggles": ["achilles", "calf"],
      "targetTissue": "gastrocnemius / Achilles tendon",
      "primaryMuscles": ["calves"],
      "muscleText": "Standing on a step, the eccentric lowering phase loads the Achilles tendon progressively — the most evidence-backed intervention for Achilles tendinopathy.",
      "instructions": [
        "Stand with the ball of one foot on the edge of a step, heel hanging off.",
        "Rise up on both feet (concentric), then lower on the single working leg only (eccentric).",
        "Lower slowly over 3 seconds until the heel is below the step.",
        "Perform 3 × 15 reps per leg, twice daily.",
        "Expect mild tendon discomfort (≤4/10 pain) — this is acceptable during loading."
      ],
      "videoUrl": null,
      "rationale": "Alfredson protocol — eccentric heel drops are the gold standard for mid-portion Achilles tendinopathy.",
      "evidence": "Alfredson et al. (1998) — heavy eccentric calf training for chronic Achilles tendinosis."
    },
    {
      "name": "VMO Terminal Knee Extension",
      "bodyRegion": "knee",
      "category": "strengthen",
      "niggles": ["knee", "patella"],
      "targetTissue": "vastus medialis oblique",
      "primaryMuscles": ["quads"],
      "muscleText": "Isolates the VMO (the teardrop muscle above the inner knee) in terminal extension — the range where patellofemoral tracking is most critical.",
      "instructions": [
        "Attach a resistance band to a fixed point at knee height behind you.",
        "Loop the band around the back of the working knee.",
        "Stand on that leg with a slight bend; the band pulls the knee forward.",
        "Squeeze the quad and straighten the knee fully against the band.",
        "Hold for 2 seconds, then slowly return.",
        "Perform 3 × 15 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Weakness in VMO is a common driver of patellofemoral pain syndrome in runners.",
      "evidence": null
    },
    {
      "name": "Nordic Curl",
      "bodyRegion": "knee",
      "category": "strengthen",
      "niggles": ["hamstring"],
      "targetTissue": "biceps femoris / semimembranosus",
      "primaryMuscles": ["hamstrings"],
      "muscleText": "The highest-evidence exercise for hamstring injury prevention — eccentric load at long muscle length.",
      "instructions": [
        "Kneel with feet anchored (under a bar or held by a partner).",
        "With arms crossed over chest, fall forward slowly — resist with hamstrings.",
        "Lower as slowly as possible; catch yourself with hands when you can no longer resist.",
        "Push back up with hands to the start position.",
        "Begin with 2 × 5 reps (week 1) and progress to 3 × 8–10 over 6 weeks."
      ],
      "videoUrl": null,
      "rationale": "Reduces hamstring strain injury risk by ~51% in athletes when performed consistently.",
      "evidence": "van der Horst et al. (2015) — Nordic hamstring exercise reduces hamstring injuries in male soccer players."
    },
    {
      "name": "Single-Leg Squat VMO Focus",
      "bodyRegion": "knee",
      "category": "stability",
      "niggles": ["knee", "patella"],
      "targetTissue": "quadriceps / VMO / glute med",
      "primaryMuscles": ["quads", "glutes"],
      "muscleText": "Single-leg squat exposes valgus collapse and trains the combined strength and motor control needed for healthy knee tracking.",
      "instructions": [
        "Stand on one leg, other foot just off the floor.",
        "Slowly lower into a single-leg squat to ~60° knee flexion.",
        "Keep the knee tracking over the 2nd toe — no inward collapse.",
        "Pause for 1 second at the bottom, then return.",
        "Perform 3 × 10 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Valgus knee collapse on single-leg loading is a primary risk factor for patellofemoral pain and ACL injury.",
      "evidence": null
    },
    {
      "name": "Step-Down Eccentric",
      "bodyRegion": "knee",
      "category": "strengthen",
      "niggles": ["knee"],
      "targetTissue": "quadriceps",
      "primaryMuscles": ["quads"],
      "muscleText": "Step-down from a low step under control — emphasises the eccentric quad control used in running downhill.",
      "instructions": [
        "Stand on a 15–20 cm step on one leg.",
        "Slowly lower the opposite heel toward the floor over 3 seconds.",
        "Keep the stance knee stable and tracking forward.",
        "Return to start without the lowered foot touching down.",
        "Perform 3 × 12 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Eccentric quad control is undertrained in runners who do mostly flat terrain.",
      "evidence": null
    },
    {
      "name": "Ankle Dorsiflexion Mobilization",
      "bodyRegion": "ankle",
      "category": "mobility",
      "niggles": ["ankle", "achilles"],
      "targetTissue": "ankle joint capsule / gastrocnemius",
      "primaryMuscles": ["calves"],
      "muscleText": "Restores ankle dorsiflexion range — limited ankle mobility is linked to compensations upstream at the knee and hip.",
      "instructions": [
        "Place one foot 10 cm from a wall in a lunge position.",
        "Drive the knee forward over the little toe without the heel lifting.",
        "If the knee reaches the wall, move the foot further back.",
        "Perform 2 × 10 slow reps per ankle."
      ],
      "videoUrl": null,
      "rationale": "Restricted dorsiflexion (<35°) correlates with Achilles tendinopathy and patellofemoral pain.",
      "evidence": "Rabin & Kozol (2010) — restricted dorsiflexion associated with Achilles and knee pathology."
    },
    {
      "name": "Toe Yoga Foot Intrinsics",
      "bodyRegion": "foot",
      "category": "stability",
      "niggles": ["plantar-fascia", "foot"],
      "targetTissue": "intrinsic foot muscles / plantar fascia",
      "primaryMuscles": ["foot intrinsics"],
      "muscleText": "Isolates the intrinsic foot muscles — the small stabilisers that support the arch and distribute load across the forefoot.",
      "instructions": [
        "Sit or stand barefoot.",
        "Lift only the big toe while keeping the other four down — hold 5 seconds.",
        "Then press only the big toe down while lifting the other four — hold 5 seconds.",
        "Perform 2 × 10 reps per foot."
      ],
      "videoUrl": null,
      "rationale": "Intrinsic foot strength is a modifiable risk factor for plantar fasciitis and general foot pain.",
      "evidence": null
    },
    {
      "name": "Tibialis Anterior Raise",
      "bodyRegion": "shin",
      "category": "strengthen",
      "niggles": ["shin-splints", "anterior-shin"],
      "targetTissue": "tibialis anterior",
      "primaryMuscles": ["tibialis anterior"],
      "muscleText": "Dorsiflexion raise under body weight — directly addresses the tibialis anterior weakness common in runners with shin splints.",
      "instructions": [
        "Lean your back against a wall, feet 30 cm out.",
        "Lift both forefeet off the floor as high as possible.",
        "Lower slowly over 2 seconds.",
        "Perform 3 × 20 reps."
      ],
      "videoUrl": null,
      "rationale": "Tibialis anterior weakness contributes to medial tibial stress syndrome; progressive loading reduces recurrence.",
      "evidence": "Moen et al. (2012) — graded running programme combined with strengthening for medial tibial stress syndrome."
    },
    {
      "name": "Single-Leg Calf Raise",
      "bodyRegion": "ankle",
      "category": "strengthen",
      "niggles": ["achilles", "calf"],
      "targetTissue": "gastrocnemius / soleus",
      "primaryMuscles": ["calves"],
      "muscleText": "Full-range single-leg calf raise builds the calf-tendon unit strength needed to tolerate running loads.",
      "instructions": [
        "Stand on the edge of a step on one foot.",
        "Rise to full plantar-flexion over 1 second.",
        "Lower over 3 seconds to full stretch below step height.",
        "Perform 3 × 15 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Calf strength is the primary determinant of Achilles tendon load capacity.",
      "evidence": null
    },
    {
      "name": "Banded Ankle Eversion",
      "bodyRegion": "ankle",
      "category": "strengthen",
      "niggles": ["ankle", "lateral-ankle"],
      "targetTissue": "peroneals",
      "primaryMuscles": ["peroneals"],
      "muscleText": "Strengthens the peroneals — the lateral ankle stabilisers most commonly torn in ankle sprains.",
      "instructions": [
        "Sit with a resistance band looped around the outside of the foot.",
        "Anchor the other end to a fixed point at foot level.",
        "Evert the foot outward against the band.",
        "Return slowly.",
        "Perform 3 × 15 reps per foot."
      ],
      "videoUrl": null,
      "rationale": "Peroneal weakness is the primary modifiable factor in chronic ankle instability.",
      "evidence": null
    },
    {
      "name": "Clamshell Glute Med",
      "bodyRegion": "hip",
      "category": "strengthen",
      "niggles": ["it-band", "hip", "knee"],
      "targetTissue": "gluteus medius",
      "primaryMuscles": ["glutes", "hip abductors"],
      "muscleText": "The clamshell isolates the gluteus medius — the primary hip abductor that controls pelvic drop during single-leg stance.",
      "instructions": [
        "Lie on your side with hips stacked, knees bent to 90°.",
        "Keep feet together and rotate the top knee toward the ceiling.",
        "Open as far as possible without the pelvis rolling back.",
        "Lower slowly.",
        "Perform 3 × 20 reps per side. Add a band above the knees to progress."
      ],
      "videoUrl": null,
      "rationale": "Glute med weakness drives Trendelenburg gait, IT-band syndrome, and patellofemoral pain in runners.",
      "evidence": "Fredericson et al. (2000) — hip abductor weakness in runners with IT-band syndrome."
    },
    {
      "name": "Side-Lying Hip Abduction",
      "bodyRegion": "hip",
      "category": "strengthen",
      "niggles": ["it-band", "hip"],
      "targetTissue": "gluteus medius / TFL",
      "primaryMuscles": ["glutes", "hip abductors"],
      "muscleText": "Straight-leg hip abduction adds TFL and upper glute involvement beyond the clamshell.",
      "instructions": [
        "Lie on your side with the body in a straight line.",
        "Lift the top leg to 45° — keep the toe pointing forward (not up).",
        "Lower over 2 seconds.",
        "Perform 3 × 15 reps per side."
      ],
      "videoUrl": null,
      "rationale": "Complements clamshell by training the hip abductors through a longer lever arm.",
      "evidence": null
    },
    {
      "name": "Single-Leg Glute Bridge",
      "bodyRegion": "hip",
      "category": "strengthen",
      "niggles": ["hip", "low-back"],
      "targetTissue": "gluteus maximus / hamstrings",
      "primaryMuscles": ["glutes", "hamstrings"],
      "muscleText": "Single-leg bridge removes compensation from the opposite side, exposing hip extension asymmetries.",
      "instructions": [
        "Lie on your back with one knee bent, foot flat; the other leg extended.",
        "Drive through the heel to lift the hips until the body forms a straight line.",
        "Squeeze the glute at the top — hold 2 seconds.",
        "Lower slowly.",
        "Perform 3 × 12 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "Hip extension strength asymmetry >15% is a risk factor for hamstring and glute injury.",
      "evidence": null
    },
    {
      "name": "Hip 90-90 Stretch",
      "bodyRegion": "hip",
      "category": "mobility",
      "niggles": ["hip", "low-back"],
      "targetTissue": "hip external and internal rotators",
      "primaryMuscles": ["glutes", "hip rotators"],
      "muscleText": "The 90/90 position simultaneously stretches external rotators of one hip and internal rotators of the other — comprehensive hip rotation mobility.",
      "instructions": [
        "Sit on the floor with both knees bent to 90° — front leg externally rotated, back leg internally rotated.",
        "Sit tall and lean forward over the front leg.",
        "Hold 30–60 seconds, then switch sides.",
        "Perform 2 rounds per side."
      ],
      "videoUrl": null,
      "rationale": "Reduced hip rotation range limits stride length and loads the lumbar spine as compensation.",
      "evidence": null
    },
    {
      "name": "Couch Stretch",
      "bodyRegion": "hip",
      "category": "stretch",
      "niggles": ["hip", "knee"],
      "targetTissue": "hip flexors / rectus femoris",
      "primaryMuscles": ["hip flexors", "quads"],
      "muscleText": "The couch stretch achieves the deepest hip flexor stretch by combining hip extension with knee flexion.",
      "instructions": [
        "Kneel with one shin resting vertically against a wall or couch, knee on the floor.",
        "Step the other foot forward into a lunge.",
        "Drive the hips forward and squeeze the glute of the back leg.",
        "Hold 60–90 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Hip flexor tightness limits hip extension during push-off and increases anterior pelvic tilt under load.",
      "evidence": null
    },
    {
      "name": "Dead Bug",
      "bodyRegion": "low-back",
      "category": "stability",
      "niggles": ["low-back"],
      "targetTissue": "transverse abdominis / deep core",
      "primaryMuscles": ["core"],
      "muscleText": "Contralateral limb movement while maintaining a neutral spine — trains the deep abdominals without spinal flexion.",
      "instructions": [
        "Lie on your back. Press your lower back flat into the floor.",
        "Raise arms to the ceiling and knees to 90° (table-top).",
        "Slowly lower the opposite arm and leg toward the floor, exhaling.",
        "Return to start, maintaining lumbar contact with the floor.",
        "Perform 3 × 8 reps per side."
      ],
      "videoUrl": null,
      "rationale": "Deep core stability is the foundation for transferring force between upper and lower body during running.",
      "evidence": "McGill (2010) — core stability for low back pain prevention."
    },
    {
      "name": "Bird Dog",
      "bodyRegion": "low-back",
      "category": "stability",
      "niggles": ["low-back"],
      "targetTissue": "erector spinae / multifidus / glutes",
      "primaryMuscles": ["core", "glutes"],
      "muscleText": "Quadruped contralateral extension trains spinal stability under limb loading — a complementary drill to Dead Bug.",
      "instructions": [
        "Start on hands and knees — wrists under shoulders, knees under hips.",
        "Extend opposite arm and leg simultaneously, keeping the back flat.",
        "Hold 3 seconds, return, and switch sides.",
        "No rotation of the torso.",
        "Perform 3 × 10 reps per side."
      ],
      "videoUrl": null,
      "rationale": "Activates multifidus and erector spinae without flexion — safe for most low-back conditions.",
      "evidence": null
    },
    {
      "name": "Cat-Cow Mobilization",
      "bodyRegion": "low-back",
      "category": "mobility",
      "niggles": ["low-back"],
      "targetTissue": "thoracolumbar fascia / spinal extensors",
      "primaryMuscles": ["spinal extensors", "core"],
      "muscleText": "Full-range spinal flexion and extension cycles promote synovial fluid distribution and reduce morning stiffness.",
      "instructions": [
        "Start on hands and knees.",
        "Cat: round the spine fully upward, tucking chin and pelvis.",
        "Cow: let the belly drop, lifting the head and tailbone.",
        "Move smoothly — 1 breath per direction.",
        "Perform 2 × 10 cycles."
      ],
      "videoUrl": null,
      "rationale": "Particularly valuable as a warm-up for athletes with lumbar stiffness after sitting.",
      "evidence": null
    },
    {
      "name": "McGill Side Plank",
      "bodyRegion": "low-back",
      "category": "stability",
      "niggles": ["low-back", "it-band"],
      "targetTissue": "quadratus lumborum / obliques",
      "primaryMuscles": ["core", "obliques"],
      "muscleText": "The side plank is the most effective exercise for quadratus lumborum — the lateral stabiliser that controls lateral trunk sway in running.",
      "instructions": [
        "Lie on your side, elbow under shoulder, feet stacked.",
        "Lift the hips until the body forms a straight line — no sagging.",
        "Hold 20–60 seconds. Progress by adding hip dips (lower and raise the hip).",
        "Perform 3 holds per side."
      ],
      "videoUrl": null,
      "rationale": "Lateral core weakness increases lateral trunk lean, raising IT-band and low-back injury risk.",
      "evidence": "McGill (2010) — side plank as primary QL exercise."
    },
    {
      "name": "Tibialis Raise Wall-Assisted",
      "bodyRegion": "shin",
      "category": "strengthen",
      "niggles": ["shin-splints", "anterior-shin"],
      "targetTissue": "tibialis anterior",
      "primaryMuscles": ["tibialis anterior"],
      "muscleText": "Loaded tibialis anterior raise using body weight as resistance — used for shin-splint rehabilitation and prevention.",
      "instructions": [
        "Stand with your back and heels against a wall, feet 30 cm out.",
        "Lift both forefeet as high as possible.",
        "Lower slowly over 3 seconds.",
        "Progress by adding weight (a sandbag over the feet) or moving to single-leg.",
        "Perform 3 × 20 reps."
      ],
      "videoUrl": null,
      "rationale": "Eccentric tibialis anterior loading reduces cortical bone stress in medial tibial stress syndrome.",
      "evidence": null
    },
    {
      "name": "Shin Box Ankle Circles",
      "bodyRegion": "shin",
      "category": "mobility",
      "niggles": ["shin-splints", "ankle"],
      "targetTissue": "anterior compartment / ankle joint",
      "primaryMuscles": ["tibialis anterior", "peroneals"],
      "muscleText": "Full-circle ankle mobilisation targets the entire anterior and lateral compartment of the lower leg.",
      "instructions": [
        "Sit cross-legged (shin box position).",
        "Rotate the ankle slowly through its full range — clockwise and counter-clockwise.",
        "Perform 10 circles each direction, each ankle.",
        "Good as part of a morning or post-run routine."
      ],
      "videoUrl": null,
      "rationale": "Maintains ankle range of motion and reduces stiffness that can contribute to shin splints.",
      "evidence": null
    },
    {
      "name": "Lateral Band Walk",
      "bodyRegion": "it-band",
      "category": "strengthen",
      "niggles": ["it-band", "hip"],
      "targetTissue": "gluteus medius / TFL",
      "primaryMuscles": ["glutes", "hip abductors"],
      "muscleText": "Resisted lateral steps with a band — trains the hip abductors in the functional position used during running stance.",
      "instructions": [
        "Place a resistance band just above the knees.",
        "Stand with slight knee bend and feet hip-width apart.",
        "Step sideways 12–15 steps, then return.",
        "Keep the band taut at all times — don't let feet come closer than shoulder width.",
        "Perform 3 × 15 steps per direction."
      ],
      "videoUrl": null,
      "rationale": "Lateral band walks activate glute med in a more functional upright position than side-lying exercises.",
      "evidence": "Fredericson et al. (2000) — hip strengthening for IT-band syndrome."
    },
    {
      "name": "IT-Band Foam Roll",
      "bodyRegion": "it-band",
      "category": "mobility",
      "niggles": ["it-band"],
      "targetTissue": "iliotibial band / lateral quad",
      "primaryMuscles": ["TFL", "lateral quad"],
      "muscleText": "Foam rolling the lateral thigh addresses fascial restrictions and neural sensitisation along the IT-band without directly compressing the tendon.",
      "instructions": [
        "Lie on your side with the foam roller under the lateral thigh.",
        "Support yourself on the forearm and opposite foot.",
        "Slowly roll from just above the knee to the hip — pause on tender spots for 20–30 seconds.",
        "Avoid rolling directly over the lateral knee (where the IT-band inserts).",
        "Perform 60–90 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Reduces fascial restriction and neural sensitivity in the lateral thigh, complementing hip strengthening.",
      "evidence": null
    },
    {
      "name": "Side-Lying IT-Band Stretch",
      "bodyRegion": "it-band",
      "category": "stretch",
      "niggles": ["it-band"],
      "targetTissue": "iliotibial band / TFL",
      "primaryMuscles": ["TFL", "hip abductors"],
      "muscleText": "Cross-legged side stretch places the IT-band on tension through hip adduction and trunk lateral flexion.",
      "instructions": [
        "Stand with the affected leg crossed behind the other.",
        "Lean the upper body away from the affected side, reaching the top arm overhead.",
        "Feel the stretch along the outer thigh and hip.",
        "Hold 30–45 seconds.",
        "Perform 2–3 holds per side."
      ],
      "videoUrl": null,
      "rationale": "Direct stretch of the TFL reduces IT-band tension load at the lateral knee.",
      "evidence": null
    },
    {
      "name": "Face Pull Band",
      "bodyRegion": "shoulder",
      "category": "strengthen",
      "niggles": ["shoulder"],
      "targetTissue": "posterior deltoid / rotator cuff / lower traps",
      "primaryMuscles": ["rear delts", "rotator cuff"],
      "muscleText": "Counteracts the forward-rounded posture and anterior shoulder dominance that develops from extended running and desk work.",
      "instructions": [
        "Attach a band at face height.",
        "Pull the band toward your face, flaring elbows out to the sides.",
        "At full pull, externally rotate — thumbs point behind you.",
        "Return slowly.",
        "Perform 3 × 15 reps."
      ],
      "videoUrl": null,
      "rationale": "Face pulls restore posterior shoulder balance and scapular control often neglected in endurance athletes.",
      "evidence": null
    },
    {
      "name": "Wall Slide",
      "bodyRegion": "shoulder",
      "category": "mobility",
      "niggles": ["shoulder"],
      "targetTissue": "serratus anterior / lower trapezius",
      "primaryMuscles": ["serratus anterior", "lower traps"],
      "muscleText": "Sliding the forearms up a wall under load trains scapular upward rotation — essential for overhead arm swing and shoulder health.",
      "instructions": [
        "Stand facing a wall, forearms flat against it at 90° elbows.",
        "Slide the arms up the wall as high as possible, maintaining forearm contact.",
        "Don't shrug — feel the lower trap engage.",
        "Slide back down slowly.",
        "Perform 3 × 10 reps."
      ],
      "videoUrl": null,
      "rationale": "Scapular dyskinesis is a primary source of shoulder impingement in athletes with heavy upper-body volume.",
      "evidence": null
    },
    {
      "name": "External Rotation Band",
      "bodyRegion": "shoulder",
      "category": "strengthen",
      "niggles": ["shoulder"],
      "targetTissue": "infraspinatus / teres minor",
      "primaryMuscles": ["rotator cuff"],
      "muscleText": "Directly loads the external rotators of the rotator cuff — the most commonly understrengthened shoulder muscles in runners.",
      "instructions": [
        "Hold a light resistance band with elbow bent to 90°, upper arm by the side.",
        "Keeping the elbow fixed, rotate the forearm outward.",
        "Return slowly under control.",
        "Perform 3 × 15 reps per arm."
      ],
      "videoUrl": null,
      "rationale": "Weak external rotators are linked to shoulder impingement and poor arm-drive mechanics.",
      "evidence": null
    },
    {
      "name": "Eccentric Heel Drop Bent Knee",
      "bodyRegion": "ankle",
      "category": "strengthen",
      "niggles": ["achilles", "soleus"],
      "targetTissue": "soleus / Achilles tendon",
      "primaryMuscles": ["calves"],
      "muscleText": "Bent-knee version of the heel drop isolates the soleus — the deeper calf muscle that bears the most load during distance running.",
      "instructions": [
        "Same setup as the straight-leg heel drop, but bend the working knee to ~30°.",
        "Rise on both feet, then lower on the single leg with the knee bent.",
        "The bend removes the gastrocnemius and places load directly on the soleus.",
        "Perform 3 × 15 reps per leg."
      ],
      "videoUrl": null,
      "rationale": "The soleus contributes ~6x body weight per step during running — it needs dedicated loading.",
      "evidence": "Alfredson et al. (1998) — bent-knee protocol as the soleus-specific component of the heel drop program."
    },
    {
      "name": "Soleus Calf Raise",
      "bodyRegion": "ankle",
      "category": "strengthen",
      "niggles": ["achilles", "calf"],
      "targetTissue": "soleus",
      "primaryMuscles": ["calves"],
      "muscleText": "Seated or bent-knee calf raise specifically targets the soleus over the gastrocnemius.",
      "instructions": [
        "Sit with a weight on the thighs, feet flat on a slight elevation.",
        "Raise the heels as high as possible.",
        "Lower slowly over 3 seconds.",
        "Alternatively: stand and perform calf raises with a slight knee bend.",
        "Perform 3 × 15–20 reps."
      ],
      "videoUrl": null,
      "rationale": "Soleus hypertrophy reduces per-stride Achilles tendon peak force.",
      "evidence": null
    },
    {
      "name": "Achilles Isometric Load",
      "bodyRegion": "ankle",
      "category": "strengthen",
      "niggles": ["achilles"],
      "targetTissue": "Achilles tendon",
      "primaryMuscles": ["calves"],
      "muscleText": "Isometric calf hold — the most pain-safe loading option when the tendon is acutely irritated. Provides analgesic effect within minutes.",
      "instructions": [
        "Stand on one leg in a calf-raise position (mid-range).",
        "Hold for 45 seconds without moving.",
        "Rest 2 minutes and repeat.",
        "Perform 4–5 holds per leg.",
        "Use as a pain-management tool on high-irritability days before progressing to eccentric loading."
      ],
      "videoUrl": null,
      "rationale": "Isometric tendon loading produces immediate cortical pain inhibition and can be performed on high-pain days.",
      "evidence": "Rio et al. (2015) — isometric exercise reduces tendon pain immediately and improves cortical inhibition."
    }
  ]
  ```

- [ ] **Step 4: Commit**

  ```powershell
  git add src/data/prehab.seed.json
  git commit -m "feat: hand-author prehab seed catalog (30 entries)"
  ```

### 6c — stretch.seed.json

- [ ] **Step 5: Create src/data/stretch.seed.json**

  ```json
  [
    {
      "name": "Forward Leg Swing",
      "type": "dynamic",
      "target": "hip flexors and hamstrings",
      "whenToUse": "pre",
      "duration": "10 reps per side",
      "primaryMuscles": ["hip flexors", "hamstrings"],
      "muscleText": "Swinging the leg forward and back through full hip range — a low-intensity rehearsal of the running stride pattern.",
      "instructions": [
        "Hold a wall or post for balance on the non-swinging side.",
        "Swing the leg forward to hip height, then back behind you.",
        "Let momentum carry the leg — don't force the range.",
        "Perform 10 swings per leg before running or lifting."
      ],
      "videoUrl": null,
      "rationale": "Dynamic warm-up mimicking the hip flexion/extension pattern of running reduces soft-tissue injury risk."
    },
    {
      "name": "Lateral Leg Swing",
      "type": "dynamic",
      "target": "hip abductors and adductors",
      "whenToUse": "pre",
      "duration": "10 reps per side",
      "primaryMuscles": ["hip abductors", "adductors"],
      "muscleText": "Swinging the leg side-to-side opens the frontal-plane hip range that forward-only running rarely uses.",
      "instructions": [
        "Face a wall for balance, hands resting lightly on it.",
        "Swing one leg across the body and then out to the side.",
        "Let momentum carry it — keep the torso still.",
        "Perform 10 swings per leg."
      ],
      "videoUrl": null,
      "rationale": "Frontal-plane hip mobility reduces IT-band and groin strain risk.",
      "evidence": null
    },
    {
      "name": "Hip Circle",
      "type": "dynamic",
      "target": "hip joint",
      "whenToUse": "any",
      "duration": "10 reps each direction per side",
      "primaryMuscles": ["hip flexors", "glutes", "hip rotators"],
      "muscleText": "Full-circle hip rotation lubricates the hip joint and wakes up all surrounding musculature before training.",
      "instructions": [
        "Stand on one leg.",
        "Drive the free knee up, out, back, and down in a large circle.",
        "Perform 10 forward circles, then 10 backward circles.",
        "Switch legs."
      ],
      "videoUrl": null,
      "rationale": "Activates the full hip capsule and surrounding muscles as a general warm-up movement.",
      "evidence": null
    },
    {
      "name": "Ankle Rotation",
      "type": "dynamic",
      "target": "ankle joint",
      "whenToUse": "any",
      "duration": "10 reps each direction per ankle",
      "primaryMuscles": ["calves", "peroneals", "tibialis anterior"],
      "muscleText": "Full-circle ankle rotation mobilises the talocrural joint and activates the surrounding musculature before impact loading.",
      "instructions": [
        "Sit or stand, one foot raised.",
        "Draw large circles with the toes — full range of motion.",
        "10 clockwise, 10 counter-clockwise per ankle."
      ],
      "videoUrl": null,
      "rationale": "Ankle stiffness from inactivity increases Achilles and plantar fascia strain during early running.",
      "evidence": null
    },
    {
      "name": "Dynamic Hip Flexor Lunge",
      "type": "dynamic",
      "target": "hip flexors",
      "whenToUse": "pre",
      "duration": "5 reps per side",
      "primaryMuscles": ["hip flexors", "quads"],
      "muscleText": "A moving lunge that takes the hip flexor through its running range — deeper and more specific than a static lunge stretch before exercise.",
      "instructions": [
        "Step forward into a lunge, lowering the back knee toward the floor.",
        "At the bottom, drive the hips slightly forward and hold for 1 second.",
        "Return to standing and step with the other leg.",
        "Add an arm reach overhead to increase the hip flexor stretch.",
        "Perform 5 reps per side."
      ],
      "videoUrl": null,
      "rationale": "Hip flexor length under movement better prepares the tissue for the dynamic demands of running than static stretching.",
      "evidence": null
    },
    {
      "name": "Arm Circle",
      "type": "dynamic",
      "target": "shoulder joint",
      "whenToUse": "any",
      "duration": "10 reps each direction",
      "primaryMuscles": ["deltoids", "rotator cuff"],
      "muscleText": "Full-range shoulder rotation as a warm-up — particularly useful before upper body lifting or runs with a significant arm-drive component.",
      "instructions": [
        "Stand with arms at sides.",
        "Make large circles forward with both arms simultaneously.",
        "10 forward, then 10 backward.",
        "Keep the neck relaxed."
      ],
      "videoUrl": null,
      "rationale": "Activates the rotator cuff and deltoids before upper-body loading.",
      "evidence": null
    },
    {
      "name": "Walking Knee Hug",
      "type": "dynamic",
      "target": "glutes and hip",
      "whenToUse": "any",
      "duration": "10 steps",
      "primaryMuscles": ["glutes", "hip external rotators"],
      "muscleText": "Stepping while pulling the knee to the chest activates the glutes and hip rotators in a moving pattern.",
      "instructions": [
        "Walk forward.",
        "On each step, pull the forward knee up to the chest with both hands.",
        "Hold briefly, then place the foot down and step to the other leg.",
        "Keep the torso upright.",
        "Perform 10 steps total (5 per leg)."
      ],
      "videoUrl": null,
      "rationale": "Activates glutes and hip external rotators before lower-body work.",
      "evidence": null
    },
    {
      "name": "Scorpion Stretch",
      "type": "dynamic",
      "target": "hip flexors and thoracic spine",
      "whenToUse": "any",
      "duration": "5 reps per side",
      "primaryMuscles": ["hip flexors", "thoracic extensors", "glutes"],
      "muscleText": "Prone rotation drill that opens the thoracic spine and hip flexors simultaneously — good for runners with tight thoracic rotation.",
      "instructions": [
        "Lie face down, arms outstretched.",
        "Lift one foot and reach it across the body toward the opposite hand.",
        "Let the hip rotate — the opposite shoulder stays on the floor.",
        "Return and repeat on the other side.",
        "Perform 5 reps per side."
      ],
      "videoUrl": null,
      "rationale": "Thoracic rotation mobility directly affects arm-drive mechanics and running efficiency.",
      "evidence": null
    },
    {
      "name": "Inchworm",
      "type": "dynamic",
      "target": "hamstrings and core",
      "whenToUse": "pre",
      "duration": "5 reps",
      "primaryMuscles": ["hamstrings", "core", "calves"],
      "muscleText": "Walking the hands out to plank and back in — trains hamstring flexibility under active control and activates the core.",
      "instructions": [
        "Stand with feet hip-width apart.",
        "Hinge forward and place hands on the floor.",
        "Walk hands out to a plank position — keep legs as straight as possible.",
        "Walk the feet back in toward the hands, keeping them straight.",
        "Return to standing.",
        "Perform 5 reps."
      ],
      "videoUrl": null,
      "rationale": "Active hamstring lengthening is more appropriate before exercise than passive static stretching.",
      "evidence": null
    },
    {
      "name": "Lateral Shuffle Warm-Up",
      "type": "dynamic",
      "target": "hip abductors",
      "whenToUse": "pre",
      "duration": "30s",
      "primaryMuscles": ["hip abductors", "glutes"],
      "muscleText": "Low-speed lateral shuffling activates the hip abductors and gets blood into the lateral hip chain before running.",
      "instructions": [
        "Stand with slight knee bend, feet shoulder-width apart.",
        "Shuffle laterally 5–6 steps right, then 5–6 steps left.",
        "Stay low — don't stand up between shuffles.",
        "Perform for 30 seconds."
      ],
      "videoUrl": null,
      "rationale": "Activates glute med and TFL before running — addresses the pattern that often goes cold during desk work.",
      "evidence": null
    },
    {
      "name": "Standing Quad Stretch",
      "type": "static",
      "target": "quadriceps",
      "whenToUse": "post",
      "duration": "30s per side",
      "primaryMuscles": ["quads"],
      "muscleText": "Standard standing quad stretch — holds the knee in full flexion to lengthen the rectus femoris.",
      "instructions": [
        "Stand on one leg, pull the opposite ankle toward the glute.",
        "Keep knees together and stand tall — don't lean forward.",
        "Hold 30 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Post-run static stretching restores resting muscle length reduced by repeated eccentric loading.",
      "evidence": null
    },
    {
      "name": "Pigeon Pose",
      "type": "static",
      "target": "glutes and hip flexors",
      "whenToUse": "recovery",
      "duration": "60s per side",
      "primaryMuscles": ["glutes", "hip external rotators", "hip flexors"],
      "muscleText": "The most effective static stretch for the gluteus maximus and external rotators — essential after any lower-body session.",
      "instructions": [
        "From a plank, bring one knee forward toward the same-side wrist.",
        "Lower the shin to the floor at an angle, rear leg extended back.",
        "Lower the torso over the front shin.",
        "Hold 60 seconds and breathe deeply.",
        "Repeat on the other side."
      ],
      "videoUrl": null,
      "rationale": "Hip external rotator tightness contributes to IT-band tension and reduced stride length.",
      "evidence": null
    },
    {
      "name": "Seated Hamstring Stretch",
      "type": "static",
      "target": "hamstrings",
      "whenToUse": "recovery",
      "duration": "45s per side",
      "primaryMuscles": ["hamstrings"],
      "muscleText": "Seated single-leg forward fold — isolates hamstring extensibility without compressing the lower back.",
      "instructions": [
        "Sit with one leg extended, the other bent with the foot against the inner thigh.",
        "Hinge at the hip and reach toward the extended foot.",
        "Keep the back flat — don't round the spine to reach further.",
        "Hold 45 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Hamstring tightness restricts hip extension during running push-off.",
      "evidence": null
    },
    {
      "name": "Standing Calf Stretch",
      "type": "static",
      "target": "gastrocnemius",
      "whenToUse": "post",
      "duration": "30s per side",
      "primaryMuscles": ["calves"],
      "muscleText": "Straight-leg calf stretch against a wall — targets the gastrocnemius (the two-joint head of the calf).",
      "instructions": [
        "Stand facing a wall, both hands on it.",
        "Step one foot back with the heel flat on the floor.",
        "Keep the back leg straight and lean forward until a stretch is felt in the calf.",
        "Hold 30 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Calf tightness restricts dorsiflexion and increases Achilles and plantar fascia load.",
      "evidence": null
    },
    {
      "name": "Hip Flexor Lunge Stretch",
      "type": "static",
      "target": "hip flexors",
      "whenToUse": "recovery",
      "duration": "45s per side",
      "primaryMuscles": ["hip flexors", "quads"],
      "muscleText": "Low lunge with back knee on the floor — the foundational hip flexor stretch for runners.",
      "instructions": [
        "Kneel on one knee, the other foot forward.",
        "Shift the hips forward until a stretch is felt in the front of the back hip.",
        "Squeeze the glute of the back leg to deepen the stretch.",
        "Hold 45 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Hip flexor length directly affects pelvic tilt and lumbar load during running.",
      "evidence": null
    },
    {
      "name": "Doorframe Chest Stretch",
      "type": "static",
      "target": "chest and anterior shoulder",
      "whenToUse": "recovery",
      "duration": "30s per side",
      "primaryMuscles": ["pectorals", "anterior deltoid"],
      "muscleText": "Stretches the anterior chest and shoulder — counteracts the forward posture developed from running arm-drive and desk work.",
      "instructions": [
        "Stand in a doorway, one arm at 90° with the forearm against the frame.",
        "Lean forward through the doorway until a stretch is felt across the chest.",
        "Hold 30 seconds and repeat on the other side."
      ],
      "videoUrl": null,
      "rationale": "Anterior chest tightness restricts arm swing and forces excessive trunk rotation in runners.",
      "evidence": null
    },
    {
      "name": "Cross-Body Shoulder Stretch",
      "type": "static",
      "target": "posterior shoulder",
      "whenToUse": "recovery",
      "duration": "30s per side",
      "primaryMuscles": ["posterior deltoid", "infraspinatus"],
      "muscleText": "Pulls the arm horizontally across the body to stretch the posterior capsule of the shoulder joint.",
      "instructions": [
        "Bring one arm straight across the body at shoulder height.",
        "Hook the opposite arm under it and pull gently toward the chest.",
        "Hold 30 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Posterior shoulder tightness is common in overhead athletes and those with heavy upper-body volume.",
      "evidence": null
    },
    {
      "name": "Seated IT-Band Stretch",
      "type": "static",
      "target": "IT band and lateral hip",
      "whenToUse": "recovery",
      "duration": "45s per side",
      "primaryMuscles": ["TFL", "hip abductors"],
      "muscleText": "Seated spinal twist with the crossed leg pulled across — a gentler IT-band stretch than the standing version.",
      "instructions": [
        "Sit with one leg extended, cross the other foot over to the outside of the extended knee.",
        "Twist toward the bent leg, using the opposite arm against the knee as a lever.",
        "Hold 45 seconds per side."
      ],
      "videoUrl": null,
      "rationale": "Post-run IT-band stretching reduces residual tightness before the next session.",
      "evidence": null
    },
    {
      "name": "Supine Spinal Twist",
      "type": "static",
      "target": "low-back and thoracic spine",
      "whenToUse": "recovery",
      "duration": "30s per side",
      "primaryMuscles": ["spinal rotators", "glutes"],
      "muscleText": "Lying twist decompresses the lumbar spine and restores thoracic rotation after a long run or lift.",
      "instructions": [
        "Lie on your back with knees bent.",
        "Let both knees fall to one side, keeping shoulders flat on the floor.",
        "Extend arms to the sides for stability.",
        "Hold 30 seconds and switch sides."
      ],
      "videoUrl": null,
      "rationale": "Spinal rotation mobility maintains lumbar decompression and thoracic mobility between sessions.",
      "evidence": null
    },
    {
      "name": "Child's Pose",
      "type": "static",
      "target": "low-back and lats",
      "whenToUse": "recovery",
      "duration": "60s",
      "primaryMuscles": ["spinal extensors", "lats", "glutes"],
      "muscleText": "Passive spinal unloading in full hip flexion — the most restorative end-of-session stretch for the posterior chain.",
      "instructions": [
        "Kneel and sit back onto the heels.",
        "Reach arms forward on the floor and lower the forehead down.",
        "Breathe deeply — let the lower back expand on each inhale.",
        "Hold 60 seconds."
      ],
      "videoUrl": null,
      "rationale": "Passively decompresses lumbar vertebrae and restores resting length in the erector spinae after loading.",
      "evidence": null
    }
  ]
  ```

- [ ] **Step 6: Commit**

  ```powershell
  git add src/data/stretch.seed.json
  git commit -m "feat: hand-author stretch seed catalog (20 entries)"
  ```

---

## Task 7: slugify + mergeExerciseRows Utilities

**Files:**
- Create: `src/lib/seed-utils.ts`
- Create: `src/__tests__/lib/seed-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/__tests__/lib/seed-utils.test.ts`:

  ```typescript
  import { slugify, mergeExerciseRows, ExerciseRow } from '@/lib/seed-utils';

  describe('slugify', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(slugify('Romanian Deadlift')).toBe('romanian-deadlift');
    });

    it("strips apostrophes and punctuation", () => {
      expect(slugify("Farmer's Walk")).toBe('farmers-walk');
    });

    it('collapses multiple spaces', () => {
      expect(slugify('Bench  Press')).toBe('bench-press');
    });

    it('strips parentheses and slashes', () => {
      expect(slugify('3/4 Sit-Up (Weighted)')).toBe('34-sit-up-weighted');
    });

    it('preserves existing hyphens', () => {
      expect(slugify('pull-up')).toBe('pull-up');
    });
  });

  const exerciseDbRow: ExerciseRow = {
    slug: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    gifUrl: 'https://example.com/rdl.gif',
    images: [],
    bodyPart: 'upper legs',
    category: null,
    equipment: ['barbell'],
    level: null,
    mechanic: null,
    force: null,
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['glutes'],
    instructions: ['Stand with feet shoulder-width.', 'Hinge at hips.'],
    source: 'exercisedb',
  };

  const freeDbRow: ExerciseRow = {
    slug: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    gifUrl: null,
    images: ['https://example.com/rdl1.jpg'],
    bodyPart: 'upper legs',
    category: 'strength',
    equipment: ['barbell'],
    level: 'intermediate',
    mechanic: 'compound',
    force: 'pull',
    primaryMuscles: ['hamstrings'],
    secondaryMuscles: ['lower back'],
    instructions: ['Different instructions.'],
    source: 'free-exercise-db',
  };

  describe('mergeExerciseRows', () => {
    it('prefers exercisedb gifUrl', () => {
      expect(mergeExerciseRows([exerciseDbRow, freeDbRow]).gifUrl).toBe('https://example.com/rdl.gif');
    });

    it('prefers free-exercise-db images', () => {
      expect(mergeExerciseRows([exerciseDbRow, freeDbRow]).images).toEqual(['https://example.com/rdl1.jpg']);
    });

    it('prefers free-exercise-db level, mechanic, force, category', () => {
      const m = mergeExerciseRows([exerciseDbRow, freeDbRow]);
      expect(m.level).toBe('intermediate');
      expect(m.mechanic).toBe('compound');
      expect(m.force).toBe('pull');
      expect(m.category).toBe('strength');
    });

    it('prefers exercisedb instructions', () => {
      expect(mergeExerciseRows([exerciseDbRow, freeDbRow]).instructions).toEqual([
        'Stand with feet shoulder-width.',
        'Hinge at hips.',
      ]);
    });

    it('unions muscles without duplicates', () => {
      const m = mergeExerciseRows([exerciseDbRow, freeDbRow]);
      expect(m.primaryMuscles).toEqual(['hamstrings']);
      expect(m.secondaryMuscles).toContain('glutes');
      expect(m.secondaryMuscles).toContain('lower back');
    });

    it('joins source strings', () => {
      expect(mergeExerciseRows([exerciseDbRow, freeDbRow]).source).toBe('exercisedb+free-exercise-db');
    });

    it('handles a single row without modification', () => {
      const m = mergeExerciseRows([exerciseDbRow]);
      expect(m.source).toBe('exercisedb');
      expect(m.gifUrl).toBe('https://example.com/rdl.gif');
    });
  });
  ```

- [ ] **Step 2: Run to confirm failure**

  ```powershell
  npx jest src/__tests__/lib/seed-utils.test.ts --no-coverage
  ```

  Expected: FAIL — `Cannot find module '@/lib/seed-utils'`

- [ ] **Step 3: Write the implementation**

  Create `src/lib/seed-utils.ts`:

  ```typescript
  export function slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();
  }

  export interface ExerciseRow {
    slug: string;
    name: string;
    gifUrl: string | null;
    images: string[];
    bodyPart: string | null;
    category: string | null;
    equipment: string[];
    level: string | null;
    mechanic: string | null;
    force: string | null;
    primaryMuscles: string[];
    secondaryMuscles: string[];
    instructions: string[];
    source: string;
  }

  export function mergeExerciseRows(rows: ExerciseRow[]): ExerciseRow {
    const edb = rows.find(r => r.source === 'exercisedb');
    const fed = rows.find(r => r.source === 'free-exercise-db');
    const base = edb ?? fed ?? rows[0];

    const sources = [...new Set(rows.map(r => r.source))].join('+');
    const primaryMuscles = [...new Set(rows.flatMap(r => r.primaryMuscles))];
    const secondaryMuscles = [...new Set(rows.flatMap(r => r.secondaryMuscles))];

    return {
      slug: base.slug,
      name: base.name,
      gifUrl: edb?.gifUrl ?? fed?.gifUrl ?? base.gifUrl,
      images: fed?.images?.length ? fed.images : (base.images ?? []),
      bodyPart: base.bodyPart,
      category: fed?.category ?? base.category,
      equipment: base.equipment,
      level: fed?.level ?? base.level,
      mechanic: fed?.mechanic ?? base.mechanic,
      force: fed?.force ?? base.force,
      primaryMuscles,
      secondaryMuscles,
      instructions: edb?.instructions?.length ? edb.instructions : base.instructions,
      source: sources,
    };
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```powershell
  npx jest src/__tests__/lib/seed-utils.test.ts --no-coverage
  ```

  Expected:
  ```
  PASS src/__tests__/lib/seed-utils.test.ts
    slugify
      ✓ lowercases and replaces spaces with hyphens
      ✓ strips apostrophes and punctuation
      ✓ collapses multiple spaces
      ✓ strips parentheses and slashes
      ✓ preserves existing hyphens
    mergeExerciseRows
      ✓ prefers exercisedb gifUrl
      ✓ prefers free-exercise-db images
      ✓ prefers free-exercise-db level, mechanic, force, category
      ✓ prefers exercisedb instructions
      ✓ unions muscles without duplicates
      ✓ joins source strings
      ✓ handles a single row without modification

  Test Suites: 1 passed, 1 total
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add src/lib/seed-utils.ts src/__tests__/lib/seed-utils.test.ts
  git commit -m "feat: add slugify and mergeExerciseRows utilities"
  ```

---

## Task 8: ExerciseDB Field-Mapping Adapter

**Files:**
- Create: `src/data/exercises.seed.ts`

- [ ] **Step 1: Write the adapter**

  Create `src/data/exercises.seed.ts`:

  ```typescript
  import { ExerciseRow, slugify } from '../lib/seed-utils';

  export interface ExerciseDbRecord {
    id: string;
    name: string;
    gifUrl: string;
    bodyPart: string;
    target: string;
    secondaryMuscles: string[];
    equipment: string;
    instructions: string[];
  }

  function stripStepPrefix(instruction: string): string {
    return instruction.replace(/^Step \d+:\s*/i, '').trim();
  }

  export function mapExerciseDbRecord(record: ExerciseDbRecord): ExerciseRow {
    return {
      slug: slugify(record.name),
      name: record.name,
      gifUrl: record.gifUrl || null,
      images: [],
      bodyPart: record.bodyPart || null,
      category: null,
      equipment: record.equipment ? [record.equipment] : [],
      level: null,
      mechanic: null,
      force: null,
      primaryMuscles: record.target ? [record.target] : [],
      secondaryMuscles: record.secondaryMuscles ?? [],
      instructions: (record.instructions ?? []).map(stripStepPrefix),
      source: 'exercisedb',
    };
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```powershell
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```powershell
  git add src/data/exercises.seed.ts
  git commit -m "feat: ExerciseDB field-mapping adapter"
  ```

---

## Task 9: Full Seed Script

**Files:**
- Create: `scripts/seed.ts`

Before running the seed, the user must:
1. Download the ExerciseDB dataset from Kaggle and place the JSON at `scripts/data/exercisedb.json`
2. Clone free-exercise-db: `git clone https://github.com/yuhonas/free-exercise-db.git scripts/data/free-exercise-db`

- [ ] **Step 1: Write scripts/seed.ts**

  Create `scripts/seed.ts`:

  ```typescript
  // wger data licensed CC-BY-SA. Attribution: wger Workout Manager (wger.de)
  import path from 'path';
  import fs from 'fs';
  import { PrismaClient } from '@prisma/client';
  import { slugify, mergeExerciseRows, ExerciseRow } from '../src/lib/seed-utils';
  import { mapExerciseDbRecord, ExerciseDbRecord } from '../src/data/exercises.seed';

  const prisma = new PrismaClient();
  const DATA = path.join(__dirname, 'data');

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function j(value: unknown): string {
    return JSON.stringify(value ?? []);
  }

  function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  function rowToPrisma(row: ExerciseRow) {
    return {
      name: row.name,
      slug: row.slug,
      gifUrl: row.gifUrl,
      images: j(row.images),
      bodyPart: row.bodyPart,
      category: row.category,
      equipment: j(row.equipment),
      level: row.level,
      mechanic: row.mechanic,
      force: row.force,
      primaryMuscles: j(row.primaryMuscles),
      secondaryMuscles: j(row.secondaryMuscles),
      instructions: j(row.instructions),
      source: row.source,
    };
  }

  // ─── Step 1: ExerciseDB ───────────────────────────────────────────────────────

  async function seedExerciseDb(): Promise<number> {
    const filePath = path.join(DATA, 'exercisedb.json');
    if (!fs.existsSync(filePath)) {
      console.warn('  ⚠ scripts/data/exercisedb.json not found — skipping ExerciseDB step.');
      console.warn('    Download from Kaggle and place at scripts/data/exercisedb.json');
      return 0;
    }

    const raw: ExerciseDbRecord[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`  ExerciseDB: ${raw.length} records read`);

    let count = 0;
    for (const record of raw) {
      const row = mapExerciseDbRecord(record);
      await prisma.exerciseLibrary.upsert({
        where: { slug: row.slug },
        create: rowToPrisma(row),
        update: {},
      });
      count++;
    }

    console.log(`  ExerciseDB: ${count} upserted`);
    return count;
  }

  // ─── Step 2: free-exercise-db ─────────────────────────────────────────────────

  interface FreeExerciseRecord {
    name: string;
    force?: string | null;
    level?: string;
    mechanic?: string | null;
    equipment?: string | null;
    primaryMuscles?: string[];
    secondaryMuscles?: string[];
    instructions?: string[];
    category?: string;
    images?: string[];
  }

  async function seedFreeExerciseDb(): Promise<{ enriched: number; inserted: number }> {
    const distPath = path.join(DATA, 'free-exercise-db', 'dist', 'exercises.json');
    if (!fs.existsSync(distPath)) {
      console.warn('  ⚠ scripts/data/free-exercise-db/dist/exercises.json not found — skipping.');
      console.warn('    Run: git clone https://github.com/yuhonas/free-exercise-db.git scripts/data/free-exercise-db');
      return { enriched: 0, inserted: 0 };
    }

    const raw: FreeExerciseRecord[] = JSON.parse(fs.readFileSync(distPath, 'utf-8'));
    console.log(`  free-exercise-db: ${raw.length} records read`);

    let enriched = 0;
    let inserted = 0;

    for (const record of raw) {
      if (!record.name) continue;
      const slug = slugify(record.name);
      const existing = await prisma.exerciseLibrary.findUnique({ where: { slug } });

      if (existing) {
        // Enrich: fill in missing fields only — don't overwrite ExerciseDB data
        await prisma.exerciseLibrary.update({
          where: { slug },
          data: {
            level: existing.level ?? record.level ?? null,
            mechanic: existing.mechanic ?? record.mechanic ?? null,
            force: existing.force ?? record.force ?? null,
            category: existing.category ?? record.category ?? null,
            images: existing.images === '[]' && record.images?.length
              ? j(record.images)
              : existing.images,
          },
        });
        enriched++;
      } else {
        const fedRow: ExerciseRow = {
          slug,
          name: record.name,
          gifUrl: null,
          images: record.images ?? [],
          bodyPart: null,
          category: record.category ?? null,
          equipment: record.equipment ? [record.equipment] : [],
          level: record.level ?? null,
          mechanic: record.mechanic ?? null,
          force: record.force ?? null,
          primaryMuscles: record.primaryMuscles ?? [],
          secondaryMuscles: record.secondaryMuscles ?? [],
          instructions: record.instructions ?? [],
          source: 'free-exercise-db',
        };
        await prisma.exerciseLibrary.upsert({
          where: { slug },
          create: rowToPrisma(fedRow),
          update: {},
        });
        inserted++;
      }
    }

    console.log(`  free-exercise-db: ${enriched} enriched, ${inserted} new`);
    return { enriched, inserted };
  }

  // ─── Step 3: wger ─────────────────────────────────────────────────────────────

  interface WgerExercise {
    name: string;
    description: string;
    muscles: { name_en: string }[];
    muscles_secondary: { name_en: string }[];
    equipment: { name: string }[];
    category: { name: string };
  }

  interface WgerResponse {
    count: number;
    next: string | null;
    results: WgerExercise[];
  }

  async function seedWger(): Promise<number> {
    console.log('  wger: fetching...');
    let url: string | null = 'https://wger.de/api/v2/exercise/?format=json&language=2&limit=100';
    let inserted = 0;

    while (url) {
      let data: WgerResponse;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json() as WgerResponse;
      } catch (err) {
        console.warn(`  ⚠ wger fetch failed (${err}) — stopping wger step.`);
        break;
      }

      for (const ex of data.results) {
        if (!ex.name) continue;
        const slug = slugify(ex.name);
        const existing = await prisma.exerciseLibrary.findUnique({ where: { slug } });
        if (existing) continue;

        const row: ExerciseRow = {
          slug,
          name: ex.name,
          gifUrl: null,
          images: [],
          bodyPart: null,
          category: ex.category?.name ?? null,
          equipment: ex.equipment?.map(e => e.name) ?? [],
          level: null,
          mechanic: null,
          force: null,
          primaryMuscles: ex.muscles?.map(m => m.name_en) ?? [],
          secondaryMuscles: ex.muscles_secondary?.map(m => m.name_en) ?? [],
          instructions: ex.description ? [stripHtml(ex.description)] : [],
          source: 'wger',
        };
        await prisma.exerciseLibrary.upsert({
          where: { slug },
          create: rowToPrisma(row),
          update: {},
        });
        inserted++;
      }

      url = data.next;
    }

    console.log(`  wger: ${inserted} new exercises inserted`);
    return inserted;
  }

  // ─── Step 4: Deduplication ────────────────────────────────────────────────────

  async function dedup(): Promise<number> {
    const all = await prisma.exerciseLibrary.findMany();
    const bySlug = new Map<string, typeof all>();

    for (const row of all) {
      const existing = bySlug.get(row.slug) ?? [];
      existing.push(row);
      bySlug.set(row.slug, existing);
    }

    let mergedCount = 0;

    for (const [slug, rows] of bySlug.entries()) {
      if (rows.length <= 1) continue;

      const exerciseRows: ExerciseRow[] = rows.map(r => ({
        slug: r.slug,
        name: r.name,
        gifUrl: r.gifUrl,
        images: JSON.parse(r.images),
        bodyPart: r.bodyPart,
        category: r.category,
        equipment: JSON.parse(r.equipment),
        level: r.level,
        mechanic: r.mechanic,
        force: r.force,
        primaryMuscles: JSON.parse(r.primaryMuscles),
        secondaryMuscles: JSON.parse(r.secondaryMuscles),
        instructions: JSON.parse(r.instructions),
        source: r.source,
      }));

      const merged = mergeExerciseRows(exerciseRows);
      const keepId = rows[0].id;
      const deleteIds = rows.slice(1).map(r => r.id);

      await prisma.$transaction([
        prisma.exerciseLibrary.update({
          where: { id: keepId },
          data: rowToPrisma(merged),
        }),
        prisma.exerciseLibrary.deleteMany({
          where: { id: { in: deleteIds } },
        }),
      ]);

      mergedCount++;
    }

    console.log(`  Dedup: ${mergedCount} groups merged`);
    return mergedCount;
  }

  // ─── Step 5: Plyo / Prehab / Stretch ─────────────────────────────────────────

  async function seedPlyo(): Promise<number> {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../src/data/plyos.seed.json'), 'utf-8')
    );
    for (const entry of raw) {
      await prisma.plyoLibrary.upsert({
        where: { name: entry.name },
        create: {
          name: entry.name,
          intensity: entry.intensity,
          contactLoad: entry.contactLoad,
          progressionTier: entry.progressionTier,
          prerequisites: j(entry.prerequisites ?? []),
          target: entry.target ?? null,
          primaryMuscles: j(entry.primaryMuscles ?? []),
          muscleText: entry.muscleText ?? null,
          instructions: j(entry.instructions ?? []),
          videoUrl: entry.videoUrl ?? null,
          rationale: entry.rationale ?? null,
          evidence: entry.evidence ?? null,
        },
        update: {},
      });
    }
    console.log(`  Plyo: ${raw.length} upserted`);
    return raw.length;
  }

  async function seedPrehab(): Promise<number> {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../src/data/prehab.seed.json'), 'utf-8')
    );
    for (const entry of raw) {
      await prisma.prehabLibrary.upsert({
        where: { name: entry.name },
        create: {
          name: entry.name,
          bodyRegion: entry.bodyRegion,
          category: entry.category,
          niggles: j(entry.niggles ?? []),
          targetTissue: entry.targetTissue ?? null,
          primaryMuscles: j(entry.primaryMuscles ?? []),
          muscleText: entry.muscleText ?? null,
          instructions: j(entry.instructions ?? []),
          videoUrl: entry.videoUrl ?? null,
          rationale: entry.rationale ?? null,
          evidence: entry.evidence ?? null,
        },
        update: {},
      });
    }
    console.log(`  Prehab: ${raw.length} upserted`);
    return raw.length;
  }

  async function seedStretch(): Promise<number> {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../src/data/stretch.seed.json'), 'utf-8')
    );
    for (const entry of raw) {
      await prisma.stretchLibrary.upsert({
        where: { name: entry.name },
        create: {
          name: entry.name,
          type: entry.type,
          target: entry.target ?? null,
          whenToUse: entry.whenToUse,
          duration: entry.duration ?? null,
          primaryMuscles: j(entry.primaryMuscles ?? []),
          muscleText: entry.muscleText ?? null,
          instructions: j(entry.instructions ?? []),
          videoUrl: entry.videoUrl ?? null,
          rationale: entry.rationale ?? null,
        },
        update: {},
      });
    }
    console.log(`  Stretch: ${raw.length} upserted`);
    return raw.length;
  }

  // ─── Main ─────────────────────────────────────────────────────────────────────

  async function main() {
    console.log('Starting seed...\n');

    console.log('Step 1/5 — ExerciseDB');
    await seedExerciseDb();

    console.log('\nStep 2/5 — free-exercise-db');
    await seedFreeExerciseDb();

    console.log('\nStep 3/5 — wger');
    await seedWger();

    console.log('\nStep 4/5 — Deduplication');
    const mergedCount = await dedup();

    console.log('\nStep 5/5 — Plyo / Prehab / Stretch');
    const plyoCount = await seedPlyo();
    const prehabCount = await seedPrehab();
    const stretchCount = await seedStretch();

    const total = await prisma.exerciseLibrary.count();
    console.log(`
─────────────────────────────────
Seed complete
  Exercises in library : ${total} (${mergedCount} duplicates merged)
  Plyo entries         : ${plyoCount}
  Prehab entries       : ${prehabCount}
  Stretch entries      : ${stretchCount}
─────────────────────────────────`);
  }

  main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
  ```

- [ ] **Step 2: Add seed script to package.json**

  Open `package.json` and add to the `"scripts"` block:

  ```json
  "seed": "tsx scripts/seed.ts"
  ```

- [ ] **Step 3: Dry-run seed (no data files yet — should warn and skip gracefully)**

  ```powershell
  npm run seed
  ```

  Expected output (with no data files present):
  ```
  Starting seed...

  Step 1/5 — ExerciseDB
    ⚠ scripts/data/exercisedb.json not found — skipping ExerciseDB step.
      Download from Kaggle and place at scripts/data/exercisedb.json

  Step 2/5 — free-exercise-db
    ⚠ scripts/data/free-exercise-db/dist/exercises.json not found — skipping.
      Run: git clone https://github.com/yuhonas/free-exercise-db.git scripts/data/free-exercise-db

  Step 3/5 — wger
    wger: fetching...
    wger: N new exercises inserted

  Step 4/5 — Deduplication
    Dedup: 0 groups merged

  Step 5/5 — Plyo / Prehab / Stretch
    Plyo: 25 upserted
    Prehab: 30 upserted
    Stretch: 20 upserted

  ─────────────────────────────────
  Seed complete
    Exercises in library : N (0 duplicates merged)
    Plyo entries         : 25
    Prehab entries       : 30
    Stretch entries      : 20
  ─────────────────────────────────
  ```

- [ ] **Step 4: Commit**

  ```powershell
  git add scripts/seed.ts package.json
  git commit -m "feat: full seed script — ExerciseDB + free-exercise-db + wger + dedup + plyo/prehab/stretch"
  ```

---

## Task 10: /api/library Route

**Files:**
- Create: `src/app/api/library/route.ts`
- Create: `src/__tests__/api/library.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/__tests__/api/library.test.ts`:

  ```typescript
  import { GET } from '@/app/api/library/route';

  jest.mock('@/lib/db', () => ({
    prisma: {
      exerciseLibrary: { findMany: jest.fn() },
      plyoLibrary: { findMany: jest.fn() },
      prehabLibrary: { findMany: jest.fn() },
      stretchLibrary: { findMany: jest.fn() },
    },
    parseJson: <T>(value: string | null | undefined, fallback?: T): T => {
      if (value === null || value === undefined || value === '') {
        return (fallback !== undefined ? fallback : []) as T;
      }
      return JSON.parse(value) as T;
    },
  }));

  import { prisma } from '@/lib/db';

  describe('GET /api/library', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns 400 when type param is missing', async () => {
      const req = new Request('http://localhost/api/library');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for an unrecognised type', async () => {
      const req = new Request('http://localhost/api/library?type=cardio');
      const res = await GET(req);
      expect(res.status).toBe(400);
    });

    it('returns plyo entries with parsed array fields', async () => {
      (prisma.plyoLibrary.findMany as jest.Mock).mockResolvedValue([
        {
          id: '1', name: 'Pogos', intensity: 'low', contactLoad: 'low',
          progressionTier: 0, prerequisites: '[]', target: null,
          primaryMuscles: '["calves","achilles tendon"]',
          muscleText: null, instructions: '["Bounce on feet"]',
          videoUrl: null, rationale: null, evidence: null,
        },
      ]);

      const req = new Request('http://localhost/api/library?type=plyo');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('Pogos');
      expect(data[0].primaryMuscles).toEqual(['calves', 'achilles tendon']);
      expect(data[0].instructions).toEqual(['Bounce on feet']);
    });

    it('passes tier filter to Prisma as an integer', async () => {
      (prisma.plyoLibrary.findMany as jest.Mock).mockResolvedValue([]);
      const req = new Request('http://localhost/api/library?type=plyo&tier=0');
      await GET(req);
      expect(prisma.plyoLibrary.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ progressionTier: 0 }),
        })
      );
    });

    it('passes bodyRegion filter for prehab', async () => {
      (prisma.prehabLibrary.findMany as jest.Mock).mockResolvedValue([]);
      const req = new Request('http://localhost/api/library?type=prehab&bodyRegion=knee');
      await GET(req);
      expect(prisma.prehabLibrary.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ bodyRegion: 'knee' }),
        })
      );
    });

    it('passes stretchType as the type field for stretch', async () => {
      (prisma.stretchLibrary.findMany as jest.Mock).mockResolvedValue([]);
      const req = new Request('http://localhost/api/library?type=stretch&stretchType=dynamic');
      await GET(req);
      expect(prisma.stretchLibrary.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'dynamic' }),
        })
      );
    });
  });
  ```

- [ ] **Step 2: Run to confirm failure**

  ```powershell
  npx jest src/__tests__/api/library.test.ts --no-coverage
  ```

  Expected: FAIL — `Cannot find module '@/app/api/library/route'`

- [ ] **Step 3: Write the route handler**

  Create `src/app/api/library/route.ts`:

  ```typescript
  import { NextResponse } from 'next/server';
  import { prisma, parseJson } from '@/lib/db';
  import type { ExerciseEntry, PlyoEntry, PrehabEntry, StretchEntry } from '@/lib/types';

  const VALID_TYPES = ['strength', 'plyo', 'prehab', 'stretch'];

  export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: 'type must be strength | plyo | prehab | stretch' },
        { status: 400 }
      );
    }

    if (type === 'strength') {
      const muscle = searchParams.get('muscle');
      const equipment = searchParams.get('equipment');
      const level = searchParams.get('level');

      const rows = await prisma.exerciseLibrary.findMany({
        where: {
          ...(level ? { level } : {}),
          ...(equipment ? { equipment: { contains: equipment } } : {}),
        },
        orderBy: { name: 'asc' },
      });

      const data: ExerciseEntry[] = rows
        .filter(r => !muscle || parseJson<string[]>(r.primaryMuscles).includes(muscle))
        .map(r => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          gifUrl: r.gifUrl,
          images: parseJson<string[]>(r.images),
          bodyPart: r.bodyPart,
          category: r.category,
          equipment: parseJson<string[]>(r.equipment),
          level: r.level,
          mechanic: r.mechanic,
          force: r.force,
          primaryMuscles: parseJson<string[]>(r.primaryMuscles),
          secondaryMuscles: parseJson<string[]>(r.secondaryMuscles),
          muscleText: r.muscleText,
          instructions: parseJson<string[]>(r.instructions),
          rationale: r.rationale,
          evidence: r.evidence,
          source: r.source,
        }));

      return NextResponse.json(data);
    }

    if (type === 'plyo') {
      const tier = searchParams.get('tier');
      const intensity = searchParams.get('intensity');

      const rows = await prisma.plyoLibrary.findMany({
        where: {
          ...(tier !== null ? { progressionTier: parseInt(tier, 10) } : {}),
          ...(intensity ? { intensity } : {}),
        },
        orderBy: [{ progressionTier: 'asc' }, { name: 'asc' }],
      });

      const data: PlyoEntry[] = rows.map(r => ({
        id: r.id,
        name: r.name,
        intensity: r.intensity as PlyoEntry['intensity'],
        contactLoad: r.contactLoad as PlyoEntry['contactLoad'],
        progressionTier: r.progressionTier as PlyoEntry['progressionTier'],
        prerequisites: parseJson<string[]>(r.prerequisites),
        target: r.target,
        primaryMuscles: parseJson<string[]>(r.primaryMuscles),
        muscleText: r.muscleText,
        instructions: parseJson<string[]>(r.instructions),
        videoUrl: r.videoUrl,
        rationale: r.rationale,
        evidence: r.evidence,
      }));

      return NextResponse.json(data);
    }

    if (type === 'prehab') {
      const bodyRegion = searchParams.get('bodyRegion');
      const category = searchParams.get('category');

      const rows = await prisma.prehabLibrary.findMany({
        where: {
          ...(bodyRegion ? { bodyRegion } : {}),
          ...(category ? { category } : {}),
        },
        orderBy: [{ bodyRegion: 'asc' }, { name: 'asc' }],
      });

      const data: PrehabEntry[] = rows.map(r => ({
        id: r.id,
        name: r.name,
        bodyRegion: r.bodyRegion as PrehabEntry['bodyRegion'],
        category: r.category as PrehabEntry['category'],
        niggles: parseJson<string[]>(r.niggles),
        targetTissue: r.targetTissue,
        primaryMuscles: parseJson<string[]>(r.primaryMuscles),
        muscleText: r.muscleText,
        instructions: parseJson<string[]>(r.instructions),
        videoUrl: r.videoUrl,
        rationale: r.rationale,
        evidence: r.evidence,
      }));

      return NextResponse.json(data);
    }

    // type === 'stretch'
    const stretchType = searchParams.get('stretchType');
    const whenToUse = searchParams.get('whenToUse');

    const rows = await prisma.stretchLibrary.findMany({
      where: {
        ...(stretchType ? { type: stretchType } : {}),
        ...(whenToUse ? { whenToUse } : {}),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    const data: StretchEntry[] = rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type as StretchEntry['type'],
      target: r.target,
      whenToUse: r.whenToUse as StretchEntry['whenToUse'],
      duration: r.duration,
      primaryMuscles: parseJson<string[]>(r.primaryMuscles),
      muscleText: r.muscleText,
      instructions: parseJson<string[]>(r.instructions),
      videoUrl: r.videoUrl,
      rationale: r.rationale,
    }));

    return NextResponse.json(data);
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```powershell
  npx jest src/__tests__/api/library.test.ts --no-coverage
  ```

  Expected:
  ```
  PASS src/__tests__/api/library.test.ts
    GET /api/library
      ✓ returns 400 when type param is missing
      ✓ returns 400 for an unrecognised type
      ✓ returns plyo entries with parsed array fields
      ✓ passes tier filter to Prisma as an integer
      ✓ passes bodyRegion filter for prehab
      ✓ passes stretchType as the type field for stretch

  Test Suites: 1 passed, 1 total
  ```

- [ ] **Step 5: Commit**

  ```powershell
  git add src/app/api/library/route.ts src/__tests__/api/library.test.ts
  git commit -m "feat: /api/library route — strength, plyo, prehab, stretch"
  ```

---

## Task 11: ExerciseCard Component

**Files:**
- Create: `src/components/ExerciseCard.tsx`
- Create: `src/__tests__/components/ExerciseCard.test.tsx`

- [ ] **Step 1: Install testing dependencies (if not already present)**

  ```powershell
  npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jest-environment-jsdom
  ```

  Then open `jest.config.ts` and add the setup file:
  ```typescript
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  ```

  Create `jest.setup.ts` at the project root:
  ```typescript
  import '@testing-library/jest-dom';
  ```

- [ ] **Step 2: Write the failing test**

  Create `src/__tests__/components/ExerciseCard.test.tsx`:

  ```tsx
  /**
   * @jest-environment jsdom
   */
  import React from 'react';
  import { render, screen, fireEvent } from '@testing-library/react';
  import ExerciseCard from '@/components/ExerciseCard';
  import type { ExerciseEntry } from '@/lib/types';

  const mockExercise: ExerciseEntry = {
    id: '1',
    name: 'Romanian Deadlift',
    slug: 'romanian-deadlift',
    gifUrl: null,
    images: [],
    bodyPart: 'upper legs',
    category: 'strength',
    equipment: ['barbell'],
    level: 'intermediate',
    mechanic: 'compound',
    force: 'pull',
    primaryMuscles: ['hamstrings', 'glutes'],
    secondaryMuscles: ['lower back'],
    muscleText: 'Core posterior chain movement.',
    instructions: ['Stand with feet shoulder-width.', 'Hinge at the hips.'],
    rationale: 'Builds the posterior chain.',
    evidence: null,
    source: 'exercisedb',
  };

  describe('ExerciseCard', () => {
    it('renders the exercise name', () => {
      render(<ExerciseCard entry={mockExercise} type="strength" />);
      expect(screen.getByText('Romanian Deadlift')).toBeInTheDocument();
    });

    it('shows primary muscles in collapsed state', () => {
      render(<ExerciseCard entry={mockExercise} type="strength" />);
      expect(screen.getByText(/hamstrings/i)).toBeInTheDocument();
    });

    it('does not show instructions when collapsed', () => {
      render(<ExerciseCard entry={mockExercise} type="strength" />);
      expect(screen.queryByText('Stand with feet shoulder-width.')).not.toBeInTheDocument();
    });

    it('shows instructions after clicking the card', () => {
      render(<ExerciseCard entry={mockExercise} type="strength" />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Stand with feet shoulder-width.')).toBeInTheDocument();
      expect(screen.getByText('Hinge at the hips.')).toBeInTheDocument();
    });

    it('shows rationale after expanding', () => {
      render(<ExerciseCard entry={mockExercise} type="strength" />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText(/Builds the posterior chain/i)).toBeInTheDocument();
    });

    it('collapses again on second click', () => {
      render(<ExerciseCard entry={mockExercise} type="strength" />);
      fireEvent.click(screen.getByRole('button'));
      fireEvent.click(screen.getByRole('button'));
      expect(screen.queryByText('Stand with feet shoulder-width.')).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 3: Run to confirm failure**

  ```powershell
  npx jest src/__tests__/components/ExerciseCard.test.tsx --no-coverage
  ```

  Expected: FAIL — `Cannot find module '@/components/ExerciseCard'`

- [ ] **Step 4: Write the component**

  Create `src/components/ExerciseCard.tsx`:

  ```tsx
  'use client';
  import { useState } from 'react';
  import type { ExerciseEntry, PlyoEntry, PrehabEntry, StretchEntry, LibraryType } from '@/lib/types';

  type AnyEntry = ExerciseEntry | PlyoEntry | PrehabEntry | StretchEntry;

  interface Props {
    entry: AnyEntry;
    type: LibraryType;
  }

  export default function ExerciseCard({ entry, type }: Props) {
    const [expanded, setExpanded] = useState(false);

    const gifUrl = type === 'strength' ? (entry as ExerciseEntry).gifUrl : null;
    const videoUrl = (entry as PrehabEntry).videoUrl ?? null;
    const rationale = (entry as ExerciseEntry).rationale ?? null;

    const chips: string[] = [];
    if (type === 'strength') {
      const e = entry as ExerciseEntry;
      if (e.mechanic) chips.push(e.mechanic);
      if (e.level) chips.push(e.level);
      if (e.equipment?.[0]) chips.push(e.equipment[0]);
    } else if (type === 'plyo') {
      const e = entry as PlyoEntry;
      chips.push(`Tier ${e.progressionTier}`);
      chips.push(e.intensity);
      chips.push(`${e.contactLoad} contact`);
    } else if (type === 'prehab') {
      const e = entry as PrehabEntry;
      chips.push(e.bodyRegion);
      chips.push(e.category);
    } else {
      const e = entry as StretchEntry;
      chips.push(e.type);
      chips.push(e.whenToUse);
      if (e.duration) chips.push(e.duration);
    }

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <button
          className="w-full text-left flex items-center min-h-[88px]"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="w-[100px] min-w-[100px] h-[88px] bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
            {gifUrl ? (
              <img src={gifUrl} alt={entry.name} className="object-cover w-full h-full" loading="lazy" />
            ) : (
              <span className="text-gray-400 text-xs capitalize">{type}</span>
            )}
          </div>

          <div className="flex-1 px-3 py-2 min-w-0">
            <div className="font-semibold text-sm text-gray-900 truncate">{entry.name}</div>
            {entry.primaryMuscles.length > 0 && (
              <div className="text-xs text-gray-500 mt-0.5 truncate">
                {entry.primaryMuscles.slice(0, 3).join(' · ')}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {chips.map(chip => (
                <span
                  key={chip}
                  className="bg-blue-50 text-blue-700 text-[11px] px-2 py-0.5 rounded-full capitalize"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <div className="px-3 text-gray-400 text-lg shrink-0 select-none">
            {expanded ? '‹' : '›'}
          </div>
        </button>

        {expanded && (
          <div className="border-t border-gray-100 px-4 py-3">
            {entry.muscleText && (
              <p className="text-xs text-gray-600 mb-3 leading-relaxed">{entry.muscleText}</p>
            )}
            {entry.instructions.length > 0 && (
              <ol className="list-decimal list-inside space-y-1.5">
                {entry.instructions.map((step, i) => (
                  <li key={i} className="text-xs text-gray-700 leading-snug">{step}</li>
                ))}
              </ol>
            )}
            {rationale && (
              <div className="mt-3 bg-gray-50 rounded-md px-3 py-2 text-xs text-gray-600">
                <span className="font-semibold">Why: </span>{rationale}
              </div>
            )}
            {videoUrl && (
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs text-blue-600 underline"
              >
                Watch video →
              </a>
            )}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5: Run tests to confirm they pass**

  ```powershell
  npx jest src/__tests__/components/ExerciseCard.test.tsx --no-coverage
  ```

  Expected:
  ```
  PASS src/__tests__/components/ExerciseCard.test.tsx
    ExerciseCard
      ✓ renders the exercise name
      ✓ shows primary muscles in collapsed state
      ✓ does not show instructions when collapsed
      ✓ shows instructions after clicking the card
      ✓ shows rationale after expanding
      ✓ collapses again on second click

  Test Suites: 1 passed, 1 total
  ```

- [ ] **Step 6: Commit**

  ```powershell
  git add src/components/ExerciseCard.tsx src/__tests__/components/ExerciseCard.test.tsx jest.setup.ts jest.config.ts
  git commit -m "feat: ExerciseCard component with expand/collapse and render tests"
  ```

---

## Task 12: LibraryBrowser Component

**Files:**
- Create: `src/components/LibraryBrowser.tsx`

No unit tests for this component — filter logic is simple enough to verify in the smoke test.

- [ ] **Step 1: Write the component**

  Create `src/components/LibraryBrowser.tsx`:

  ```tsx
  'use client';
  import { useState, useEffect, useMemo } from 'react';
  import ExerciseCard from './ExerciseCard';
  import type { ExerciseEntry, PlyoEntry, PrehabEntry, StretchEntry, LibraryType } from '@/lib/types';

  type AnyEntry = ExerciseEntry | PlyoEntry | PrehabEntry | StretchEntry;

  interface Props {
    type: LibraryType;
  }

  export default function LibraryBrowser({ type }: Props) {
    const [entries, setEntries] = useState<AnyEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [muscle, setMuscle] = useState('');
    const [equipment, setEquipment] = useState('');
    const [level, setLevel] = useState('');
    const [tier, setTier] = useState('');
    const [intensity, setIntensity] = useState('');
    const [bodyRegion, setBodyRegion] = useState('');
    const [category, setCategory] = useState('');
    const [stretchType, setStretchType] = useState('');
    const [whenToUse, setWhenToUse] = useState('');

    useEffect(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/library?type=${type}`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: AnyEntry[]) => { setEntries(data); setLoading(false); })
        .catch(e => { setError(e.message); setLoading(false); });
    }, [type]);

    const filtered = useMemo(() => {
      const q = search.toLowerCase();
      return entries.filter(e => {
        if (q && !e.name.toLowerCase().includes(q)) return false;
        if (type === 'strength') {
          const ex = e as ExerciseEntry;
          if (muscle && !ex.primaryMuscles.some(m => m.toLowerCase().includes(muscle))) return false;
          if (equipment && !ex.equipment.some(eq => eq.toLowerCase().includes(equipment))) return false;
          if (level && ex.level !== level) return false;
        }
        if (type === 'plyo') {
          const pl = e as PlyoEntry;
          if (tier !== '' && pl.progressionTier !== Number(tier)) return false;
          if (intensity && pl.intensity !== intensity) return false;
        }
        if (type === 'prehab') {
          const pr = e as PrehabEntry;
          if (bodyRegion && pr.bodyRegion !== bodyRegion) return false;
          if (category && pr.category !== category) return false;
        }
        if (type === 'stretch') {
          const st = e as StretchEntry;
          if (stretchType && st.type !== stretchType) return false;
          if (whenToUse && st.whenToUse !== whenToUse) return false;
        }
        return true;
      });
    }, [entries, search, type, muscle, equipment, level, tier, intensity, bodyRegion, category, stretchType, whenToUse]);

    const select = 'text-xs border border-gray-200 rounded-full px-3 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400';

    return (
      <div className="flex flex-col h-full">
        {/* Sticky filter bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 pt-3 pb-2 space-y-2">
          <input
            type="search"
            placeholder={`Search ${type} exercises...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex gap-2 flex-wrap">
            {type === 'strength' && (
              <>
                <select value={muscle} onChange={e => setMuscle(e.target.value)} className={select}>
                  <option value="">Muscle</option>
                  {['hamstrings','quads','glutes','calves','chest','back','shoulders','biceps','triceps','core','hip flexors'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select value={equipment} onChange={e => setEquipment(e.target.value)} className={select}>
                  <option value="">Equipment</option>
                  {['barbell','dumbbell','body weight','cable','machine','resistance band','kettlebell'].map(eq => (
                    <option key={eq} value={eq}>{eq}</option>
                  ))}
                </select>
                <select value={level} onChange={e => setLevel(e.target.value)} className={select}>
                  <option value="">Level</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="expert">Expert</option>
                </select>
              </>
            )}
            {type === 'plyo' && (
              <>
                <select value={tier} onChange={e => setTier(e.target.value)} className={select}>
                  <option value="">All tiers</option>
                  <option value="0">Tier 0 — Foundational</option>
                  <option value="1">Tier 1 — Moderate</option>
                  <option value="2">Tier 2 — High</option>
                </select>
                <select value={intensity} onChange={e => setIntensity(e.target.value)} className={select}>
                  <option value="">Intensity</option>
                  <option value="low">Low</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                </select>
              </>
            )}
            {type === 'prehab' && (
              <>
                <select value={bodyRegion} onChange={e => setBodyRegion(e.target.value)} className={select}>
                  <option value="">Body region</option>
                  {['knee','ankle','hip','low-back','shoulder','foot','shin','it-band'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select value={category} onChange={e => setCategory(e.target.value)} className={select}>
                  <option value="">Category</option>
                  {['stretch','strengthen','mobility','stability','proprioception'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </>
            )}
            {type === 'stretch' && (
              <>
                <select value={stretchType} onChange={e => setStretchType(e.target.value)} className={select}>
                  <option value="">Type</option>
                  <option value="dynamic">Dynamic</option>
                  <option value="static">Static</option>
                </select>
                <select value={whenToUse} onChange={e => setWhenToUse(e.target.value)} className={select}>
                  <option value="">When to use</option>
                  <option value="pre">Pre</option>
                  <option value="post">Post</option>
                  <option value="recovery">Recovery</option>
                  <option value="any">Any</option>
                </select>
              </>
            )}
          </div>
        </div>

        {/* Card list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-24">
          {loading && (
            <p className="text-sm text-gray-400 text-center py-12">Loading...</p>
          )}
          {error && (
            <p className="text-sm text-red-500 text-center py-12">Failed to load: {error}</p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-12">No exercises match your filters.</p>
          )}
          {!loading && !error && filtered.map(entry => (
            <ExerciseCard key={entry.id} entry={entry} type={type} />
          ))}
          {!loading && !error && entries.length > 0 && (
            <p className="text-xs text-gray-400 text-center pt-2">
              {filtered.length} of {entries.length} exercises
            </p>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

  ```powershell
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```powershell
  git add src/components/LibraryBrowser.tsx
  git commit -m "feat: LibraryBrowser component — search + filter shell for all 4 modalities"
  ```

---

## Task 13: Four Library Pages

**Files:**
- Create: `src/app/strength/page.tsx`
- Create: `src/app/plyo/page.tsx`
- Create: `src/app/prehab/page.tsx`
- Create: `src/app/stretch/page.tsx`

- [ ] **Step 1: Create the four pages**

  Create `src/app/strength/page.tsx`:
  ```tsx
  import LibraryBrowser from '@/components/LibraryBrowser';

  export const metadata = { title: 'Strength Library — Running on AI' };

  export default function StrengthPage() {
    return <LibraryBrowser type="strength" />;
  }
  ```

  Create `src/app/plyo/page.tsx`:
  ```tsx
  import LibraryBrowser from '@/components/LibraryBrowser';

  export const metadata = { title: 'Plyo Library — Running on AI' };

  export default function PlyoPage() {
    return <LibraryBrowser type="plyo" />;
  }
  ```

  Create `src/app/prehab/page.tsx`:
  ```tsx
  import LibraryBrowser from '@/components/LibraryBrowser';

  export const metadata = { title: 'Prehab Library — Running on AI' };

  export default function PrehabPage() {
    return <LibraryBrowser type="prehab" />;
  }
  ```

  Create `src/app/stretch/page.tsx`:
  ```tsx
  import LibraryBrowser from '@/components/LibraryBrowser';

  export const metadata = { title: 'Stretch Library — Running on AI' };

  export default function StretchPage() {
    return <LibraryBrowser type="stretch" />;
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```powershell
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```powershell
  git add src/app/strength/page.tsx src/app/plyo/page.tsx src/app/prehab/page.tsx src/app/stretch/page.tsx
  git commit -m "feat: add strength, plyo, prehab, stretch library pages"
  ```

---

## Task 14: Extend BottomNav

**Files:**
- Modify: `src/components/BottomNav.tsx`

- [ ] **Step 1: Add the four new tab icons**

  Open `src/components/BottomNav.tsx`. Find the existing lucide-react import line, e.g.:
  ```tsx
  import { LayoutDashboard, Moon, Flame, TrendingUp, User } from 'lucide-react';
  ```

  Add `Dumbbell`, `Zap`, `Shield`, `Waves`:
  ```tsx
  import { LayoutDashboard, Moon, Flame, TrendingUp, User, Dumbbell, Zap, Shield, Waves } from 'lucide-react';
  ```

- [ ] **Step 2: Add the four new nav items**

  Find the `NAV_ITEMS` array:
  ```tsx
  const NAV_ITEMS = [
    { href: '/', label: t('nav.home'), Icon: LayoutDashboard },
    { href: '/sleep', label: t('nav.sleep'), Icon: Moon },
    { href: '/strain', label: t('nav.strain'), Icon: Flame },
    { href: '/trends', label: t('nav.trends'), Icon: TrendingUp },
    { href: '/profile', label: t('nav.profile'), Icon: User },
  ];
  ```

  Replace with:
  ```tsx
  const NAV_ITEMS = [
    { href: '/', label: t('nav.home'), Icon: LayoutDashboard },
    { href: '/sleep', label: t('nav.sleep'), Icon: Moon },
    { href: '/strain', label: t('nav.strain'), Icon: Flame },
    { href: '/trends', label: t('nav.trends'), Icon: TrendingUp },
    { href: '/profile', label: t('nav.profile'), Icon: User },
    { href: '/strength', label: 'Strength', Icon: Dumbbell },
    { href: '/plyo', label: 'Plyo', Icon: Zap },
    { href: '/prehab', label: 'Prehab', Icon: Shield },
    { href: '/stretch', label: 'Stretch', Icon: Waves },
  ];
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```powershell
  npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```powershell
  git add src/components/BottomNav.tsx
  git commit -m "feat: add Strength, Plyo, Prehab, Stretch tabs to BottomNav"
  ```

---

## Task 15: Smoke Test

- [ ] **Step 1: Run all tests**

  ```powershell
  npx jest --no-coverage
  ```

  Expected: all test suites pass. Fix any failures before continuing.

- [ ] **Step 2: Run the seed**

  ```powershell
  npm run seed
  ```

  Expected summary line confirms plyo (25), prehab (30), stretch (20) upserted. Exercise count depends on whether Kaggle/free-exercise-db data is present — wger exercises will be seeded regardless.

- [ ] **Step 3: Start the dev server**

  ```powershell
  npm run dev
  ```

- [ ] **Step 4: Verify all four library routes load**

  Open each URL in a browser and confirm:

  | URL | Expected |
  |---|---|
  | `http://localhost:3000/strength` | Card list loads, search input visible, Muscle/Equipment/Level dropdowns in filter bar |
  | `http://localhost:3000/plyo` | 25 plyo cards, Tier and Intensity dropdowns |
  | `http://localhost:3000/prehab` | 30 prehab cards, Body Region and Category dropdowns |
  | `http://localhost:3000/stretch` | 20 stretch cards, Type and When to use dropdowns |

- [ ] **Step 5: Verify card interaction**

  On any page:
  - Type a name into the search box — card list filters instantly
  - Select a filter dropdown — list narrows
  - Click a card — it expands inline to show instructions and rationale
  - Click again — it collapses

- [ ] **Step 6: Verify BottomNav tabs**

  Confirm Strength, Plyo, Prehab, and Stretch tabs appear in the bottom nav and navigate to the correct pages.

- [ ] **Step 7: Verify Prisma Studio shows all tables**

  ```powershell
  npx prisma studio
  ```

  Open `http://localhost:5555` and confirm all 16 tables are listed, including the stubbed ones (Session, Plan, etc.) which are empty.

- [ ] **Step 8: Final commit**

  ```powershell
  git add .
  git commit -m "chore: Phase 0 complete — library browser working for all 4 modalities"
  ```
