'use client'
import { useState } from 'react'
import { X } from 'lucide-react'

type PainLevel = 'none' | 'sometimes' | 'yes'

const OPTIONS: { value: PainLevel; label: string; desc: string }[] = [
  { value: 'none', label: 'None', desc: 'No knee pain or swelling' },
  { value: 'sometimes', label: 'Sometimes', desc: 'Mild pain that clears during activity' },
  { value: 'yes', label: 'Yes', desc: 'Active pain or swelling — rest day' },
]

interface Props {
  current: PainLevel
  onClose: () => void
  onSaved: () => void
}

export default function PainStatusModal({ current, onClose, onSaved }: Props) {
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
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
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
        className="w-full max-w-md bg-bg rounded-t-2xl p-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-primary">Update knee status</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-muted hover:text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSelected(opt.value)}
              className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                selected === opt.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-surface'
              }`}
            >
              <div
                className={`w-3 h-3 mt-0.5 rounded-full border-2 shrink-0 transition-all ${
                  selected === opt.value ? 'border-primary bg-primary' : 'border-border'
                }`}
              />
              <div>
                <p className="text-sm font-semibold text-primary">{opt.label}</p>
                <p className="text-xs text-secondary">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-recovery-red">{error}</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-primary text-bg font-bold text-sm disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Update'}
        </button>
      </div>
    </div>
  )
}
