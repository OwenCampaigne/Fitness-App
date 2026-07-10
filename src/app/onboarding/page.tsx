'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle } from 'lucide-react'

type PainLevel = 'none' | 'sometimes' | 'yes'
type SurgicalLeg = 'left' | 'right'

interface Screen1 { age: string; sex: 'male' | 'female' }
interface Screen2 {
  surgicalLeg: SurgicalLeg
  surgeryYear: string
  surgeryMonth: string
  weeklyRunMinutes: string
  longestRunSegmentMin: string
  currentPainLevel: PainLevel
}

function OptionBtn<T extends string>({
  value, current, label, onClick,
}: { value: T; current: T; label: string; onClick: (v: T) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
        value === current
          ? 'bg-primary text-bg border-primary'
          : 'bg-surface text-secondary border-border'
      }`}
    >
      {label}
    </button>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [s1, setS1] = useState<Screen1>({ age: '', sex: 'male' })
  const [s2, setS2] = useState<Screen2>({
    surgicalLeg: 'right',
    surgeryYear: '',
    surgeryMonth: '',
    weeklyRunMinutes: '',
    longestRunSegmentMin: '',
    currentPainLevel: 'none',
  })

  const screen1Valid =
    s1.age !== '' && parseInt(s1.age, 10) >= 10 && parseInt(s1.age, 10) <= 100

  const screen2Valid =
    s2.surgeryYear !== '' &&
    s2.surgeryMonth !== '' &&
    parseInt(s2.surgeryYear, 10) >= 2020 &&
    parseInt(s2.surgeryMonth, 10) >= 1 &&
    parseInt(s2.surgeryMonth, 10) <= 12

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: parseInt(s1.age, 10),
          sex: s1.sex,
          surgicalLeg: s2.surgicalLeg,
          surgeryDateApprox: `${s2.surgeryYear}-${s2.surgeryMonth.padStart(2, '0')}`,
          weeklyRunMinutes: parseInt(s2.weeklyRunMinutes, 10) || 0,
          longestRunSegmentMin: parseInt(s2.longestRunSegmentMin, 10) || 1,
          currentPainLevel: s2.currentPainLevel,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-primary/50 transition-colors'

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md py-8">
        {/* Progress bar */}
        <div className="flex gap-2 mb-8">
          <div className="h-1 flex-1 rounded-full bg-primary" />
          <div className={`h-1 flex-1 rounded-full transition-colors ${step === 2 ? 'bg-primary' : 'bg-border'}`} />
        </div>

        {step === 1 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-xl font-bold text-primary mb-1">Welcome to Running on AI</h1>
              <p className="text-sm text-secondary">A few quick questions to calibrate your readiness system.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Age</label>
              <input
                type="number"
                value={s1.age}
                onChange={e => setS1(p => ({ ...p, age: e.target.value }))}
                min={10}
                max={100}
                placeholder="e.g. 28"
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Sex</label>
              <div className="flex gap-2">
                <OptionBtn value="male" current={s1.sex} label="Male" onClick={v => setS1(p => ({ ...p, sex: v }))} />
                <OptionBtn value="female" current={s1.sex} label="Female" onClick={v => setS1(p => ({ ...p, sex: v }))} />
              </div>
            </div>

            <div className="pt-2 border-t border-border text-xs text-muted">
              <p className="font-semibold text-secondary mb-0.5">Goal</p>
              <p>Return to run — post-surgical recovery</p>
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!screen1Valid}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-bg font-bold text-sm disabled:opacity-40"
            >
              Next <ArrowRight size={16} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-xl font-bold text-primary mb-1">Where you are right now</h1>
              <p className="text-sm text-secondary">Helps the system start conservative and adapt as you improve.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Surgical Leg</label>
              <div className="flex gap-2">
                <OptionBtn value="left" current={s2.surgicalLeg} label="Left" onClick={v => setS2(p => ({ ...p, surgicalLeg: v }))} />
                <OptionBtn value="right" current={s2.surgicalLeg} label="Right" onClick={v => setS2(p => ({ ...p, surgicalLeg: v }))} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">
                Surgery Date <span className="text-muted font-normal normal-case">(approximate)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={s2.surgeryYear}
                  onChange={e => setS2(p => ({ ...p, surgeryYear: e.target.value }))}
                  placeholder="Year (2025)"
                  min={2015}
                  max={new Date().getFullYear()}
                  className="flex-1 bg-surface border border-border rounded-xl px-3 py-3 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-primary/50"
                />
                <input
                  type="number"
                  value={s2.surgeryMonth}
                  onChange={e => setS2(p => ({ ...p, surgeryMonth: e.target.value }))}
                  placeholder="Month (1–12)"
                  min={1}
                  max={12}
                  className="flex-1 bg-surface border border-border rounded-xl px-3 py-3 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">
                Weekly Running Time <span className="text-muted font-normal normal-case">(run segments only, min)</span>
              </label>
              <input
                type="number"
                value={s2.weeklyRunMinutes}
                onChange={e => setS2(p => ({ ...p, weeklyRunMinutes: e.target.value }))}
                placeholder="e.g. 15"
                min={0}
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">
                Longest Continuous Run <span className="text-muted font-normal normal-case">(min without stopping)</span>
              </label>
              <input
                type="number"
                value={s2.longestRunSegmentMin}
                onChange={e => setS2(p => ({ ...p, longestRunSegmentMin: e.target.value }))}
                placeholder="e.g. 2"
                min={0}
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-secondary uppercase tracking-widest">Current Knee Pain</label>
              <div className="flex gap-2">
                {([
                  { value: 'none' as PainLevel, label: 'None' },
                  { value: 'sometimes' as PainLevel, label: 'Sometimes' },
                  { value: 'yes' as PainLevel, label: 'Yes' },
                ]).map(({ value, label }) => (
                  <OptionBtn
                    key={value}
                    value={value}
                    current={s2.currentPainLevel}
                    label={label}
                    onClick={v => setS2(p => ({ ...p, currentPainLevel: v }))}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-recovery-red">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-secondary bg-surface border border-border"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || !screen2Valid}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-bg font-bold text-sm disabled:opacity-40"
              >
                <CheckCircle size={16} />
                {saving ? 'Saving...' : 'Start'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
