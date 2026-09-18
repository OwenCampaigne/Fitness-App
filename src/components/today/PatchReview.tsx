'use client'

// ── The diff you confirm, and the receipt you get back (§11, §14) ─────────────
// Both edit paths land here — the sentence you typed to the coach and the
// stepper you nudged on an entry — and neither of them applies anything until
// you have seen what it does.
//
// Two phases, deliberately:
//
//   1. **Preview.** The ops are rendered against the session already on screen,
//      before/after, each with its reason. Nothing has been sent — so the whole
//      thing is in pencil, because that is exactly what it is.
//   2. **Receipt.** The server's own diff and verdict come back and replace it.
//      Now the "after" is written down, so it is set in ink. A flag is shown
//      rather than swallowed; a push-back shows the counter-proposal *and*
//      keeps the override, unless the finding is a hard floor — §15's tissue
//      protections are not a judgement call and do not get a "do it anyway"
//      button that would only be refused.
//
// Showing both is the point. The preview is what you agreed to; the receipt is
// what actually happened. A disagreement between them is visible.
//
// A coach patch arrives with something a manual one cannot have: a verdict the
// server already reached while previewing. That is rendered in phase 1 as a
// forewarning — "this would be pushed back, here is the safer version" — which
// is the only point at which the counter-proposal and the override are still a
// choice rather than a correction. It does not shortcut phase 2: the patch is
// judged again on apply, against the session as it is then, and *that* verdict
// is the one that happened.

import { X } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import { diffHeadline, previewPatch, verdictView, visibleFindings } from '@/lib/todayView'
import type { RuleFinding, PatchOp, ValidationVerdict } from '@/types/patch'
import type { SessionBlock } from '@/types/session'
import type { PatchResponse } from './types'

export interface PendingPatch {
  ops: PatchOp[]
  actor: 'user' | 'coach'
  reason: string
  /** The sentence that produced it, when the coach wrote it (§11-A). */
  source?: string
  /** What the coach said alongside the patch, when it said anything. */
  message?: string | null
  /** True when the coach wrote this patch rather than a tap on an entry (§11-A). */
  byCoach?: boolean
  /**
   * The verdict `/api/coach` reached while previewing. Nothing was applied to
   * earn it — it is what the rails *would* say — so it is shown as a
   * forewarning and never as a receipt.
   */
  previewVerdict?: ValidationVerdict | null
}

interface Props {
  pending: PendingPatch
  blocks: SessionBlock[]
  result: PatchResponse | null
  applying: boolean
  error: string | null
  onConfirm: (override: boolean) => void
  onTakeCounterProposal: () => void
  onUndo: () => void
  onClose: () => void
}

/** Colour is allowed here: a verdict and a safety finding are what it is for. */
const TONE_INK = {
  ok: 'text-ready',
  flag: 'text-caution',
  blocked: 'text-stop',
} as const

const TONE_RULE = {
  ok: 'border-ready',
  flag: 'border-caution',
  blocked: 'border-stop',
} as const

export default function PatchReview({
  pending,
  blocks,
  result,
  applying,
  error,
  onConfirm,
  onTakeCounterProposal,
  onUndo,
  onClose,
}: Props) {
  const { t } = useLang()
  const preview = previewPatch(blocks, pending.ops)
  const view = result ? verdictView(result.verdict, result.applied) : null
  const findings = result ? visibleFindings(result.verdict) : []

  // Phase 1's forewarning. `applied: false` is not a guess here — it is the
  // literal state of the session — so `canOverride` and `hasCounterProposal`
  // mean the same thing they do on a receipt.
  const foresight = pending.previewVerdict ? verdictView(pending.previewVerdict, false) : null
  const foresightFindings = pending.previewVerdict
    ? visibleFindings(pending.previewVerdict)
    : []
  const wouldBeRefused = foresight?.tone === 'blocked'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-paper border-t border-ink p-4 max-h-[85vh] overflow-y-auto safe-pb">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="block-label mb-0">
              {result ? t('today.diff.titleResult') : t('today.diff.titlePreview')}
            </p>
            {pending.source && (
              <p className="font-serif text-prose text-ink mt-0.5">“{pending.source}”</p>
            )}
          </div>
          <button
            type="button"
            aria-label={t('today.diff.close')}
            onClick={onClose}
            className="p-1 text-pencil hover:text-ink transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {pending.message && <p className="marginalia mt-2 whitespace-pre-line">{pending.message}</p>}

        {pending.byCoach && !result && (
          <p className="marginalia mt-2">{t('today.coach.previewNote')}</p>
        )}

        {/* ── Phase 1: what it will do. Nothing is written yet — pencil. ──── */}
        {!result && (
          <>
            <DiffList entries={preview} applied={false} t={t} />

            {/* What the rails already said about this, before you tap. */}
            {foresight && foresight.tone !== 'ok' && (
              <Stamp
                tone={foresight.tone}
                label={t(`today.verdict.foresight.${foresight.tone}`)}
                message={foresight.message}
                findings={foresightFindings}
                hardFloorLabel={t('today.verdict.hardFloor')}
              />
            )}

            {error && <p className="mt-3 text-entry text-stop">{error}</p>}

            {/* The safer version, offered before the fact rather than after it. */}
            {foresight?.hasCounterProposal && (
              <button
                type="button"
                disabled={applying}
                onClick={onTakeCounterProposal}
                className="mt-4 w-full border border-ready text-ready text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-ready hover:text-paper transition-colors"
              >
                {t('today.verdict.counterApply')}
              </button>
            )}

            <div className={`${foresight?.hasCounterProposal ? 'mt-2' : 'mt-4'} flex gap-2`}>
              {/*
                A plain "apply it" on something the rails have already said they
                will refuse is a button that exists to fail. It becomes "do it
                anyway", which is honest about what it costs — and it is absent
                altogether behind a hard floor (§15).
              */}
              {wouldBeRefused ? (
                foresight?.canOverride && (
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => onConfirm(true)}
                    className="flex-1 border border-caution text-caution text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-caution hover:text-paper transition-colors"
                  >
                    {applying ? t('today.diff.applying') : t('today.verdict.override')}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => onConfirm(false)}
                  className="flex-1 border border-ink text-ink text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-ink hover:text-paper transition-colors"
                >
                  {applying ? t('today.diff.applying') : t('today.diff.confirm')}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="border border-rule text-pencil text-entry px-4 py-2.5 rounded-sm hover:text-ink hover:border-ink transition-colors"
              >
                {t('today.diff.cancel')}
              </button>
            </div>

            {wouldBeRefused && foresight?.canOverride && (
              <p className="marginalia mt-3">{t('today.verdict.overrideNote')}</p>
            )}
          </>
        )}

        {/* ── Phase 2: what it did, and what the validator said ────────────── */}
        {result && view && (
          <>
            <Stamp
              tone={view.tone}
              label={t(`today.verdict.${view.tone}`)}
              message={view.message}
              findings={findings}
              hardFloorLabel={t('today.verdict.hardFloor')}
            />

            {/* The server's own diff — the receipt, so the "after" is in ink. */}
            <div className="mt-4">
              <p className="block-label">
                {t('today.diff.applied')} · {diffHeadline(result.diff)}
              </p>
              <DiffList entries={result.diff.entries} applied={result.applied} t={t} />
            </div>

            {error && <p className="mt-3 text-entry text-stop">{error}</p>}

            <div className="mt-4 flex flex-col gap-2">
              {/* The safer version, offered rather than imposed (§10, §21). */}
              {view.hasCounterProposal && (
                <button
                  type="button"
                  disabled={applying}
                  onClick={onTakeCounterProposal}
                  className="w-full border border-ready text-ready text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-ready hover:text-paper transition-colors"
                >
                  {t('today.verdict.counterApply')}
                </button>
              )}

              {/* The override survives a push-back — unless it is a safety floor. */}
              {view.canOverride && (
                <>
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => onConfirm(true)}
                    className="w-full border border-caution text-caution text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-caution hover:text-paper transition-colors"
                  >
                    {applying ? t('today.diff.applying') : t('today.verdict.override')}
                  </button>
                  <p className="marginalia">{t('today.verdict.overrideNote')}</p>
                </>
              )}

              {result.applied && (
                <button
                  type="button"
                  disabled={applying}
                  onClick={onUndo}
                  className="w-full border border-rule text-pencil text-entry py-2.5 rounded-sm disabled:opacity-40 hover:text-ink hover:border-ink transition-colors"
                >
                  {t('today.diff.undoThis')}
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-full border border-ink text-ink text-entry font-medium py-2.5 rounded-sm hover:bg-ink hover:text-paper transition-colors"
              >
                {t('today.diff.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * One list of before → after rows, used by both phases.
 *
 * `applied` is the whole ink/pencil argument in one boolean: an "after" that
 * has been written to the session is a fact, and an "after" that is still a
 * proposal is not. The "before" is struck through in pencil either way — it is
 * the past, and the past is no longer the answer.
 */
function DiffList({
  entries,
  applied,
  t,
}: {
  entries: Array<{ op: string; itemId: string; name: string; before: string | null; after: string | null; reason: string }>
  applied: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  return (
    <ul className="mt-2">
      {entries.map((entry, i) => (
        <li key={`${entry.itemId}-${i}`} className="entry py-2">
          <div className="flex items-baseline gap-2">
            <span className="text-entry text-ink truncate">{entry.name}</span>
            <span className="font-serif italic text-note text-pencil ml-auto shrink-0">
              {t(`today.diff.ops.${entry.op}`)}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-1 text-entry">
            <span className="estimated line-through">{entry.before ?? '—'}</span>
            <span className="text-faint" aria-hidden="true">
              →
            </span>
            <span className={applied ? 'measured' : 'estimated'}>{entry.after ?? '—'}</span>
          </div>
          <p className="marginalia mt-1">{entry.reason}</p>
        </li>
      ))}
    </ul>
  )
}

/**
 * The verdict, stamped in the margin rather than tinted into a panel. Every
 * finding is shown — a push-back that got swallowed would make the safety rails
 * invisible, which is the same as not having them.
 */
function Stamp({
  tone,
  label,
  message,
  findings,
  hardFloorLabel,
}: {
  tone: 'ok' | 'flag' | 'blocked'
  label: string
  message: string
  findings: RuleFinding[]
  hardFloorLabel: string
}) {
  return (
    <div className={`mt-4 border-l-2 pl-3 ${TONE_RULE[tone]}`}>
      <p className={`font-serif text-head ${TONE_INK[tone]}`}>{label}</p>
      <p className="text-entry text-ink leading-relaxed mt-0.5">{message}</p>

      {findings.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {findings.map((finding, i) => (
            <li key={`${finding.rule}-${i}`} className="text-note leading-relaxed">
              <span className="estimated">{finding.rule}</span>{' '}
              <span className="text-pencil">{finding.message}</span>
              {finding.hardFloor && <span className="text-stop"> · {hardFloorLabel}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
