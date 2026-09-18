'use client'

// ── Updating the knee flag ────────────────────────────────────────────────────
// Three ruled rows on a sheet of paper. The option you are on is marked in ink;
// the two you are not are pencil. No card, no pill, no tint.

import { useState } from 'react'
import { X } from 'lucide-react'
import { useLang } from '@/lib/i18n'

type PainLevel = 'none' | 'sometimes' | 'yes'

const OPTIONS: PainLevel[] = ['none', 'sometimes', 'yes']

interface Props {
  current: PainLevel
  onClose: () => void
  onSaved: () => void
}

export default function PainStatusModal({ current, onClose, onSaved }: Props) {
  const { t } = useLang()
  const [selected, setSelected] = useState<PainLevel>(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPainLevel: selected }),
      })
      if (!res.ok) throw new Error(t('readiness.painModal.error'))
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('readiness.painModal.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-paper border-t border-ink p-4 safe-pb"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-serif text-head text-ink">{t('readiness.painModal.title')}</h2>
          <button
            type="button"
            aria-label={t('readiness.painModal.close')}
            onClick={onClose}
            className="p-1 text-pencil hover:text-ink transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 border-t border-rule" role="radiogroup">
          {OPTIONS.map((opt) => {
            const on = selected === opt
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSelected(opt)}
                className="entry w-full flex items-baseline gap-3 text-left"
              >
                <span
                  className={`w-2.5 h-2.5 shrink-0 translate-y-0.5 border ${
                    on ? 'border-ink bg-ink' : 'border-rule'
                  }`}
                />
                <span className="min-w-0">
                  <span
                    className={`block text-entry ${on ? 'text-ink font-medium' : 'text-pencil'}`}
                  >
                    {t(`readiness.painModal.options.${opt}.label`)}
                  </span>
                  <span className="block font-serif italic text-note text-pencil mt-0.5">
                    {t(`readiness.painModal.options.${opt}.desc`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {error && <p className="mt-2 text-note text-stop">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="mt-4 w-full border border-ink text-ink text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-ink hover:text-paper transition-colors"
        >
          {saving ? t('readiness.painModal.saving') : t('readiness.painModal.save')}
        </button>
      </div>
    </div>
  )
}
