# Phase 2 — Strength Tracker Design
**Date:** 2026-08-20
**Status:** Approved (autonomous build)
**Framework ref:** §3 (data model), §8 (strength subsystem), §5b (calibration), §15 (safety)

---

## Goal

Ship a usable lifting tracker: log every set as weight × reps × RIR, see last session's numbers inline while you lift, and get a next-load suggestion that respects both progressive overload and today's readiness band.

Two things happen underneath that the user never has to think about:

1. **Calibration.** Logged RIR is the highest-signal correction available for `athlete_profile.keyLiftLoadsJson`. Every logged set upgrades a working-load anchor along `estimate → observed → confirmed` (§5b).
2. **The Session object is born here.** Rather than inventing a throwaway "workout" record and rewriting it in Phase 5, Phase 2 writes real `session` rows whose `blocksJson` already uses the Phase 5 block/item shape. Phase 5 adds run/plyo/prehab items to the same structure and an allocator that fills it — it does not restructure it.

**Does not include:** the allocator, the Today screen, natural-language editing, run/plyo/prehab prescription. Those stay in Phases 3–6.

---

## 1. The Session object (defined now, used by every later phase)

`session.blocksJson` holds an ordered array of blocks. This is the canonical shape from framework §3 and it does not change in later phases.

```ts
export type ItemKind = 'exercise' | 'plyo' | 'prehab' | 'stretch' | 'run'
export type ItemStatus = 'prescribed' | 'done' | 'skipped' | 'edited'
export type BlockKind = 'warmup' | 'main' | 'accessory' | 'cooldown'

export interface ItemRef {
  kind: ItemKind
  id: string          // FK into the matching library table
  name: string        // denormalized so a session renders without joins
}

export interface StrengthParams {
  sets: number
  reps: number              // target reps (top of range)
  repsMin?: number          // bottom of range → double progression
  weightKg: number | null   // null = bodyweight or not yet chosen
  targetRir: number
  restSec?: number
}

export interface SessionItem {
  id: string                // uuid, unique within the session
  ref: ItemRef
  params: StrengthParams | RunParams | ContactParams | HoldParams
  why?: string              // contextual, coach-generated (Phase 5+)
  status: ItemStatus
}

export interface SessionBlock {
  id: string
  kind: BlockKind
  label: string
  items: SessionItem[]
}
```

Phase 2 only ever writes `main` and `accessory` blocks containing `exercise` items. `RunParams`, `ContactParams`, and `HoldParams` are declared in `src/types/session.ts` now so Phase 3/4 add data, not types.

`session.status`: `draft` → `active` → `completed`. `sourceOfLastEdit`: `'user' | 'coach' | 'engine'`.

---

## 2. `src/lib/strengthEngine.ts` — pure, unit-tested

Every function here is deterministic and DB-free. Safety and math live in code, never in a prompt (§10).

### 2.1 Estimated 1RM

```
epley(w, reps, rir)    = w × (1 + (reps + rir) / 30)
brzycki(w, reps, rir)  = w × 36 / (37 − (reps + rir))
```

`rir` is added to `reps` because reps-in-reserve is exactly the count of reps not performed. Both formulas degrade past ~12 total reps; `estimateE1RM` returns `{ value, confidence }` where confidence drops to `'low'` above 12 effective reps and the caller is expected to say so on screen. **No max testing, ever** (§5a) — e1RM is only ever derived from submaximal work.

### 2.2 Double progression

The progression rule, in order:

| Condition on the last completed session for this exercise | Action |
|---|---|
| All sets hit `reps` (top of range) **and** mean RIR ≥ `targetRir` | Increase load by `increment`, reset reps to `repsMin` |
| All sets hit at least `repsMin`, mean RIR ≥ `targetRir` | Same load, +1 rep on the first set short of `reps` |
| Mean RIR < `targetRir` − 1 (harder than prescribed) | Same load, no rep increase |
| Mean RIR ≤ `targetRir` − 2, or any set missed `repsMin` | Reduce load ~7.5% |
| No history | Return `action: 'no_history'` — the UI asks the user rather than guessing (§5a, cold-start honesty) |

**Sizing the jump.** `increment` is 2.5 kg for upper-body and single-leg movements, 5 kg for bilateral lower-body and hinge patterns, and it is capped at 5% of the current load so a 20 kg lift does not climb as fast as a 100 kg one. That cap collides with physical reality: you cannot add less than the smallest plate pair you own (`microStepKg`, 2.5 kg on a standard barbell). `effectiveIncrement` resolves the collision by taking the largest loadable step that fits under the cap, accepting the smallest plate step when it is still under ~7.5%, and otherwise returning `null` — at which point the engine **adds a rep instead of forcing an oversized jump**, which is the correct training answer rather than a rounding hack. A 100 kg RDL goes up 5 kg; a 60 kg one goes up 2.5 kg; a 20 kg one gets a ninth rep.

### 2.3 Readiness gating

`applyReadinessAdjustment(prescription, band, provisional)`:

| Band | Effect |
|---|---|
| GREEN | Prescription stands. |
| AMBER | Drop the last working set of each main lift; cap load at last session's load (no progression today); accessory volume −20%. |
| RED | Main lifts removed. Session reduced to the accessory/prehab block at technique load, or skipped entirely. |

`provisional === true` (inside the calibration window) additionally caps any load increase at one increment per week per lift, regardless of how easy the RIR was. The system does not sprint to a number it has not yet earned confidence in.

### 2.4 Volume landmarks and load-triggered deload

Weekly hard sets per muscle group are counted from `set_logs` over a rolling 7 days. Landmarks (MEV / MAV / MRV) are stored per muscle group with a `trainingAge` multiplier. Deload is **load-triggered only** (§17) — never on a calendar:

`shouldDeload()` returns true when any of:
- weekly sets for a muscle group exceed MRV two weeks running, or
- readiness ACWR > 1.3 for 3+ consecutive days, or
- mean RIR across main lifts has fallen ≥ 1.5 below target for 2 consecutive sessions at unchanged load.

It returns a `reason` string, always surfaced ("deloading because X", never a silent cut).

### 2.5 Concurrent-training rules

`checkConcurrentConflict(liftPlan, plannedRun)` encodes §8:
- No heavy lower-body work in the 24 h before a long run or a VO2 session.
- If a lift and a quality run share a day, run first or separate by ≥ 6 h.
- Never place the heaviest lift of the week on the A-run's day.

Phase 2 has no run plan to check against, so this reads `planned_session` if rows exist and otherwise returns `{ conflict: false, reason: 'no run plan yet' }`. Phase 3 populates `planned_session` and the function starts biting with no changes to its callers.

### 2.6 Post-surgical constraints

The profile carries `ACL tear / MACI / HTO`. The engine applies a **contraindication filter**, not a diagnosis (§15):

- Exercises are tagged with movement attributes — `deep_knee_flexion`, `open_chain_knee_extension`, `high_impact`, `loaded_pivot`, `deep_squat_load`.
- `athlete_profile.recoveryContextJson` gains an optional `clearance` object: `{ maxKneeFlexionDeg, openChainCleared, impactCleared, notes, setBy: 'user' }`.
- **The system never invents clearance values.** Absent an explicit entry, the engine assumes the most conservative posture: filter out `deep_knee_flexion`, `open_chain_knee_extension`, `loaded_pivot`, and `high_impact` on the surgical side, and label the filter on screen as *"hidden because you haven't entered surgical clearance — your surgeon or PT sets these, not this app."*
- Current pain = `yes` caps the strength session the same way it caps readiness: accessory and prehab only.

The medical disclaimer from §15 renders persistently on `/strength`, not just at first run.

### 2.7 Calibration write-back

`deriveWorkingLoadAnchor(exerciseId, logs)` returns `{ value, source, confidence }`:

| Evidence | source | confidence |
|---|---|---|
| No logs | `estimate` | 0.2 |
| 1–2 logged sessions | `observed` | 0.5 |
| 3+ sessions, RIR within ±1 of target, load stable or rising | `confirmed` | 0.85 |

Written to `athlete_profile.keyLiftLoadsJson` keyed by exercise id. This is the same anchor machinery Phase 1 established for paces and zones, and it is what lets the app eventually say *"three weeks ago I guessed your working squat; I've now confirmed it 10 kg higher"* (§21, the Expansionist's point).

---

## 3. Runner-relevant key lifts

The library holds 800+ exercises; the strength engine only *progresses* a curated set, seeded into a new `src/data/key-lifts.json` with movement-attribute tags and a runner rationale. Emphasis per §8: posterior chain, unilateral, calf–Achilles, hips, trunk; strength over hypertrophy.

Patterns covered: hinge, squat, unilateral squat/lunge, calf/Achilles (straight- and bent-knee), hip abduction, hamstring (Nordic/RDL), trunk anti-rotation and anti-extension. Each entry maps to an `exercise_library.id`, carries `contraindications: string[]`, `increment`, `defaultSets`, `defaultReps`, `defaultTargetRir`, and a one-line `runnerRationale`.

---

## 4. API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/strength/session` | GET | Today's session (creates a draft from the template if none exists) |
| `/api/strength/session` | PATCH | Add / remove / reorder items; writes `edit_history` |
| `/api/strength/log` | POST | Log one set → `set_logs`; returns the updated item + next-set suggestion |
| `/api/strength/history` | GET | `?exerciseId=` → last N sessions of sets for inline "last time" display |
| `/api/strength/suggest` | GET | `?exerciseId=` → `{ weightKg, reps, targetRir, reason }` |

Every mutating route writes `edit_history` with `actor`, `diffJson`, and `reason` — the audit trail Phase 6's preference inference reads (§13). Building it now costs nothing; retrofitting it later costs everything.

---

## 5. UI — `/strength`

Mobile-first, same visual language as the readiness home screen.

```
┌─────────────────────────────────────────┐
│  Strength · Thursday, Aug 20            │
│  ● AMBER — top set dropped              │
├─────────────────────────────────────────┤
│  MAIN                                   │
│  ┌───────────────────────────────────┐  │
│  │ Romanian Deadlift        [why ⌄]  │  │
│  │ 3 × 8 @ 60 kg · RIR 2             │  │
│  │ last time: 3×8 @ 57.5 · RIR 2     │  │
│  │  ┌────┬────┬────┐                 │  │
│  │  │ kg │reps│RIR │  [ log set ]    │  │
│  │  └────┴────┴────┘                 │  │
│  │  set 1 ✓ 60×8 RIR2                │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│  ACCESSORY                               │
│  … cards …                               │
├─────────────────────────────────────────┤
│  ⚠ Educational information, not medical │
│    advice. Clearance comes from your    │
│    surgeon or PT.                       │
└─────────────────────────────────────────┘
```

Decisions:
- **Steppers, not keyboards.** Weight steps by the lift's increment, reps and RIR by 1. Logging a set must survive being done with one sweaty thumb between sets.
- **Last time is always visible** on the card, not behind a tap. It is the single most useful number while lifting.
- **RIR is required**, weight optional (bodyweight movements). RIR is the autoregulation and calibration signal; a set logged without it is worth much less.
- **The readiness band is stated at the top with what it changed** — "top set dropped", not a silent shorter session.
- Completed sets render inline under the card; tapping one re-opens it for correction (writes `edit_history`).

`/strength` joins BottomNav. The nav is at six items; Strength replaces nothing — it displaces `/stress` to the Trends page, which is where charts belong (§14).

---

## 6. Scenario mode

`src/lib/scenario.ts` gains strength presets so every path is testable without a gym history:

| Scenario | Simulates |
|---|---|
| `strength_fresh` | No log history — cold start, suggestions return null, UI asks |
| `strength_progressing` | 4 weeks of clean logs, RIR on target, loads climbing |
| `strength_stalled` | RIR falling below target at unchanged load → deload trigger fires |
| `strength_overreached` | Weekly sets above MRV two weeks running → deload with reason |

Per §16, every feature works in mock mode first.

---

## 7. Success criteria

- `npm test` green, including new `strengthEngine` unit tests covering e1RM, double progression, readiness adjustment, deload triggers, and the contraindication filter.
- `/strength` loads with a session, logs sets, and shows last-session numbers inline — with `SCENARIO=strength_progressing` and with a real empty DB.
- Logging three sessions of an exercise upgrades its anchor in `keyLiftLoadsJson` from `estimate` to `confirmed`.
- An AMBER readiness band visibly changes the prescription and says what it changed.
- With no clearance entered, knee-contraindicated exercises are filtered and the reason is on screen.
- `npx next build` clean.
