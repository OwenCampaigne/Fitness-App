'use client'

// ── Path B — the manual edit (§11) ────────────────────────────────────────────
// Tap a card, change the numbers, swap the movement, or take it off the day.
// Nothing here writes anything: it produces the same structured ops the coach
// produces, hands them back, and the one funnel takes it from there — preview,
// confirm, validator, diff, undo. That is the whole point of §11: two ways in,
// one object, one set of rails.

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import { LOG_FIELD_BOUNDS, buildModifyOp } from '@/lib/todayView'
import { Stepper } from '@/components/strength/SetLogger'
import type { ItemParams, SessionItem } from '@/types/session'
import type { PatchOp } from '@/types/patch'
import { catalogKey, type Catalog } from './types'

/** Which numbers a kind lets you move by hand, with the bounds the API enforces. */
interface FieldSpec {
  key: string
  labelKey: string
  min: number
  max: number
  step: number
  nullable?: boolean
}

function fieldsFor(params: ItemParams, stepKg: number): FieldSpec[] {
  if (params.kind === 'strength') {
    return [
      { key: 'sets', labelKey: 'sets', min: 1, max: 20, step: 1 },
      { key: 'reps', labelKey: 'reps', min: 1, max: 100, step: 1 },
      ...(params.weightKg === null
        ? []
        : [{ key: 'weightKg', labelKey: 'weightKg', min: 0, max: 500, step: stepKg }]),
      { key: 'targetRir', labelKey: 'rir', min: 0, max: 10, step: 1 },
    ]
  }
  if (params.kind === 'run') {
    return [
      { key: 'durationMin', labelKey: 'durationMin', min: 0, max: 600, step: 5 },
      { key: 'distanceKm', labelKey: 'distanceKm', min: 0, max: 300, step: 0.5 },
    ]
  }
  if (params.kind === 'contacts') {
    return [
      { key: 'sets', labelKey: 'sets', min: 1, max: 20, step: 1 },
      { key: 'contactsPerSet', labelKey: 'contactsPerSet', min: 1, max: 200, step: 5 },
    ]
  }
  return [
    { key: 'sets', labelKey: 'sets', min: 1, max: 20, step: 1 },
    ...(params.reps != null
      ? [{ key: 'reps', labelKey: 'reps', min: 1, max: 200, step: 1 }]
      : []),
    ...(params.holdSec != null
      ? [{ key: 'holdSec', labelKey: 'holdSec', min: 1, max: 600, step: LOG_FIELD_BOUNDS.holdSec.step }]
      : []),
  ]
}

interface Props {
  item: SessionItem
  catalog: Catalog
  onClose: () => void
  /** Hand the ops back to the one funnel — this sheet never posts. */
  onPropose: (ops: PatchOp[], reason: string) => void
}

export default function EditSheet({ item, catalog, onClose, onPropose }: Props) {
  const { t } = useLang()
  const entry = catalog[catalogKey(item.ref.kind, item.ref.id)] ?? {}
  const specs = useMemo(
    () => fieldsFor(item.params, entry.stepKg ?? 2.5),
    [item.params, entry.stepKg],
  )

  const [values, setValues] = useState<Record<string, number>>(() => {
    const source = item.params as unknown as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const spec of specs) {
      const current = source[spec.key]
      out[spec.key] = typeof current === 'number' ? current : spec.min
    }
    return out
  })
  const [swapTo, setSwapTo] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Same-kind alternatives from the authored catalogs. A swap keeps the dose
  // and changes the movement — "something gentler on my knee" is a different
  // exercise at the same prescription, not a different prescription.
  const swaps = useMemo(
    () =>
      Object.values(catalog)
        .filter((e) => e.kind === item.ref.kind && e.refId !== item.ref.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, item.ref.kind, item.ref.id],
  )

  const finalReason = reason.trim() || t('today.edit.reasonDefault')

  function submitChange() {
    setError(null)

    if (swapTo) {
      const target = swaps.find((s) => s.refId === swapTo)
      if (!target) return
      onPropose(
        [
          {
            op: 'replace',
            itemId: item.id,
            item: {
              id: `${item.ref.kind}-${target.refId}`,
              ref: { kind: item.ref.kind, id: target.refId, name: target.name },
              params: item.params,
              status: 'prescribed',
            },
            reason: finalReason,
          },
        ],
        finalReason,
      )
      return
    }

    const next: Record<string, unknown> = { kind: item.params.kind }
    for (const spec of specs) next[spec.key] = values[spec.key]
    const op = buildModifyOp(item, next as Partial<ItemParams>, finalReason)
    if (!op) {
      setError(t('today.edit.noChange'))
      return
    }
    onPropose([op], finalReason)
  }

  function submitRemove() {
    onPropose([{ op: 'remove', itemId: item.id, reason: finalReason }], finalReason)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-paper border-t border-ink p-4 max-h-[85vh] overflow-y-auto safe-pb">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="block-label">{t('today.edit.title')}</p>
            <h2 className="text-entry text-ink font-medium">{item.ref.name}</h2>
          </div>
          <button
            type="button"
            aria-label={t('today.edit.cancel')}
            onClick={onClose}
            className="p-1 text-pencil hover:text-ink transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* The numbers */}
        {!swapTo && specs.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mt-4">
            {specs.map((spec) => (
              <Stepper
                key={spec.key}
                label={t(`today.edit.fields.${spec.labelKey}`)}
                value={values[spec.key] ?? spec.min}
                step={spec.step}
                min={spec.min}
                max={spec.max}
                onChange={(v) => setValues((prev) => ({ ...prev, [spec.key]: v }))}
                disabled={false}
              />
            ))}
          </div>
        )}

        {/* The swap */}
        {swaps.length > 0 && (
          <div className="mt-4">
            <label htmlFor="today-swap" className="block-label block">
              {t('today.edit.swap')}
            </label>
            <select
              id="today-swap"
              value={swapTo}
              onChange={(e) => setSwapTo(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-rule focus:border-ink py-2 text-entry text-ink rounded-none"
            >
              <option value="">{t('today.edit.swapNone')}</option>
              {swaps.map((s) => (
                <option key={s.refId} value={s.refId}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* The reason — what the diff shows and what §13 learns from */}
        <div className="mt-4">
          <label htmlFor="today-edit-reason" className="block-label block">
            {t('today.edit.reason')}
          </label>
          <input
            id="today-edit-reason"
            type="text"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('today.edit.reasonPlaceholder')}
            className="w-full bg-transparent border-0 border-b border-rule focus:border-ink py-2 text-entry text-ink placeholder:text-faint rounded-none"
          />
        </div>

        {error && <p className="mt-2 text-note text-stop">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={submitChange}
            className="flex-1 border border-ink text-ink text-entry font-medium py-2.5 rounded-sm hover:bg-ink hover:text-paper transition-colors"
          >
            {t('today.edit.review')}
          </button>
          <button
            type="button"
            onClick={submitRemove}
            className="border border-stop text-stop text-entry font-medium px-4 py-2.5 rounded-sm hover:bg-stop hover:text-paper transition-colors"
          >
            {t('today.edit.remove')}
          </button>
        </div>

        <p className="marginalia mt-3">{t('today.edit.note')}</p>
      </div>
    </div>
  )
}
