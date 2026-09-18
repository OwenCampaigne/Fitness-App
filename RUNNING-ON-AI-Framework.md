# Running on AI — Build Framework (v3, build hand-off)

*An all-in-one, recovery-driven training system that calibrates to you, decides the single best thing to do today across running, lifting, plyometrics, and prehab, explains every piece of it, lets both you and the coach reshape it, and adapts before you ask.*

This is the spec to build from in Claude Code. It audits what you already have, rebuilds the problem from first principles, specifies each subsystem in depth, defines how the system **personalizes to you** before it starts coaching, then ties everything into one daily loop — closing with a five-person council and a Monday-morning first step.

> **What changed in v3:** added **The Intro Ramp** (§5) — a one-time onboarding intake plus a multi-week calibration window so the system starts from *your* real paces, weights, and zones and self-corrects, instead of over/under-estimating you. Every derived number now carries a **confidence + source**. Sections renumbered to fit.
>
> **From v2:** the AI coach can **edit the live workout** (run/weights/plyos) from natural language and **you** can edit it manually — through one funnel. Every exercise carries a **research-backed explanation**. **Cards** show a muscle image + structured muscle text + how-to. Added **rehabhero.ca** (PT/mobility taxonomy), **wger** (licensed exercise supplement), and **dynamic + static stretching**. Deload is **load-triggered only**. Added the **Today screen**, **disclaimer**, and **mock/scenario mode**. Removed fueling, menstrual-cycle, gear-tracking, travel-context, and export.

---

## 0. The one-paragraph version

You have three repos that, between them, cover most of the hard parts. The **Garmin health dashboard** is the real prize — modern Next.js with research-grade recovery/strain scoring, already wired to the Anthropic API. Make Garmin your **single source of truth** for both runs *and* recovery, which sidesteps the 2026 Strava API clampdown. Replace the weak exercise data with **free-exercise-db** (public domain, images, muscles), supplemented by **wger** (licensed) and a hand-built **plyo / prehab / stretch** catalog modeled on rehabhero's body-region taxonomy. Before it coaches, the system runs an **intro ramp** that calibrates to your real numbers and self-corrects. The genuinely new thing you're building is a **daily allocator** that spends one shared recovery budget across run/lift/plyo/prehab, plus a **single editable Session object** both Claude and you can reshape, with every exercise explaining *why it's there*. Build those, calibrate them to you, and you have a product.

---

## 1. Asset audit — what to keep, what to gut

### 1a. `garmin-health-dashboard` → **the spine. Keep almost all of it.**

The strongest of the three; the chassis everything is built on.

- **Stack:** Next.js 14 (App Router), TypeScript, Tailwind, Recharts, PWA + web-push, Jest.
- **Data layer (`src/lib/garmin.ts`):** `garmin-connect` lib, warm singleton client, 15-min cache, OAuth-token restore, and **graceful mock fallback** (seed of "dev mode," §16).
- **Scoring (`src/lib/scoring.ts`):** **Recovery** = HRV-vs-baseline (40%) + RHR-vs-baseline (30%) + sleep (30%), banded 67/34. **Strain** via **Bannister TRIMP** + **Tanaka max-HR** (208−0.7·age) → Whoop-style 0–21. **Sleep** weighted duration/quality.
- **Benchmarks:** HRV/RHR population percentiles by age/sex.
- **AI already wired (`src/app/api/ai-summary/route.ts`):** already POSTs to `api.anthropic.com`. Expand this one route into the Coach Brain (generate + edit).

**Verdict:** foundation. Build everything *into* this app.

### 1b. `strava-mcp` → **optional enrichment. Defer or drop.**

Mature MCP server (25 tools). 2026 reality is the blocker: Strava's API agreement prohibits **training** AI/ML on its data; **one-shot inference** is a documented gray area; Standard-tier now needs ~$12/mo; intermediary routing unsupported. Garmin already has your runs *and* the recovery data Strava can't see → Strava is redundant single-user. **Verdict:** shelf it for future segments/social only.

### 1c. `CustomizedWorkoutGenerator` → **schema inspiration only.**

Useful entity relationships (`User → Goal → Preferences → Plan → Schedule → Exercise → Progress`), but thin data (no muscles/images), a SQL-join "recommender," and the wrong stack (T-SQL). **Verdict:** borrow the relationships; throw away data and logic.

### 1d. Data sources (the heart of your catalogs)

| Source | What it gives | License posture | Use it for |
|---|---|---|---|
| **ExerciseDB** (Kaggle `exercisedb/fitness-exercises-dataset`, or self-host `oss.exercisedb.dev`) | ~1,300–1,500 exercises with **animated GIFs**, bodyPart, target/secondary muscles, equipment, step instructions | **GIFs are commercially licensed** — Kaggle re-upload is fine for a **personal app**; for publishing, buy exercisedb.io's in-app license or self-host the open-source API | The **primary visual library** — GIFs >> static photos for "how to do it." Map onto the cards. |
| **free-exercise-db** (yuhonas) | 800+ exercises, JSON, static images, primary/secondary muscles, equipment, **level / mechanic / force**, instructions | **Public domain** | **Enrichment** — supplies the `level`/`mechanic`/`force`/`category` fields ExerciseDB lacks (the strength engine wants them). Also the clean fallback if you ever drop ExerciseDB media. |
| **wger** (wger.de) | 845+ exercises, REST API, muscles, equipment, images, videos | **CC-BY-SA** (attribute + share-alike if you redistribute) | **Secondary supplement** to fill remaining gaps. Pull via API. |
| **rehabhero.ca** | PT/mobility by **body region** (knee, ankle, foot, hip, low-back…) × **category** (stretch / strengthen / mobility / stability / proprioception); videos on YouTube | **Proprietary** (explicit Terms) | **Taxonomy + exercise names/targets** (facts) to structure your prehab/mobility catalog. **Link/embed their YouTube**; author your own cues. Don't copy text or host media. |
| **muscleandstrength.com** | Large commercial DB w/ images & video | **Proprietary; blocks bots** | **Human reference only** — confirm a name/technique. Don't scrape or host. |

**Merge step:** ExerciseDB (`targetMuscles`/`bodyParts`/`equipments`/`gifUrl`, `"Step:N"` instructions) and free-exercise-db (`primaryMuscles`/`equipment`/`images`/`mechanic`/`level`/`force`) use different schemas — normalize both into one canonical `exercise_library` (match on normalized name; prefer ExerciseDB's GIF, free-exercise-db's mechanic/level/force). A ~30-line seed script.

**Stretching:** add **dynamic** (warmup) and **static** (cooldown/mobility) catalogs sourced from wger + rehabhero flexibility/mobility (names/targets), with your own cues.

**Licensing rule of thumb:** an exercise's *existence, name, target muscle, general technique are facts* you may freely use; a specific *written description, photo, or video is copyrighted* — author your own text, use public-domain/CC images, and **link** to proprietary videos. Low-risk single-user; binds only if you publish the data.

---

## 2. First principles — what are we actually building?

> **"Every morning, tell me the single best thing to do today — across running, lifting, plyos, and rehab — given my goal, my plan, and how recovered I actually am; explain why; and let me or the coach reshape it on the fly."**

Consequences:

1. **The unit is the *day*, not the *workout*.** The plan is an input; "here is today" is the output, made fresh against live recovery.
2. **The modalities compete for one budget** — the **concurrent-training** problem. The right abstraction is a **load allocator**.
3. **"Best in the moment" = `plan ∩ readiness`,** readiness holding veto. Claude explains and quantifies.
4. **A recommendation you can't reshape isn't trusted — and "generate" and "edit" are the same operation** (one Session, two entry points). This is why §11 (editing) is core.
5. **Garbage anchors poison everything.** If the system's idea of your threshold pace or working weights is wrong, every recommendation is wrong. So it must **calibrate to you first** and treat early estimates as low-confidence (§5).

```
        Garmin (truth) ─┐
                        ├─► Readiness ─┐
   Plan / periodization ┘             ├─► ALLOCATOR ─► Claude ─► SESSION (editable) ─► Today screen
   History + preferences ─────────────┘                ▲              ▲
   Libraries (lift/plyo/prehab/stretch) ───────────────┘     you + coach both edit here
   Calibrated anchors (§5) ──────────────────────────────────────────────┘  (+ optional watch write-back)
```

---

## 3. The unified data model

One database, one load currency. SQLite to start. Core tables:

| Table | Purpose | Key fields |
|---|---|---|
| `athlete_profile` | identity + **calibrated anchors** | age, sex, height, weight, goal race + date, fitness level, injury history; **HR zones, training paces, key-lift working loads, plyo tier — each with `value`, `source`, `confidence`** |
| `calibration_state` | where the intro ramp is | started_on, window_end, recovery_baseline_ready (bool), per-anchor confidence, graduated (bool) |
| `field_tests` | optional baseline tests | type (run TT / AMRAP / movement screen), date, result, derived_estimate |
| `readiness_daily` | one row/day (Garmin) | date, recovery_score, hrv, hrv_baseline, rhr, rhr_baseline, sleep_score, sleep_hours, body_battery, stress, training_readiness |
| `activities` | every run (Garmin) | date, type, duration, distance, avg/max HR, avg pace, splits (JSON), cadence, elevation, TRIMP, decoupling |
| `session` | **today's prescription — editable** | date, status, version, blocks (JSON, ordered), source_of_last_edit |
| `set_logs` | granular strength log | session_id, exercise_id, set#, weight, reps, RIR/RPE |
| `edit_history` | every change to a session | session_id, version, actor (coach/user), diff (JSON), reason, timestamp |
| `exercise_library` | strength (free-exercise-db + wger) | id, name, primary/secondary muscles, equipment, level, mechanic, force, category, instructions, **images[]**, **muscle_text**, **rationale**, **evidence** |
| `plyo_library` | plyometrics | id, name, intensity, contact_load, progression_tier, prerequisites, target, video_url, muscle_text, rationale, evidence |
| `prehab_library` | PT / prehab | id, name, **body_region**, **category**, niggle_tags, target_tissue, video_url, muscle_text, rationale, evidence |
| `stretch_library` | warmup + mobility | id, name, **type (dynamic/static)**, target, when_to_use (pre/post/recovery), duration/reps, muscle_text, rationale |
| `plan` | periodized macro/meso | goal_race, phase, week_in_block, weekly_volume_target, intensity_distribution_target |
| `planned_session` | what the plan *wants* | date, modality, target spec, priority (A/B/C) |
| `preferences` | learned + explicit | rule, source (explicit/inferred), confidence, weight |
| `decision_log` | the agent's memory | date, recommended_session, rationale, readiness_at_decision, was_followed, athlete_override |

**The Session object** — an ordered list of **blocks** (`warmup → main → accessory → cooldown`), each holding **items**; each item references a library entry (inheriting muscle_text, how-to, images, rationale) plus prescribed params:

```
session
 └─ blocks[]
     └─ items[]
         ├─ ref     # exercise | plyo | prehab | stretch | run-interval
         ├─ params  # sets·reps·weight·RIR | contacts | duration | distance·pace·HR
         ├─ why     # contextual, coach-generated
         └─ status  # prescribed | done | skipped | edited
```

Run intervals, lifts, plyos, prehab, and stretches are all just *items* → one editor, one validator handle every modality.

**Load currency:** **session load = duration(min) × sRPE(0–10)**, cross-checked with Garmin TRIMP (runs) and contact-count (plyos) → a project-wide **ACWR** (7d:28d, ~0.8–1.3) and a daily **budget**.

**Anchors carry confidence.** Every derived training number (zones, paces, working loads, plyo tier) stores `source` (estimate / observed / confirmed) and `confidence`. This is what the intro ramp writes and then upgrades (§5).

---

## 4. Architecture overview

- **App:** the existing Next.js 14 dashboard, extended.
- **DB:** SQLite (`better-sqlite3` or Prisma).
- **Ingestion:** a **nightly job** pulls Garmin → `readiness_daily` + `activities`. **Never** call Garmin in a request path (§20) — read from your DB.
- **Garmin access:** `garmin-connect` (JS) for reading; **`python-garminconnect`** for **write-back** (structured running workouts to the watch).
- **Libraries:** one-time seed scripts import free-exercise-db + wger and your authored plyo/prehab/stretch JSON.
- **Intelligence:** **allocator** (deterministic TS — math + safety) + **Claude** (judgment, explanation, NL editing, preference synthesis). Safety logic in code, not the prompt.
- **Edit funnel:** one `applySessionPatch()` both the UI and Claude call, behind a deterministic validator (§11).

```
src/
  app/
    page.tsx                 # Today (the home screen)
    onboarding/              # ★ the intro ramp intake
    run/ strength/ plyo/ prehab/ stretch/ trends/
    api/ coach/ sync/
  lib/
    garmin.ts scoring.ts
    allocator.ts load.ts session.ts          # budget, currency, Session + applySessionPatch + validator
    calibration.ts                           # ★ anchors, confidence, graduation logic
    runEngine.ts strengthEngine.ts plyoEngine.ts prehabEngine.ts stretchEngine.ts
    preferences.ts
  data/ exercises.seed.json wger.seed.json plyos/prehab/stretch.seed.json
```

---

## 5. The Intro Ramp — onboarding & calibration (new)

The fastest way to lose trust, bore you, or hurt you is to mis-estimate where you are. The system must **start from honest, personalized anchors and converge as real data arrives.** Two parts: a one-time **intake** and a multi-week **calibration window**. The governing idea is **confidence, not certainty** — every anchor is labeled `estimate → observed → confirmed`, recommendations stay conservative until confidence is earned, and the coach says so.

### 5a. Part A — Onboarding intake (day 0, ~10–15 min)

A guided flow that sets anchors per modality. **Pull from Garmin where possible; ask only what's missing.**

**Running**
- **Resting & max HR** — from Garmin history if present; else Tanaka age-estimate, flagged low-confidence.
- **Threshold (LTHR) + Z2 ceiling** — from Garmin's lactate-threshold estimate, a recent race, or a guided **30-min time-trial** (avg HR of the last 20 min ≈ LTHR).
- **Training paces** — derive easy / threshold / interval paces from a recent race time via a **race-equivalency model** (Riegel, exponent ≈1.06, or Daniels VDOT); or from the field test; or self-reported easy pace as a floor.
- **Current weekly volume + longest recent run** — so the plan **ramps from where you actually are** (respecting ~10%/week), never jumping you to a big week.
- **Goal race + date** — sets periodization.

**Strength**
- For the **runner-relevant key lifts**, log recent working sets (weight × reps × RIR). Estimate working loads / e1RM via **Epley or Brzycki** from a **submaximal** set. **No max testing** — it's injurious and unnecessary.
- **Training age / experience** — sets progression rate and volume landmarks.

**Plyometrics**
- Self-assessment + which tier you've done before → **start one tier below claimed competence**; set a conservative starting contact count.

**Prehab / injury**
- Injury history, current niggles, known weak links → seeds prehab priorities and **load caps on affected tissue from day 1**.

**Optional guided field tests** (for users without recent data): a 30-min run TT (LTHR/threshold pace); a submaximal AMRAP at a known weight (e1RM); a quick movement screen (single-leg balance, ankle dorsiflexion, single-leg calf-raise count) for plyo/prehab readiness. Offer them; don't require them.

### 5b. Part B — The calibration window (≈ first 2–4 weeks)

- **Recovery baselines need time.** HRV/RHR baselines aren't trustworthy until ~2–3 weeks of overnight Garmin data exist (Garmin's own HRV status needs ~3 weeks). During this window recovery scoring leans on sleep + RHR and is labeled provisional. **If the watch already has weeks of history, backfill and shorten the window.**
- **Estimates self-correct from observed behavior.** Easy runs drifting above the assumed Z2 ceiling → lower the ceiling. Hitting 3×8 at RIR 4 when RIR 2 was targeted → raise the working weight. Long-run decoupling → calibrate durability. Each correction updates the anchor's *value* and raises its *confidence*.
- **Conservative posture.** The allocator caps ramp rate hard, defaults to the easier side of every range, and the coach says it out loud ("still learning your numbers — starting conservative, adjusting as real data lands").
- **Graduation.** When key anchors reach `observed/confirmed` and the recovery baseline is ready, the system flips to full confidence and tells you ("calibration done — I've got your numbers"). `calibration_state.graduated = true`.

### 5c. How it threads the existing design

No new subsystem. Intake writes `athlete_profile` anchors (with `source`/`confidence`) + `calibration_state` + optional `field_tests`. The calibration window is just the **daily loop running with a `calibration_state` flag** that tightens ramp caps and labels confidence; corrections flow through the same `edit_history`/`decision_log` learning machinery (§13). This directly answers "so it doesn't over/under-estimate where I'm at": you start from real anchors, and reality corrects them fast.

---

## 6. Subsystem 1 — Health & recovery (Garmin), the driver

~70% done in the dashboard. Add: persisted **history** (nightly), **7-day + long (28–60 day) baselines**, Garmin's **Training Readiness / Status** as a cross-check, and the four signals everything keys off — **recovery (today), HRV trend, ACWR, sleep debt.** Red rule: HRV down 3+ days, or RHR clearly elevated vs long baseline. Research anchors become explicit thresholds in `allocator.ts` (HRV-guided intensity, ACWR 0.8–1.3, sub-6h sleep degrades next day). During calibration, recovery scoring is provisional (§5b).

---

## 7. Subsystem 2 — Run recommendation engine

**Taxonomy (the menu):** Recovery, Easy, Long, Steady/MP, Tempo/Threshold, VO2 intervals, Reps/Strides, Progression, Fartlek, Hills — each a structured type with purpose, intensity (so the allocator can price it), and a target spec.

**Selection = research + moment:** (1) the plan picks the **intent** (periodization base→build→peak→taper; weekly mix governed by **80/20 polarized**, audited against your *actual* split). (2) Readiness picks the **form, with veto** (green = full; amber = trim/drop hardest rep, no stacked hard days; red = easy/rest, **move the long run before cutting it**). (3) Personalize paces from *your* calibrated anchors + recent data (threshold trend, pace-at-fixed-HR, long-run decoupling <5% = base building).

**Close the loop:** emit the session as a **structured workout** and push via `python-garminconnect` so the watch beeps you through it. Each interval is a Session *item* you/the coach can edit (§11).

---

## 8. Subsystem 3 — Strength tracker, library & recommender

**Logging:** per-set **weight + reps + RIR/RPE** → `set_logs`; show last-session numbers inline. RIR is the autoregulation key and the calibration signal (§5b).

**Library:** import free-exercise-db + wger → browsable/filterable, each rendered as a **card** (§12) with muscle image, muscle text, how-to, and a research **rationale/evidence** chip.

**Recommender:** support running without stealing its recovery. Encode **progressive overload** from history; **autoregulation** (red → deload/technique, green → push); **volume landmarks** (MEV→MAV→MRV) with **load-triggered** deload (§17); **runner-specific emphasis** (posterior chain, unilateral, calf–Achilles, hips, trunk; strength > hypertrophy); and **concurrent-training rules** (no heavy legs before a long run or VO2 day; if shared, run first or separate 6+ h; keep lifting away from the week's A-run). The allocator enforces; the engine exposes the cost.

---

## 9. Subsystem 4 — Plyometrics, prehab/PT & stretching

**Plyometrics:** carry **intensity + contact-load**. **Tiers:** foundational (pogos, ankling, low skips) → moderate (bounding, split-squat jumps, box jumps) → high (depth jumps, single-leg/reactive); store `prerequisites`. Dose in **ground contacts**, ramped with ACWR. **Placement:** quality/speed days when fresh, often a **primer before strides/VO2**; **not** the day before a long run, **not** on recovery days.

**Prehab / PT — coach-prescribed for a deficit:** rehabhero's **body_region × category** structure is the model. A **`niggle_tracker`**: you log "left Achilles, 3/10"; the coach matches `prehab_library` by region/`niggle_tags`, **inserts** the targeted protocol (eccentric heel drops for Achilles, hip-abductor for IT-band/knee, tibialis raises for shin splints), and **down-weights load** on the tissue (cap running, swap a hard day, watch 2–3 days). Routine prehab (calf raises, single-leg balance, glute-med, Nordics) is near-free in load terms — fit a small dose. A **return-to-run** ladder lives here. ⚠️ Medical-adjacent — educational only, conservative, escalate sharp/worsening/>~10–14 days (§15).

**Dynamic & static stretching:** dynamic **before** quality runs/lifts (warmup block); static **after** and on easy days (mobility block), kept *out* of pre-quality warmups (acute static stretching transiently cuts power). Both are Session items the coach places by context and you can edit.

---

## 10. The Claude layer — generate + edit + explain

**Division of labor:** deterministic code owns math + safety rails (load currency, ACWR, recovery banding, conflict resolution, volume landmarks, load ceiling, "never two hard days back-to-back," niggle down-weighting, calibration ramp caps). Claude owns judgment, synthesis, **per-exercise "why," natural-language editing,** and preference reasoning.

**Daily contract — input:** readiness (+trends), yesterday's actual, load/ACWR, this week's plan + phase + days-to-race, active preferences, any logged niggle, **calibration state**, and the allocator's costed candidate mix. **Output — fixed shape:**
```
1. READINESS: GREEN/AMBER/RED + the two numbers that decided it
2. TODAY: the Session — ordered blocks, concrete (paces / sets·reps·weight / contacts / holds)
3. WHY: one sentence overall; plus a per-item "why" on each card
4. CHANGED: vs the plan, or "no change"
5. WEEK: updated skeleton if anything shifted
6. FLAG: one line only if needed, else "nothing to action"
```

**Generate == edit:** generation produces a Session; an edit produces a **patch** to it. Same tool surface, same validator (§11). **Guardrails:** bounded authority (soften/move/reorder/swap within rules; the deterministic safety floor wins); always **overridable**; every decision + override → `decision_log` + `edit_history`; conservative bias when readiness or calibration is uncertain.

---

## 11. Bidirectional editing & the Session object (central)

Two ways to change the workout, **one funnel.**

- **Path A — Coach edit (NL → structured patch):** you type "make today easier," "only 30 min," "swap back squats for something gentler on my knee," "move the long run to Sunday." Claude gets the **current Session + readiness + plan + preferences + libraries** and returns a **structured patch** (remove/replace/modify/reorder, each with a reason). Shows a diff; you confirm; it applies.
- **Path B — Manual edit (UI):** tap an item to change sets/reps/weight/distance/holds; swap from the library; reorder/delete/add. Same object.

**Both call `applySessionPatch(patch)`,** behind the **validator**: checks against load ceiling, niggle constraints, concurrent-training rules, and calibration ramp caps. A rule-breaking change is **applied-with-a-flag** or **pushed back** ("this stacks 2 hard days — here's a safer version"), preserving your override. Writes to `edit_history` (actor, diff, reason). **Trust rules:** one canonical schema both paths mutate; every edit a **reviewable diff**; **versioned + reversible** (undo); identical validator for both actors. Your edits are also the personalization signal (§13).

---

## 12. Cards & per-exercise explanations

Every prescribed item renders as a **card** (strength / plyo / prehab / stretch):

- **Muscle image** — free-exercise-db / wger gallery or a highlighted diagram.
- **Muscle text (structured)** — `primary`/`secondary` muscles (and `target_tissue`/`body_region` for prehab) as **text fields**. This is the "text so the coach picks it up": images aren't reliably machine-readable, so the structured text is what the allocator and Claude reason over.
- **How-to** — concise steps + optional **video link** (rehabhero YouTube, linked — not copied).
- **The "why," two layers:** (1) static **`rationale`/`evidence`** on the library entry (authored once; an evidence chip); (2) contextual **`why`** the coach generates for *this* placement ("here today because you flagged Achilles 3/10 and volume ramped ~12% this week").
- **Prescribed params** + **edit/swap** affordances.

Run cards are the same idea (interval spec + target + "why"), minus the diagram.

---

## 13. Preference learning

Two streams into `preferences`, transparent and overridable: **explicit rules** ("no weights on weekends," "long run Sunday," "rest Monday," "no doubles") as hard constraints; **inferred patterns** from `edit_history` + `decision_log.was_followed` (skip Friday lifts → lower Friday priority; "easy" runs drift hot → get stricter; always swap VO2 when sleep <6h → pre-empt it). Keep inference **legible** (each learned rule shows a confidence and is surfaced for confirmation). Your edits are the training signal — which is why the single edit funnel (§11) matters.

---

## 14. The Today home screen

Not a dashboard. **One screen, one answer, editable in place:**

1. **Readiness band** — GREEN/AMBER/RED + the two deciding numbers + a plain-language line ("a bit run-down — keep it easy"). During calibration, a "still calibrating" note.
2. **One-line WHY** for today's shape.
3. **TODAY as an ordered card stack** — warmup → main → accessory/prehab → cooldown/stretch; each tappable (§12), each with its per-item "why."
4. **Talk-to-coach / edit bar** — text input that triggers a coach patch (§11-A) + per-card manual edit/swap (§11-B).
5. **"What changed vs plan"** — collapsible diff; "nothing to action" when nothing did.
6. **Quick log** — mark done; tap into sets/reps (auto for the run via Garmin).

Charts/trends live on a separate `/trends` page for the weekly review — never on the daily screen.

---

## 15. Disclaimer & safety

Visible, not buried: **first-run + persistent footer in prehab/niggle areas** — *"general training/educational information, not medical advice, diagnosis, or treatment; does not replace a qualified professional"* (mirrors rehabhero's own disclaimer). **Conservative defaults**; **escalation** for sharp/worsening/>~10–14-day issues (flag "see a professional," stop prescribing into that area); **no diagnosis language** (describe areas + general protocols, never name a condition); **bounded autonomy** (deterministic safety floor always wins; every auto-change visible and reversible).

---

## 16. Mock / scenario ("dev") mode

Promote the dashboard's mock-data fallback into an explicit, controllable mode so you can build/test **without live Garmin auth** and **without waiting for a real bad day**: a **toggle** (env flag/setting) that forces mock data, plus **scenario presets** (force GREEN/AMBER/RED, high ACWR, a logged niggle, a taper week, **and a mid-calibration state**). Why it's worth it: Garmin auth is your most fragile dependency (§20), bad-recovery days are rare, and you can't otherwise test the niggle/calibration/red-day paths reliably. Keep it ruthlessly — every feature works in mock mode first.

---

## 17. Other gaps (trimmed to your calls)

Removed per your decisions: fueling, menstrual-cycle, gear tracking, travel context, export. Kept/clarified:

1. **Load-triggered deload only** — no calendar cadence. Fires when **ACWR passes ~1.3–1.5**, **HRV trends down across days**, or **monotony/accumulated fatigue** crosses a line — and says *why*.
2. **Explainability surfaced** — the "why did this change?" diff (§11/§14).
3. **Niggle tracker** (§9) — entry point for coach-prescribed prehab.
4. **Mock/scenario mode** (§16) — build/test enabler.

---

## 18. Tying it together — the daily loop

1. **Overnight:** Garmin sync → `readiness_daily` + `activities`. On failure: serve stale + flag, never block.
2. **Readiness & budget:** recovery + HRV trend + ACWR + sleep debt → band + numeric ceiling. *(During calibration: provisional, conservative caps.)*
3. **Allocator proposes the day:** plan intent + budget + preferences + any niggle + concurrent-training rules → costed candidate mix, conflicts resolved by priority + safety.
4. **Claude composes the Session:** concrete ordered cards with paces/weights/reps/contacts/holds, a per-item "why," a plan diff, ≤1 flag.
5. **You see the Today screen and (optionally) reshape it** — "make it easier," swap, log a niggle → coach re-patches; or edit a card by hand. Every change validated + logged.
6. **(Optional) write-back** to the watch.
7. **You train; you log:** run auto via Garmin; sets/reps/RIR for lifts; mark plyo/prehab/stretch done. *(Early on, this is also calibration data correcting your anchors.)*
8. **Evening:** actual load recorded; `decision_log`/`edit_history` updated → tomorrow recalculates from reality; anchors upgrade confidence.
9. **Weekly (Monday):** review (volume, 80/20 audit, sleep/HRV trend, did A-sessions land); update mesocycle; refresh preferences; fire a deload **only if the load warrants it**; check calibration graduation.

---

## 19. Build plan (each phase ships something usable)

- **Phase 0 — Foundation:** clone the Garmin dashboard (mock data); import **ExerciseDB (GIFs) merged with free-exercise-db (mechanic/level/force)** into one `exercise_library`, + wger for gaps; author starter plyo/prehab/stretch JSON; design the schema incl. the Session object + anchor confidence. *Ship: dashboard + carded libraries with GIFs.*
- **Phase 1 — Readiness + the Intro Ramp:** nightly Garmin job → history; baselines, ACWR, four signals; **mock/scenario mode**; **onboarding intake + calibration window** writing confidence-tracked anchors. *Ship: a real "today's readiness," personalized to you, testable in every state.*
- **Phase 2 — Strength tracker:** set/rep/weight/RIR logging + history-aware progression; cards w/ muscle text + rationale. (Also feeds calibration.) *Ship: a usable lifting tracker.*
- **Phase 3 — Run engine:** taxonomy + periodization + readiness-gated selection + calibrated paces. *Ship: daily run recommendations.*
- **Phase 4 — Plyo, prehab, stretch:** catalogs + niggle tracker + contact-load + warmup/mobility placement. *Ship: the "sore area → prescribed exercise" flow.*
- **Phase 5 — Allocator + Session + editing:** budget/conflict engine, the Session object, `applySessionPatch()` + validator, the **Today screen**, coach generate. *Ship: the real product — one editable daily answer across all modalities.*
- **Phase 6 — NL editing, learning, write-back:** coach patches from natural language, preference inference from `edit_history`, structured-workout push to Garmin, load-triggered deload. *Ship: the agentic version.*

Phases 0–2 are mostly assembly. The product doesn't *exist* until Phase 5. Start dumb (a lookup-table allocator) and earn the intelligence.

---

## 20. Risks & constraints

- **Garmin auth is fragile** (401/403/429 in 2026; MFA edge cases). Persist tokens, auto-refresh, never auth in a hot path, cache hard, keep mock fallback, treat sync failure as stale-not-crash.
- **Strava 2026 terms** — why Garmin is primary (§1b).
- **Licensing** — free-exercise-db public-domain (safe); **wger CC-BY-SA** (attribute + share-alike if redistributing); **ExerciseDB GIFs commercially licensed** (Kaggle re-upload fine for personal use; for publishing, license exercisedb.io or self-host the OSS API); **rehabhero/muscleandstrength proprietary** (facts + links, don't host media). All fine single-user; the GIF/media licenses only bite if you publish.
- **Cold-start mis-estimation** — the exact thing the intro ramp (§5) exists to prevent; the mitigation is confidence-labeling + conservative ramp + fast self-correction, *not* pretending to precision early.
- **Medical/injury liability** — §15.
- **Scope creep is the #1 killer.** Ship Phases 0–2 as useful tools.
- **Single-user assumption** keeps it simple; multi-user changes auth/privacy/Strava-display a lot.
- **The agent making a bad call** — bounded authority, conservative bias, always-overridable, full `edit_history`.

---

## 21. The Council — five angles

### 🔴 The Contrarian — *"where does this die?"*
The fatal seam is still **a fragile data source feeding an autonomous, editing agent** — and v3 added the riskiest moment of all: **the cold start.** The first two weeks are when the system knows you least *and* is making first impressions. If the intake over-estimates your threshold by 15s/km, the coach prescribes a brutal first week, you bail, and it never learns better. The confidence-labeling is the right instinct, but it only works if the early posture is *aggressively* conservative and the coach is *honest* about uncertainty ("I might be wrong about this — tell me if it felt off"). Don't let calibration masquerade as precision. And the old warning stands: an editor where "make it easier" is one tap away will erode your 80/20 unless the validator pushes *up* too — flag chronic quality-dodging, not just overreaching.

### 🟡 The First-Principles Thinker — *"what are you really solving?"*
v3 names the real precondition: **the system's model of you must be true before its decisions can be.** Calibration isn't onboarding UX — it's the epistemics of the whole product. The cleanest framing: the system holds *beliefs* about you (paces, weights, zones), each with a confidence, and its job is to **act well under uncertainty and reduce that uncertainty fast.** That reframes the intro ramp from "a setup wizard" to "the first and most important learning loop," continuous with the daily one. Same machinery (`edit_history`, observed corrections), just higher learning rate early. Build it as *one* learning system with a decaying learning rate, not a separate wizard bolted on.

### 🟢 The Expansionist — *"what's bigger here?"*
The confidence-tracked anchors quietly create something rare: **a system that can tell you how sure it is and show its estimates getting sharper.** "Three weeks ago I guessed your threshold; I've now confirmed it 4s/km faster" is a *visible* intelligence most apps never expose. Pair that with the compounding `edit_history` and you have a coach with a memory *and* a calibrated sense of its own certainty — the two things human coaches take a season to develop. Show the user that arc and it's the differentiator. (And it generalizes: "act under uncertainty, calibrate fast, explain confidence" is the template far beyond running.)

### ⚪ The Outsider — *"I've never trained a day."*
The intro ramp is where you win or lose me in the first five minutes. If onboarding feels like a tax form, I quit before I see the magic. Make it feel like a coach getting to know me: ask for a recent race or a hard effort, not "enter your LTHR in bpm." And when it guesses, *say it's guessing* and let me correct it — that honesty is what makes me trust the parts I can't check. One more: tell me when calibration is *done*. I want the moment where it says "okay, I know you now" — that's when I'll feel like I have a coach, not a form.

### 🔵 The Executor — *"what do you do Monday morning?"*
Unchanged opening: clone the dashboard on mock data → de-risk Garmin auth (one real sleep pull) → import free-exercise-db → add set logging. **The intro ramp slots in after set-logging, because it reuses the same lift-logging UI** to capture working weights — build the logger first, then the intake is mostly a form over existing components. Don't gate the whole app behind a perfect intake: ship a 5-field minimal intake (goal, recent race or easy pace, weekly volume, a couple of working weights, any niggles), label everything low-confidence, and let the daily loop correct it. **Cut for v1:** field tests (offer later), e1RM math (start with logged working weights), watch write-back, preference inference. A minimal intake + conservative ramp + carded explanations is already the thing.

**The Monday test:** if your next move is "design the perfect intake form," you're stalling. It's `git clone`. The intake reveals itself once the logger exists.

---

## 22. Synthesis — the through-line

1. **Calibrate before you coach; treat early anchors as beliefs with confidence, and correct them fast.** The intro ramp is the first learning loop, not a wizard — same machinery as the daily one, higher learning rate.
2. **The Session is the product; editing it is the core verb;** generate and edit are one validated funnel; explanation is what makes the autonomy safe.
3. **Assemble Phases 0–2, ship a minimal intake, manual-edit before coach-edit, time-box the allocator, earn the rest.**

The reframe to carry into Claude Code: you're building **one decision, made daily, against one budget, toward one goal — personalized to your real numbers, explained exercise-by-exercise, and reshapeable in one sentence by either you or the coach** — with confidence-tracked anchors and a compounding `edit_history` as the assets that make the coach truly yours.

Start Monday with `git clone`.
