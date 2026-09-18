# Phase 3 — Run Engine Design
**Date:** 2026-08-20
**Status:** Approved (autonomous build)
**Framework ref:** §7 (run engine), §5 (anchors + calibration), §6 (four signals), §17 (deload)

---

## Goal

Daily run recommendations that are actually right for this athlete: what to run
today, how far, at what effort, and why — gated by readiness, ramped from where
he actually is, and paced from anchors the system has earned rather than guessed.

**Does not include:** the allocator that spends one budget across running *and*
lifting (Phase 5), natural-language editing (Phase 6), or watch write-back
(Phase 6). Phase 3 populates `planned_session`, which is what finally switches on
the concurrent-training guard already sitting dormant in the strength engine.

---

## 1. The constraint that shapes everything

The athlete is post ACL tear + MACI cartilage transplant + high tibial osteotomy.
He is cleared for **walk/run intervals, not continuous running**. He previously
ran 6:30/mile; he is currently around 12:00/mile for a quarter mile.

A generic run engine that prescribes "45 minutes easy" is not merely unhelpful
here — it is the exact failure mode the framework's Contrarian warns about
(§21): the system knows him least in the first weeks and makes its first
impression then. So:

- **The return-to-run ladder is the primary mode**, not a special case bolted
  onto a normal training plan. Continuous-running session types exist in the
  taxonomy but are *unreachable* until the ladder graduates.
- `athlete_profile.recoveryContextJson.longestRunSegmentMin` is a hard ceiling.
  The engine never prescribes a continuous segment longer than it.
- Pace is not prescribed during return-to-run. Effort and heart rate are. Pace
  in this phase is an *output* to be observed, not a target to chase — telling
  someone rebuilding cartilage to hit a pace is how you get them chasing it.

---

## 2. Session taxonomy

Each type carries a purpose, an intensity the allocator can eventually price,
and a target spec. `intensityCost` is a 1–10 sRPE-equivalent used for load.

| Type | Purpose | intensityCost | Gated behind |
|---|---|---|---|
| `rest` | Nothing today | 0 | — |
| `walk` | Movement without impact | 2 | — |
| `walk_run` | Return-to-run ladder | 3–4 | — |
| `recovery` | Flush, minimal load | 3 | ladder graduated |
| `easy` | Aerobic base, the bulk of volume | 4 | ladder graduated |
| `long` | Durability | 5 | ladder graduated + 8 weeks of easy |
| `steady` | Sustained aerobic | 6 | ladder graduated |
| `tempo` | Threshold development | 7 | ladder graduated + LTHR anchor observed |
| `vo2` | Maximal aerobic power | 9 | ladder graduated + LTHR confirmed |
| `strides` | Neuromuscular, low load | 4 | ladder graduated |
| `hills` | Strength-endurance | 7 | ladder graduated + impact cleared |
| `progression` | Negative-split practice | 6 | ladder graduated |
| `fartlek` | Unstructured speed play | 6 | ladder graduated |

The gating is data, not code branches — `RUN_TYPES[type].requires` is a predicate
over `{ ladderGraduated, anchorConfidence, weeksOfBase, impactCleared }`. Phase 5's
allocator reads the same table.

---

## 3. The return-to-run ladder

A ladder of rungs, each defined by `{ runSec, walkSec, reps }`. Total run time is
`runSec × reps`; session duration is `(runSec + walkSec) × reps`.

Progression obeys three rules, in priority order:

1. **Never advance two dimensions in the same week.** Either the continuous run
   segment gets longer, or total volume goes up. Not both. This is the single
   most important rule in the file and the one most often broken in practice.
2. **Segment length advances only on evidence**, not on a schedule: the current
   rung must have been completed at least three times, with no pain flagged on
   any of those days and none in the 48 h after.
3. **Volume advances by at most 10% week over week**, tightened to 5% while
   `calibration_state` is still provisional.

Any pain flagged at `yes` drops the ladder back one rung and holds it there
until three consecutive pain-free sessions. Pain at `sometimes` holds the rung
without dropping it. This mirrors the readiness pain cap rather than inventing a
second rule.

The rung set runs from `1:4 × 6` (one minute running, four walking, six times)
through `10:1 × 3` and finally to continuous. Graduation from the ladder means
reaching 20 minutes continuous at conversational effort, three times, pain-free.
At that point `easy`, `recovery` and `strides` unlock; `long` needs a further
eight weeks of consistent easy volume; `tempo` and `vo2` need an LTHR anchor at
`observed` and `confirmed` respectively.

**Nothing about that ladder is a clearance decision.** It governs how fast the
app is willing to progress *within* what a surgeon or PT has already cleared. If
`longestRunSegmentMin` says 6, no rung above 6 minutes is offered regardless of
how many pain-free sessions have accumulated. Raising that ceiling is the
athlete's call, informed by his clinicians, entered on the profile page.

---

## 4. Readiness gating (§7, veto)

Same four signals, same veto discipline as the strength engine:

| Band | Effect on the run |
|---|---|
| GREEN | Session stands. |
| AMBER | Trim: drop the hardest element (fewest reps, or the top of a progression). Never stack a second hard day. No rung advance today. |
| RED | Easy or rest only. **Move the long run rather than cutting it**; never cut two long runs in a row. |

During return-to-run, AMBER additionally forbids a rung advance and RED replaces
the session with a walk. The framework's rule that the long run is moved rather
than cut is implemented as a `deferLongRun` flag on the plan, not by silently
deleting the session.

---

## 5. Paces from anchors, not from a calculator

Once the ladder graduates, pace targets come from `athlete_profile.trainingPacesJson`,
which carries `{ value, source, confidence }` per zone exactly as Phase 1
established.

- **Easy pace** derives from LTHR-anchored heart rate, not from a race
  equivalency, until a real time trial or race exists.
- **Threshold pace** comes from a 30-minute time trial (average HR of the last
  20 minutes ≈ LTHR) or from a recent race via Riegel with exponent 1.06 — and
  is labeled `estimate` until observed in training.
- **A pace anchor at `estimate` is never prescribed as a target.** The session
  shows a heart-rate range instead and says so. This is the honest version of
  the cold-start problem, and it is why the engine can be trusted early.

`RunParams` (already declared in `src/types/session.ts`) carries both
`targetPaceSecPerKm` and `targetHrLow`/`targetHrHigh`; the engine fills whichever
it has earned the right to prescribe.

---

## 6. Post-run analysis — the calibration loop

Logged RIR upgrades working-load anchors in Phase 2. The running equivalent runs
on completed `activities` rows:

| Computed | From | Upgrades |
|---|---|---|
| Aerobic decoupling (Pa:HR, first half vs second) | activity splits | Durability; long-run readiness |
| Pace at a matched easy HR band | activities over time | `trainingPaces.easy` — the cleanest fitness signal there is |
| Estimated LTHR | sustained efforts | `lthr` anchor, `estimate` → `observed` |
| Easy-day honesty (% of time above the Z2 ceiling) | avg HR vs ceiling | Flags junk miles; tightens the easy prescription |

Decoupling under 5% on an easy long run is the green zone. Pace-at-fixed-HR
improving month over month is the verdict that fitness moved, and it is what
lets the app eventually say *"three weeks ago I guessed your easy pace; I've now
confirmed it 20 s/km faster"* (§21).

**Caveat that must be surfaced, not buried:** `activities` currently stores only
duration, distance, average and max HR — no splits, no per-second streams. So
decoupling is not computable from stored data yet. Phase 3 computes what the
schema supports (pace at matched HR, easy-day honesty, LTHR estimation) and
leaves decoupling behind a `hasSplits` guard rather than faking it from averages.
Pulling splits is a `syncGarmin` change, tracked as follow-up work.

---

## 7. Periodization

`plan` holds the macro: goal race, phase (`return_to_run` → `base` → `build` →
`peak` → `taper`), week in block, weekly volume target, intensity distribution.
`planned_session` holds what the plan wants per day, with an A/B/C priority.

**`athlete_profile.goalRace` is empty and there is no race date.** Rather than
inventing one, the engine defaults to a `return_to_run` plan with no end date,
whose only objective is the ladder. Periodization proper switches on the moment
a race and date are entered. This is an open question for the athlete, recorded
in `BUILD-STATE.md`, not a blocker.

Filling `planned_session` also activates `checkConcurrentConflict` in the
strength engine, which has been returning "no run plan yet" since Phase 2. No
code changes there — it starts biting on its own.

---

## 8. Files

| File | Purpose |
|---|---|
| `src/types/run.ts` | Run taxonomy types, ladder rungs, analysis results |
| `src/lib/runEngine.ts` | Pure: taxonomy table, ladder progression, readiness gating, pace resolution |
| `src/lib/runAnalysis.ts` | Pure: post-run metrics from activity rows |
| `src/lib/runSession.ts` | DB-facing: plan reads/writes, today's run, anchor write-back |
| `src/data/ladder-rungs.json` | The return-to-run ladder |
| `/api/run/today`, `/api/run/plan`, `/api/run/analysis` | API surface |
| `src/app/run/page.tsx` + components | The run screen |
| `src/lib/runScenario.ts` | `RUN_SCENARIO` presets (§16) |

---

## 9. Scenario presets

| Scenario | Simulates |
|---|---|
| `run_ladder_early` | Rung 2, one session completed — no advance yet |
| `run_ladder_ready` | Rung 4, three clean sessions — advance available |
| `run_ladder_pain` | Pain flagged mid-ladder — drop a rung, hold |
| `run_graduated` | Ladder complete, easy running unlocked, pace anchor `observed` |
| `run_no_anchors` | Graduated but every pace anchor still `estimate` — HR targets only |

---

## 10. Success criteria

- `npm test` green, with unit tests covering ladder advancement (including the
  never-two-dimensions rule), the pain drop-back, readiness gating, type gating,
  and pace-vs-HR prescription by anchor confidence.
- `/run` shows today's session with a plain-language why, in every scenario.
- The ladder never offers a segment longer than `longestRunSegmentMin`.
- A pace anchor at `estimate` produces an HR target and says why, never a pace.
- `planned_session` rows exist, and the strength engine's concurrent guard
  starts reporting real conflicts with no change to its code.
- `npx next build` clean.
