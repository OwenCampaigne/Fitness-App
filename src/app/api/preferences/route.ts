// ── /api/preferences ──────────────────────────────────────────────────────────
// Framework §13. The surface that keeps preference learning legible: what the
// system believes about you, where each belief came from, how sure it is, a
// yes/no on every one it worked out for itself — and, because a preference
// stated once is not true forever, what you used to believe and when it stopped.
//
// GET separates four lists deliberately. `active` are the rules that bind
// today, grouped by the scope they speak to. `pending` are beliefs the system
// has *not* acted on: inferences it drew, and rules it heard you state in
// conversation, each with the words it came from. `conflicts` are live rules
// that disagree — surfaced rather than silently resolved. `history` is the
// retired ones, dated, with what replaced them.
//
// Nothing moves from `pending` to `active` except by a POST from the athlete,
// which is what "never applied silently" means in practice — and confirming is
// also the only moment anything is retired, so a supersession is something the
// athlete does, not something that happens to them.

import { NextRequest, NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
import {
  activePreferenceRules,
  addExplicitPreference,
  confirmPreference,
  dismissPreference,
  findPreferenceConflicts,
  inferPreferences,
  gatherInferenceInput,
  preferenceEdge,
  preferenceScope,
  preferenceSubject,
  readPreferenceHistory,
  readPreferences,
  retirePreference,
  syncInferredPreferences,
} from '@/lib/preferences'
import type { StoredPreference } from '@/lib/preferences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function iso(date: Date | null | undefined): string | null {
  return date ? startOfDay(date).toISOString().slice(0, 10) : null
}

/**
 * Where a belief came from, in the terms the athlete would use.
 *
 * `source` is the §13 stream and stays what it was; this is the finer question
 * the library screen has to answer — did I type this, say it, or did the app
 * work it out? A quote is the tell: only a rule heard in conversation has one.
 */
function origin(pref: StoredPreference): 'stated' | 'typed' | 'inferred' {
  if (pref.source === 'inferred') return 'inferred'
  return pref.sourceQuote ? 'stated' : 'typed'
}

function view(pref: StoredPreference, bindingIds: Set<string>) {
  return {
    id: pref.id,
    label: pref.label,
    kind: pref.kind,
    scope: preferenceScope(pref),
    subject: preferenceSubject(pref),
    source: pref.source,
    origin: origin(pref),
    confidence: pref.confidence,
    confirmed: pref.confirmed,
    sourceQuote: pref.sourceQuote ?? null,
    statedOn: iso(pref.statedOn ?? null),
    confirmedAt: iso(pref.confirmedAt ?? null),
    supersededById: pref.supersededById ?? null,
    sampleSize: pref.sampleSize ?? null,
    // The rows it was drawn from, in words. §13: keep inference legible.
    evidence: pref.evidence ?? [],
    bindingToday: bindingIds.has(String(pref.id)),
  }
}

export async function GET() {
  try {
    const today = startOfDay(new Date())

    // Re-run inference on read so the list is current, then persist the drafts
    // as unconfirmed. `syncInferredPreferences` cannot produce a binding rule,
    // so this is safe to do on a GET.
    const signals = await gatherInferenceInput(today)
    await syncInferredPreferences(inferPreferences(signals))

    const [prefs, history] = await Promise.all([readPreferences(), readPreferenceHistory()])
    const bindingIds = new Set(
      activePreferenceRules(prefs, today).map((r) => String(r.id).split('-')[0]),
    )

    const pending = prefs.filter((p) => !p.confirmed)

    return NextResponse.json({
      active: prefs.filter((p) => p.confirmed).map((p) => view(p, bindingIds)),
      pending: pending.map((p) => ({
        ...view(p, bindingIds),
        // Confirming is what retires things, so what it would retire is shown
        // beforehand rather than reported after the fact.
        wouldSupersede: prefs
          .filter((o) => o.confirmed && preferenceEdge(o) === preferenceEdge(p))
          .map((o) => ({ id: o.id, label: o.label })),
      })),
      conflicts: findPreferenceConflicts(prefs),
      history: history.map((p) => ({
        ...view(p, bindingIds),
        retiredOn: iso(p.updatedAt ?? null),
      })),
    })
  } catch (err) {
    console.error('[/api/preferences GET]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to read preferences' }, { status: 500 })
  }
}

/**
 * Four actions, one route:
 *   · `{ text }`         — state an explicit rule in your own words. Binds now.
 *   · `{ confirm: id }`  — accept a pending rule; only now does it bind, and
 *                          only now is anything it replaces retired.
 *   · `{ retire: id }`   — this is no longer true. Kept as history, not deleted.
 *   · `{ dismiss: id }`  — never was true; drop it entirely.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { text?: unknown; confirm?: unknown; dismiss?: unknown; retire?: unknown }
      | null

    if (typeof body?.confirm === 'number') {
      const result = await confirmPreference(body.confirm)
      if (!result) return NextResponse.json({ error: 'No such preference.' }, { status: 404 })
      return NextResponse.json({
        preference: result.preference,
        superseded: result.superseded.map((p) => ({ id: p.id, label: p.label })),
        confirmed: true,
      })
    }

    if (typeof body?.retire === 'number') {
      const retired = await retirePreference(body.retire)
      if (!retired) return NextResponse.json({ error: 'No such preference.' }, { status: 404 })
      return NextResponse.json({ preference: retired, retired: true })
    }

    if (typeof body?.dismiss === 'number') {
      const removed = await dismissPreference(body.dismiss)
      if (!removed) return NextResponse.json({ error: 'No such preference.' }, { status: 404 })
      return NextResponse.json({ dismissed: true })
    }

    if (typeof body?.text === 'string') {
      const created = await addExplicitPreference(body.text)
      if (!created) {
        // Refusing to guess is the right answer here: a mis-parsed preference
        // silently deletes work you wanted.
        return NextResponse.json(
          {
            error:
              'That is not a rule this understands yet. Try the shape of "no weights on weekends", ' +
              '"rest Monday", "long run Sunday", "no doubles" or "no burpees".',
          },
          { status: 422 },
        )
      }
      return NextResponse.json({
        preference: created.preference,
        superseded: created.superseded.map((p) => ({ id: p.id, label: p.label })),
      })
    }

    return NextResponse.json(
      { error: 'Send { text }, { confirm: id }, { retire: id } or { dismiss: id }.' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[/api/preferences POST]', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Unable to update preferences' }, { status: 500 })
  }
}
