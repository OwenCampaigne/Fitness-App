// ── POST /api/coach ───────────────────────────────────────────────────────────
// Framework §11-A: "make today easier", "swap back squats for something gentler
// on my knee", "only 30 minutes". One sentence in; a **diff you confirm** out —
// or an honest refusal.
//
// §11-A is one sentence and its last clause is the whole trust model: "returns
// a structured patch … shows a diff; you confirm; it applies." So preview is
// what this route does by default and applying is the opt-in (`apply: true`),
// not the other way round. An AI edit that landed first and offered undo
// afterwards gave the athlete's own taps a confirmation step the coach's did
// not — which inverts the thing the design rests on.
//
// The preview is a real verdict, not a rehearsal: the full pipeline runs,
// `validateSessionPatch` included, so a push-back and its counter-proposal are
// visible *before* anything moves. What the preview is not is a permit. It
// records nothing and grants nothing; the confirmation posts the same patch to
// `/api/session/patch` with `actor: 'coach'` — the same funnel the Today
// screen's tap uses — and is judged again there against the session as it is at
// that moment, which may have moved: another edit, a deload, a completed day.
//
// The rest of the safety story is what this route does *not* contain. There is
// no branch that writes `blocksJson`, no branch that skips the validator, and
// no retry loop. A push-back is reported with its counter-proposal and nothing
// is applied; it is not re-asked, re-prompted, or overridden on the model's
// behalf. Only the athlete can set `override`, and only on their own next
// request.
//
// Order matters too: the deterministic deload (§17) is evaluated and applied
// *before* the model is asked anything, so the coach explains the session the
// rails have already settled rather than negotiating with them (§18 steps 2–4).

import { NextRequest, NextResponse } from 'next/server'
import { startOfDay } from 'date-fns'
import {
  MAX_COACH_TEXT,
  formatCoachReply,
  gatherCoachContract,
  previewCoachPatch,
  proposeFromText,
} from '@/lib/coach'
import { applyDeloadIfWarranted } from '@/lib/deload'
import { captureStatedPreferences, checkPreferenceViolations, readPreferences } from '@/lib/preferences'
import { applyPatchToSession, readEditableSession } from '@/lib/sessionStore'
import { ensureToday, todayValidationContext } from '@/lib/todaySession'
import { DISCLAIMER } from '@/lib/prehabEngine'
import type { SessionItem } from '@/types/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { text?: unknown; apply?: unknown }
      | null
    const text =
      typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_COACH_TEXT) : ''

    // §11 says confirm-then-apply, so applying is the opt-in. Anything that is
    // not literally `true` — absent, false, a string, a stale client — previews.
    const apply = body?.apply === true

    const today = startOfDay(new Date())

    // The session has to exist before anything can patch it. `ensureToday` also
    // hands back the gathered day, so the contract is built from one pass over
    // the engines rather than two.
    const gathered = await ensureToday(today)

    const context = await todayValidationContext(today)

    // §17 — load-triggered, through the same funnel, before the coach speaks.
    // The rails settle the day; the coach then explains what they settled
    // (§18 steps 2–4), rather than negotiating with them.
    const deload = await applyDeloadIfWarranted(today, context)

    const session = deload.applied && deload.session
      ? deload.session
      : await readEditableSession(today)
    if (!session) {
      return NextResponse.json(
        { error: 'No session for today yet.' },
        { status: 404 },
      )
    }
    if (session.status === 'completed') {
      return NextResponse.json(
        { error: 'Today is already logged as complete — it is history now, not a plan.' },
        { status: 409 },
      )
    }

    const contract = await gatherCoachContract(today, session, gathered)

    const proposal = await proposeFromText(contract, session, text)

    // ── The coach could not be asked ─────────────────────────────────────────
    if (!proposal.ok && (proposal.code === 'no_api_key' || proposal.code === 'api_error' || proposal.code === 'network_error')) {
      return NextResponse.json(
        {
          reply: proposal.message,
          available: false,
          reason: proposal.code,
          patch: null,
          verdict: null,
          diff: null,
          applied: false,
          deload: deloadSummary(deload),
          disclaimer: DISCLAIMER,
        },
        { status: proposal.code === 'no_api_key' ? 503 : 502 },
      )
    }

    // ── The coach answered out of contract ───────────────────────────────────
    if (!proposal.ok) {
      return NextResponse.json(
        {
          reply: proposal.message,
          available: true,
          rejected: proposal.code,
          patch: null,
          verdict: null,
          diff: null,
          applied: false,
          deload: deloadSummary(deload),
          disclaimer: DISCLAIMER,
        },
        { status: 422 },
      )
    }

    const { reply, patch } = proposal

    // ── What you said in passing gets kept (§13) ─────────────────────────────
    // Stored unconfirmed, so it changes nothing about today and cannot retire
    // an older rule on the model's say-so; it appears on /preferences with the
    // quote it came from, and the athlete decides. `captureStatedPreferences`
    // swallows its own failures on purpose — an edit that would otherwise apply
    // must not be lost because a side-channel write went wrong.
    const captured = (await captureStatedPreferences(proposal.preferences, today)).flatMap((o) =>
      o.status === 'stored'
        ? [
            {
              id: o.preference.id,
              label: o.preference.label,
              quote: o.preference.sourceQuote ?? null,
              // Named before anything is retired, never after.
              wouldSupersede: o.wouldSupersede.map((p) => ({ id: p.id, label: p.label })),
            },
          ]
        : [],
    )

    // ── An explicit rule is a constraint, not a suggestion (§13) ─────────────
    // The model was told the preferences and can still propose past one, so the
    // rules are checked against the *result* rather than trusted to the prompt.
    const prefs = await readPreferences()
    const added: SessionItem[] = patch.ops.flatMap((op) =>
      op.op === 'add' || op.op === 'replace' ? [op.item] : [],
    )
    const addedViolations =
      added.length === 0
        ? []
        : checkPreferenceViolations(prefs, today, [
            { id: 'coach-proposed', kind: 'main', label: 'Proposed', items: added },
          ])
    if (addedViolations.length > 0) {
      return NextResponse.json(
        {
          reply: `${formatCoachReply(reply)}\n\nNot applied: ${addedViolations[0].message}`,
          available: true,
          rejected: 'preference_violation',
          capturedPreferences: captured,
          patch,
          verdict: null,
          diff: null,
          applied: false,
          deload: deloadSummary(deload),
          disclaimer: DISCLAIMER,
        },
        { status: 409 },
      )
    }

    // ── The diff you confirm (§11-A) ─────────────────────────────────────────
    // The default, and the whole point of the route: the patch is judged and
    // described, the session is left exactly where it was, and the athlete
    // decides. A push-back here is a forewarning rather than a receipt — the
    // counter-proposal and the override are offered before the fact, which is
    // the only time either of them is a real choice.
    if (!apply) {
      const preview = previewCoachPatch(session, patch, context)

      return NextResponse.json({
        reply:
          preview.verdict.kind === 'pushed_back'
            ? `${formatCoachReply(reply)}\n\nFLAG (from the safety rails, not the coach): ${preview.verdict.message}`
            : formatCoachReply(reply),
        parts: reply,
        available: true,
        preview: true,
        applied: false,
        capturedPreferences: captured,
        patch: preview.patch,
        verdict: preview.verdict,
        counterProposal: preview.counterProposal,
        diff: preview.diff,
        // The session as it stands, not as it would be. A deload may have moved
        // it a moment ago, and the diff has to be read against what is there.
        blocks: session.blocks,
        version: session.version,
        deload: deloadSummary(deload),
        disclaimer: DISCLAIMER,
      })
    }

    // ── The one funnel ───────────────────────────────────────────────────────
    // Reached only when the caller asked for it. The athlete's confirmation
    // from the Today screen does not come back here — it posts to
    // `/api/session/patch`, where it is validated again against the session as
    // it is then. This branch exists for a caller that has already decided.
    const outcome = await applyPatchToSession(session, patch, context, {
      reason: text.length > 0 ? text : 'Coach composed today.',
    })

    // A push-back is the answer, not a prompt to try again. It is reported with
    // the counter-proposal the validator built, which the athlete can accept or
    // insist past on their own next request (§11).
    const pushedBack = outcome.verdict.kind === 'pushed_back'

    return NextResponse.json({
      reply: pushedBack
        ? `${formatCoachReply(reply)}\n\nFLAG (from the safety rails, not the coach): ${outcome.verdict.message}`
        : formatCoachReply(reply),
      parts: reply,
      available: true,
      preview: false,
      capturedPreferences: captured,
      patch,
      verdict: outcome.verdict,
      counterProposal: outcome.verdict.counterProposal ?? null,
      diff: outcome.diff,
      applied: outcome.applied,
      blocks: outcome.session.blocks,
      version: outcome.version,
      deload: deloadSummary(deload),
      disclaimer: DISCLAIMER,
    })
  } catch (err) {
    // Never leak the exception: it can carry the key, a token, or a DSN (§20).
    console.error('[/api/coach]', err instanceof Error ? err.message : String(err))
    return NextResponse.json(
      { error: 'The coach could not answer that. Nothing was changed.' },
      { status: 500 },
    )
  }
}

/** Only the summary travels to the client — the signals stay server-side. */
function deloadSummary(
  application: Awaited<ReturnType<typeof applyDeloadIfWarranted>>,
): { triggered: boolean; applied: boolean; reasons: string[]; severity: string } {
  return {
    triggered: application.verdict.triggered,
    applied: application.applied,
    reasons: application.verdict.reasons,
    severity: application.verdict.severity,
  }
}
