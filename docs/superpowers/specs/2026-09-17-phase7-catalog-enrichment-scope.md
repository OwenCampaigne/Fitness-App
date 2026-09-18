# Phase 7 — Catalog enrichment & embedded video tutorials (SCOPE ONLY)

**Status:** scoped, not started. Added 2026-09-17 at Owen's request.
**Source:** https://www.youtube.com/@suarezsportandorthopedicph7348/videos
(Suarez Sport and Orthopedic Physical Therapy) — surveyed 2026-09-17, see §3a.

Phases 0–6 are built and green. This is new scope on top of a working system.

---

## 1. Goal

Three related things:

1. **Enrich the exercise catalog** from additional databases beyond
   free-exercise-db (873 seeded) and the authored plyo/prehab/stretch JSON.
2. **Analyse a physical-therapy video library** — watch the videos, not just
   read the titles — and turn them into `prehab_library` / `plyo_library`
   entries with real progressions.
3. **Embed the videos in the app** as playable tutorials on the exercise cards,
   not bare links.

---

## 2. The licensing line, and why it is not a blocker

Framework §1d, on rehabhero.ca: *"**Link/embed their YouTube**; author your own
cues. Don't copy text or host media."* §12: *"optional video link (rehabhero
YouTube, **linked — not copied**)."* §20: *"proprietary (facts + links, don't
host media)."*

So the split is:

| Allowed | Not allowed |
|---|---|
| Embedding the **YouTube player** (iframe / `youtube-nocookie`) | Downloading the video and re-serving it from `public/` or a CDN |
| Storing the **video id / URL** in `*_library.video_url` | Storing extracted frames or clips as app assets |
| **Facts**: exercise name, body region, target tissue, progression order | Copying their written descriptions or cue text verbatim |
| **Our own** cues, authored from what the video shows | Presenting their text as ours |

"Embed the whole video" as Owen asked for is the *sanctioned* path — it is
`host media` that is prohibited, and an iframe does not host anything. The
analysis pipeline (§4 below) may fetch frames and transcripts **transiently** to
author our own cues; it must not persist them as redistributable assets.

`video_url` columns already exist on `plyo_library` and `prehab_library` and are
currently all `null`. No schema change is needed to hold the ids.

---

## 3a. Source survey — measured, not estimated (2026-09-17)

Enumerated with `yt-dlp --flat-playlist` (no API key, no download).

| Measure | Value |
|---|---|
| Videos | **653** |
| Total runtime | 774 min (~13 h) |
| Median length | **46 s** · mean 71 s |
| Under 60 s | **71%** (460) · under 120 s: 93% |
| Over 5 min | 4% (24) |
| Captions | **~50%** — many are silent demos, so **vision is mandatory**, not a fallback |
| Title length | 3.9 words mean — terse but domain-precise |

These are single-exercise demo clips, which is the cheap case: a 46-second clip
is characterised by a handful of sampled frames, not a full transcript pass.

**Titles already encode progressions**, which is the thing worth having:
"Wall Sit - Varying Progressions", "Box Squat - Varying Progressions",
"Calf Raise - Double & Single Leg", "KB RDL - to box for modified range",
"Russian Lunge (Stick)" vs "(Fast)".

**Top terms:** banded (73), hip (71), squat (50), shoulder (39), rotation (35),
single (34), extension (33), leg (32), wall (31), hamstring (24), stretch (24).

**Direct relevance to this athlete.** The catalog is thick with post-operative
knee rehab — `SLR- with NMES`, `Quad Setting - with NMES`, `TKE`, `Heel Slide`,
`4-Way SLR`, `Knee to Wall`, `Heel Elevated Bridge`. That is precisely the
region where `prehab_library` is thinnest (15 authored entries total) and where
the clearance gating is most conservative. This is the highest-value slice and
should be ingested first, ahead of the shoulder work, which this app does not
currently prescribe into at all.

**Tooling.** `yt-dlp` is installed (2026.08.19, via pip, user scripts dir not on
PATH — invoke as `python -m yt_dlp`). **`ffmpeg` is NOT installed** and is
required for frame sampling.

## 3. Workstream A — more exercise databases

Evaluate and, where the licence allows, ingest:

- **wger** (wger.de REST API) — ~845 exercises, CC-BY-SA. Already named in
  §1d as the secondary supplement; never actually pulled. Attribution +
  share-alike required if redistributed; fine single-user.
- **ExerciseDB** — GIF-per-exercise. Commercially licensed; the Kaggle
  re-upload is fine for personal use. Framework §20 already flags that this
  one only bites on publication.
- Candidates to assess, licence first: Open Fitness / exercemus-style open
  datasets, and any OSS self-hostable ExerciseDB API.

Deliverable: a merge pass into `exercise_library` that **de-duplicates against
the 873 already seeded** rather than appending near-identical rows, keyed on
normalised name + primary muscle + equipment. Every row keeps its `source`.

## 4. Workstream B — a video-analysis skill

There is no stock skill that "watches" a video. This has to be built:

1. Resolve the catalog — enumerate the source site's exercises and their
   YouTube ids (respect `robots.txt` and rate limits).
2. Pull the **transcript/captions** where available (cheap, high signal).
3. Sample **frames** at intervals for the vision pass (expensive; this is the
   cost driver — see the estimate).
4. Vision + transcript → structured fields: body region, category
   (stretch / strengthen / mobility / stability / proprioception), target
   tissue, `niggle_tags`, equipment, **progression tier and prerequisites**,
   and **our own authored cues**.
5. Gate every generated string through `containsDiagnosisLanguage`
   (`src/lib/prehabEngine.ts`) — §15 applies to this text exactly as it applies
   to engine and model output today.
6. Human review queue. These are medical-adjacent prescriptions; an
   auto-generated tier that is wrong is a load ceiling that is wrong.

Packaged as an installable skill so it can be re-run when the source updates.

## 5. Workstream C — progressions

The real prize. The source is described as having *progressions*, which is
exactly what `plyo_library.progressionTier` / `prerequisites` and
`isPlyoUnlocked()` already consume — currently populated from 12 hand-authored
plyos. A richer, evidence-ordered ladder feeds straight into the existing
`plyoEngine` gating with no engine change.

## 6. Workstream D — embedded tutorials in the app

- A `<VideoEmbed>` component using `youtube-nocookie.com/embed/<id>`, lazy
  (click-to-load facade, so the PWA does not pull YouTube JS on every card).
- Wire into `ExerciseCard`, `PlyoCard`, `PrehabCard`, `StretchCard` and the
  Today screen's `SessionItemCard`.
- Must not regress the §15 rules already enforced: no diagnosis language, the
  disclaimer renders wherever prehab content does.
- Offline/no-network and "video unavailable" states — the PWA works offline
  today and a dead embed must not break a card.
- CSP / `frame-src` allowances in `next.config.mjs`.

---

## 7. Open inputs

1. **Does this stay single-user?** Every licence involved is comfortable for
   personal use and several change materially on publication (§20).
2. **Review appetite for workstream C.** 653 entries is a lot to eyeball. A
   sane compromise is to review only what the engine can *gate* on — tier and
   prerequisites — and accept generated cues unreviewed.
