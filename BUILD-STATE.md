# Build state — read this first

**Last updated:** 2026-09-16 · by an autonomous Claude Code session on the laptop
**Target:** Phases 4, 5 and 6 — the rest of `RUNNING-ON-AI-Framework.md` §19

This file is the hand-off between sessions. A fresh session with no memory of the
previous one should be able to read this and resume without asking anything.

---

## Where things stand

| Phase | State | Evidence |
|---|---|---|
| 0 — Foundation | **Done** | 16 Prisma tables, 873 exercises seeded, plyo/prehab/stretch catalogs, `/exercises` browser |
| 1 — Readiness + Intro Ramp | **Done** | `src/lib/readiness.ts`, `/api/sync`, `/api/readiness`, scenario presets, onboarding, GREEN/AMBER/RED home screen |
| 2 — Strength tracker | **Done** | `src/lib/strengthEngine.ts` + `strengthSession.ts`, `/strength`, 4 API routes |
| 3 — Run engine | **Done** | `runEngine.ts` + `runAnalysis.ts` + `runSession.ts`, `/run`, 3 API routes |
| 4 — Plyo / prehab / stretch | **Done** | `plyoEngine.ts`, `prehabEngine.ts`, `stretchEngine.ts`, `movementSession.ts`, `niggle_log`, `/niggle` |
| 5 — Allocator + Session + editing | **Done** | `load.ts`, `allocator.ts`, `session.ts`, `sessionStore.ts`, `todaySession.ts`, the Today screen, 8 API routes |
| 6 — NL editing, learning, write-back | **Done** | `coach.ts`, `preferences.ts`, `deload.ts`, `garminWorkout.ts`, `/api/coach`, `/api/preferences` |

**Gates, verified 2026-09-16:** `npx jest` 1163 tests / 26 suites green ·
`npx tsc --noEmit` clean · `rm -rf .next && npx next build` clean, 22/22 pages.

**Current scope:** all six phases are built. What remains is the list below —
polish and wiring on a working system, not missing phases.

---

## Bootstrap for a fresh session

The cloud container is ephemeral — none of this survives between sessions.

1. **Check the device bridge.** The repo lives on the user's laptop at
   `C:\Users\OwenCampaigne\OneDrive - Rensselaer Polytechnic Institute\Fitness App\garmin-health-dashboard`.
   Call `mcp__remote-devices__get_device_info`. If `connectedFolders` is empty or
   the call fails, the laptop is offline — **stop and report**, do not guess at
   the code from memory.

2. **Snapshot it into the container.** On the device:
   ```
   cd "$HOME/mnt/Fitness App/garmin-health-dashboard"
   mkdir -p "$HOME/mnt/Fitness App/_incoming"
   tar --exclude=node_modules --exclude=.next --exclude=.swc \
       --exclude=tsconfig.tsbuildinfo \
       -czf "$HOME/mnt/Fitness App/_incoming/repo-snapshot.tar.gz" .
   ```
   Then `device_stage_files` that tarball and extract it to `/home/claude/roa`.
   Run `git config --global --add safe.directory /home/claude/roa`.

3. **Install and verify green.**
   ```
   npm install --no-audit --no-fund
   npx jest                       # expect all green
   npx tsc --noEmit
   npx tsx scripts/seed-dev.ts --strength --reset
   npx next dev --port 3030       # background it
   ```
   `npx prisma generate` **fails** in this container — the engine binaries 403.
   It is not needed: the generated client is committed at `src/generated/prisma`.

4. **Read, in order:** `RUNNING-ON-AI-Framework.md` (the master spec),
   `CLAUDE.md`, then the newest spec in `docs/superpowers/specs/`.

---

## Syncing work back to the laptop

**Git writes do not work through the device bridge.** `device_bash` cannot unlink
files, and git needs to remove `.git/index.lock` — every write operation fails
partway and leaves a stale lock behind. Do not try `git pull`, `git commit`, or
`git checkout` on the device.

What works:

1. Commit in the container (`/home/claude/roa`) so history and messages are kept.
2. `git archive --format=tar.gz -o /home/claude/out.tar.gz HEAD $(git diff --name-only --diff-filter=d <base> HEAD | tr '\n' ' ')`
3. `SendUserFile` the tarball → `device_commit_files` it to `Fitness App/_incoming/`
4. On the device, extract it: `tar xzf` creates new files fine but **cannot
   overwrite existing ones** (again, no unlink). For files that already exist,
   extract to a staging dir and `cat staged > target` — a truncating write, which
   is permitted.
5. If a stale `.git/index.lock` appears, `mv` it into `Fitness App/_to_delete/`.
   The user has to empty that folder themselves.

The laptop's git tree will show the changes as uncommitted. That is expected —
the user commits on their side. Container commit hashes are the source of truth
for *what* changed and why.

---

## Workspace layout

The folder was reorganised on 2026-08-20. Each repo used to sit two levels deep
(`garmin-health-dashboard-1.1.0/garmin-health-dashboard-1.1.0/`); they are now
one level down under shorter names.

```
Fitness App/
  garmin-health-dashboard/          ← the live app. This is the repo.
  strava-mcp/                       ← shelved per framework §1b
  customized-workout-generator/     ← schema inspiration only
  archive/                          ← the three original source zips
  docs/                             ← superpowers specs and plans
  RUNNING-ON-AI-Framework.md        ← the master spec
  running-on-ai-iceberg-guide-1-1.pdf
  _to_delete/                       ← see below
  _incoming/                        ← created on demand for transfers
```

**`node_modules` is gone from the repo** — it was moved to
`_to_delete/build-artifacts/` so OneDrive stops syncing half a gigabyte of
dependencies. Run `npm install` in `garmin-health-dashboard/` before
`npm run dev`. `.next` and `.swc` went the same way and rebuild themselves.

Consider adding `node_modules` to OneDrive's excluded folders (Settings → Sync
and backup → Manage backup → Advanced) so it never syncs again — the Phase 0
spec §1.3 called for this and it was never done.

## Housekeeping the user should do

`Fitness App/_to_delete/` holds everything safe to remove. The device bridge
cannot delete files, only move them, so it accumulates rather than clearing
itself. Contents:

- `build-artifacts/` — node_modules, .next, .swc from the app. Rebuilt by
  `npm install`. This is the large one.
- `empty-*` — the husks of the three doubled folders after un-nesting.
- `incoming/`, `pre-phase2-backup/`, `repo-snapshot.tar.gz` — session transfer
  scratch.
- `index.lock.*` — a stale git lock from a failed bridge write.

---

## Decisions already made — do not relitigate

- **Garmin, not Strava.** Framework §1b. `strava-mcp-main/` stays shelved.
- **Mock/scenario mode first.** Every feature works against presets before live
  data. `SCENARIO` drives readiness, `STRENGTH_SCENARIO` drives lifting history.
- **Safety in code, not prompts.** Deterministic TypeScript owns math, load
  ceilings, and contraindications. Claude gets judgment and explanation.
- **The Session object shape is fixed** (`src/types/session.ts`). Phases 3–5 add
  item kinds to it; they do not restructure it.
- **Post-surgical clearance is never invented.** With none entered the engine
  takes its most conservative posture and says on screen that clearance comes
  from a surgeon or PT. This is not a placeholder to be filled in with a guess.
- **No Garmin credentials are wired in yet, by choice.** See `GARMIN-SETUP.md` —
  going live is meant to be a one-step switch for a Forerunner 965.

---

## What is left, in priority order

All of this is polish on a working system. None of it blocks using the app.

1. **Day-scoped preferences never bind.** `preferences.ts` resolves rules like
   "no weights on weekends" via `activePreferenceRules(prefs, date)`, but
   `toPreferenceRule` in `todaySession.ts` is date-blind, so `gatherToday` maps
   rows without consulting the day. They are stored inert on purpose — storing
   them as binding would apply a weekend rule on a Tuesday. Two-line fix.
   Note `PreferenceRule` cannot express "long run Sunday" or "no doubles" at all.

2. **Plyo quality still round-trips through `set_logs.notes`.** The real columns
   now exist (`cleanExecution`, `sorenessNextDay`, added 2026-09-16 and pushed),
   but `groupPlyoHistory` in `movementSession.ts` still reads the legacy tagged
   prefix `[plyo clean=yes soreness=2]`. Move it onto the columns and keep
   `decodePlyoQuality` as a fallback so already-written rows still parse.

3. **`BottomNav` is seven tabs.** Fits `max-w-md` but is crowded. `/exercises`
   is the obvious demotion.

4. **No route-handler tests outside `/api/coach`.** The pure layer is covered
   heavily and the DB layer was exercised by hand, but the other routes are
   untested. "Thin" is not "tested".

5. **A niggle under the caution threshold still allows plyos on that tissue.**
   Seen in `MOVEMENT_SCENARIO=niggle_achilles`: Split-Squat Jumps lands on a day
   with a flagged Achilles because `screen()` only down-weights at that severity.
   Pre-existing in the niggle rails; worth a look, not obviously wrong.

## Post-Phase-6 work — done 2026-09-17

Four agents, all green (1326 tests / 31 suites, tsc clean, build clean).

1. **Preference graph** (`preferences.ts`, `coach.ts`, `/preferences`). Chat
   statements become structured preferences. Supersession is first-class:
   `scope`+`subject` are derived from the rule shape, polarity deliberately
   excluded, so "no weights on weekends" and "weights on weekends" retire each
   other rather than stacking. A model-extracted quote must appear verbatim in
   the athlete's own message or the candidate is dropped. Chat-extracted rules
   are stored unconfirmed **because supersession fires on binding** — an
   auto-bound passing remark would silently retire a rule the athlete chose.

2. **Rehab stage machine** (`rehabStage.ts`, `/api/clearance/stage`).
   `unknown → restricted → progressing → graduated → unrestricted`. The engines
   are byte-for-byte unchanged: the stage folds into `RecoveryContext` on read.
   Self-report is clamped to `graduated` (never `unrestricted`), loaded pivot
   stays shut, and the ladder caps at 10 min rather than lifting. The derived
   context must never be written back to the column — read and write paths are
   split for exactly that reason.

3. **Week-ahead scheduling** (`weekPlan.ts`, `/week`, `/api/session/{week,move}`).
   Rolling 7 days. Days are persisted in order so day N+1's context sees day N,
   which makes every cross-day rail bite without a single new rule. Edited days
   are never regenerated; untouched future days always are.

4. **History and dated PRs** (`records.ts`, `recordsStore.ts`, `/trends`
   History tab). `recordCurrency` decays a record by age with per-metric
   half-lives; `temperedTarget` blends it against a fallback. **Exposed and
   tested but deliberately not wired into the engines** — letting an old PR vote
   on today's prescription is a coaching decision, not a refactor.

### Fixed in the same pass
- `scripts/seed-dev.ts` wrote `trimp: null` on all 20 activities, so 28 days of
  history computed to zero load, the budget cold-started, and every day after
  today got a ceiling of 0 — `/week` read "danger" when it meant "no data".
  Now seeds Bannister TRIMP (avg 157).
- `/exercises` lost its nav tab and was unreachable; linked from `/strength`.
- `/trends` lost its tab too; linked from the `/week` header.

### Known, deliberate gaps
- `temperedTarget` not wired into `strengthEngine` / `runEngine`.
- Per-day undo on `/week` undoes one day; a *move* spans two. The review panel's
  undo handles both, the per-day button does not — a general fix needs an
  `edit_history` column linking the pair.
- `lastAppliedOn` on `preferences` is never written; the UI computes "binding
  today" live from `activePreferenceRules` instead.
- Day-scoped preferences now bind; "long run Sunday" and "no doubles" remain
  inexpressible in `PreferenceRule` and stay visible-but-inert.

## Visual design — "the training log" (2026-09-17)

The app was styled as a dashboard, which contradicts framework §14 ("not a
dashboard — one screen, one answer"), and sat squarely in the generated-design
cluster: near-black ground, identical `rounded-2xl` cards, and a `.card-header`
that was literally `tracking-widest uppercase`.

**The system lives in `tailwind.config.ts` + `src/app/globals.css`.** One idea
carries it: **ink is measured, pencil is estimated**. `.measured` and
`.estimated` are wired to real provisional state, not chosen for looks —
`ReadinessBand` picks between them from `result.provisional`, a prescription
renders as pencil and a logged set as ink. Do not use `.measured` to make a
screen look more confident; that inverts the product's whole posture.

- Palette: `paper` `wash` `rule` `ink` `pencil` `faint`, plus `ready`/`caution`/
  `stop` **reserved for the readiness verdict and safety flags only**.
- Type: Literata (the coach's voice — headings, prose, marginalia) and Atkinson
  Hyperlegible (your entries — sets, paces, loads; chosen for legibility at 6am
  one-handed outdoors). Two families, no third.
- Structure: `.entry` ruled rows, not cards. `.block-label` hangs in the margin.
  `.marginalia` carries the coach's "why". Radius 0–3px.
- Dark follows `prefers-color-scheme`; `.dark` still forces it.

Applied across all 13 pages. Zero `rounded-2xl` or `tracking-widest` remain.

### Fixed in the same pass
- **i18n painted raw keys on every cold load.** `messages` started as `{}` and
  filled in an effect, so the server render and first paint showed `nav.home`
  and `today.loading`. Now seeded with the bundled `en` locale. Default locale
  and `<html lang>` moved from `es` to `en`.
- Nav went from seven crowded tabs to six, with `/preferences`, `/trends` and
  `/exercises` linked from `/profile`, `/week` and `/strength`. Nothing is
  orphaned — verify that before changing the nav again.

## Scope change — 2026-09-18, agreed with Owen

The framework describes a **running** app: strength exists to support the run
(§8), and the whole thing is organised around post-surgical knee rehab. That
was correct when it was written. It is no longer what this athlete needs, and
the code is diverging from the spec **deliberately** — not drifting.

**What changed and why:**

1. **Push / pull / legs, not runner accessories.** `key-lifts.json` held 20
   lifts and every one was lower-body or trunk — no bench, no row, no press.
   So every session the allocator produced was legs, correctly, from a catalog
   that could not produce anything else. Squat, bench and deadlift are now the
   benchmark anchors, with running and prehab woven into the split.

2. **Rehab is context, not the spine.** Owen is through rehab. The ladder,
   clearance gating and stage machine all stay and still behave identically —
   they are right for someone in rehab and §15 still binds. What changed is
   prominence: a free-text injury history the athlete brain-dumps into, fed to
   the coach as *context* rather than parsed into rules, because extracting
   constraints from prose is how you get a confident wrong answer about
   someone's knee. Anything that gates training still comes from clearance or
   a logged niggle.

3. **The coach was invisible.** It rendered at the bottom of the Today screen
   below the whole card stack and read as furniture. It is the headline Phase 6
   feature and the athlete could not find it.

**If you are a future session reading `RUNNING-ON-AI-Framework.md`:** §8's
"strength for runners" framing is superseded. The safety architecture, load
currency, edit funnel and honesty principles are all unchanged and still
authoritative.

## Phase 7 — scoped, not started

Added 2026-09-17. Full scope: `docs/superpowers/specs/2026-09-17-phase7-catalog-enrichment-scope.md`

Three workstreams on top of the finished system: enrich `exercise_library` from
further databases (wger is named in §1d and was never pulled); build a
video-analysis skill that *watches* a physical-therapy video library and turns it
into `prehab_library` / `plyo_library` rows with real progressions; and embed
those videos as playable tutorials on the cards instead of bare links.

**Blocked on an input:** the source website URL was never supplied. Presumed
rehabhero.ca per framework §1d, unconfirmed.

**Licensing is settled, not a blocker.** §1d says "Link/**embed** their YouTube;
author your own cues. Don't copy text or host media." An iframe hosts nothing, so
embedding is the sanctioned path; downloading and re-serving is not. `video_url`
already exists on both library tables and is currently all null.

## Known environment issues

- **OneDrive breaks `next build` and `next dev`** with
  `EINVAL: readlink .next/package.json` whenever a stale `.next` exists.
  `rm -rf .next` first, every time. Consider excluding the folder from sync.
- **The four `next/og` icon routes are gone.** They could never build on
  Windows: `@vercel/og` does `fileURLToPath(join(import.meta.url, …))` at module
  top level, and `path.win32.join` mangles the `file://` URL. Icons are now real
  PNGs in `public/`, regenerated deterministically by
  `npx tsx scripts/generate-icons.ts`.

## Open questions for Owen

- **Goal race: intentionally blank — settled 2026-09-17.** Owen's goal is
  staying healthy and in good shape, not a target time. The open-ended
  `return_to_run` block with no end date is therefore the *correct* permanent
  state, not a gap. Do not prompt for a race date again.
- **What is his actual cleared segment length right now?** The clearance form
  exists now (`/profile`), but nothing has been entered. Until it is, the run
  ladder offers no rung and the strength engine holds its most conservative
  posture — correct, but permanently pessimistic.
- **Credentials.** No `ANTHROPIC_API_KEY` (the coach returns 503 and says so)
  and no Garmin credentials or OAuth tokens (everything runs on mock/scenario
  data). Both are one-line `.env.local` entries; see `GARMIN-SETUP.md`.
- **The Garmin write-back has never run.** `toGarminWorkout` is pure and covered
  by 36 tests, but the endpoint and enum ids are unverified against a live
  account. Gated behind `GARMIN_WORKOUT_PUSH=1`. Treat the first push as a test.
