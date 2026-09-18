'use client'

// ── Onboarding intake (framework §5a) ─────────────────────────────────────────
// Four steps: who you are, where you are, what you have been lifting, what you
// have been running. The last two exist because §5a wants anchors on day 0 and
// §21 warns that the cold start is where trust is won or lost — but every field
// in them is skippable, and skipping leaves the engines in the conservative
// state they already hold rather than a guessed one.
//
// The log's rule applies from the first screen: what you recall is written in
// pencil, what a clinician told you is written in ink. The one ink field here
// is the cleared run segment, and it says whose number it is.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check } from 'lucide-react'
import { useLang } from '@/lib/i18n'
import StrengthAnchorStep, {
  EMPTY_STRENGTH_ENTRIES,
  toSetEntries,
} from '@/components/intake/StrengthAnchorStep'
import type { StrengthEntries } from '@/components/intake/StrengthAnchorStep'
import RunAnchorStep, { EMPTY_RUN_ANCHOR } from '@/components/intake/RunAnchorStep'
import {
  BTN_INK,
  BTN_QUIET,
  FIELD_INK,
  FIELD_LABEL,
  FIELD_PENCIL,
  choiceCls,
} from '@/components/intake/fieldStyles'
import { deriveIntakeStrengthAnchors, parseRunAnchorSubmission } from '@/lib/intakeAnchors'
import type { RunAnchorSubmission } from '@/lib/intakeAnchors'

type PainLevel = 'none' | 'sometimes' | 'yes'
type SurgicalLeg = 'left' | 'right'
type Step = 1 | 2 | 3 | 4

const TOTAL_STEPS = 4

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
      aria-pressed={value === current}
      onClick={() => onClick(value)}
      className={choiceCls(value === current)}
    >
      {label}
    </button>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const { t } = useLang()
  const [step, setStep] = useState<Step>(1)
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
  const [strength, setStrength] = useState<StrengthEntries>(EMPTY_STRENGTH_ENTRIES)
  const [runAnchor, setRunAnchor] = useState<RunAnchorSubmission>(EMPTY_RUN_ANCHOR)

  const screen1Valid =
    s1.age !== '' && parseInt(s1.age, 10) >= 10 && parseInt(s1.age, 10) <= 100

  const screen2Valid =
    s2.surgeryYear !== '' &&
    s2.surgeryMonth !== '' &&
    parseInt(s2.surgeryYear, 10) >= 2020 &&
    parseInt(s2.surgeryMonth, 10) >= 1 &&
    parseInt(s2.surgeryMonth, 10) <= 12

  // A filled row has to be valid; an empty one is always fine.
  const strengthValid = deriveIntakeStrengthAnchors(toSetEntries(strength)).ok
  const runValid = parseRunAnchorSubmission(runAnchor).ok

  // `overrides` exists because "skip" has to submit the *cleared* answers in the
  // same tick it clears them — a queued setState would still send the old ones.
  async function handleSubmit(overrides?: {
    strength?: StrengthEntries
    runAnchor?: RunAnchorSubmission
  }) {
    const strengthPayload = overrides?.strength ?? strength
    const runPayload = overrides?.runAnchor ?? runAnchor

    setSaving(true)
    setError(null)
    try {
      // The run-segment ceiling is a clinician's number: blank stays blank so
      // the ladder offers nothing rather than a rung nobody cleared.
      const segment = s2.longestRunSegmentMin.trim()

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: parseInt(s1.age, 10),
          sex: s1.sex,
          surgicalLeg: s2.surgicalLeg,
          surgeryDateApprox: `${s2.surgeryYear}-${s2.surgeryMonth.padStart(2, '0')}`,
          weeklyRunMinutes: parseInt(s2.weeklyRunMinutes, 10) || 0,
          longestRunSegmentMin: segment === '' ? null : parseInt(segment, 10),
          currentPainLevel: s2.currentPainLevel,
          strengthSets: toSetEntries(strengthPayload),
          runAnchor: runPayload,
        }),
      })
      if (!res.ok) throw new Error('save_failed')
      router.push('/')
    } catch {
      setError(t('intake.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const canAdvance =
    step === 1 ? screen1Valid : step === 2 ? screen2Valid : step === 3 ? strengthValid : runValid

  return (
    <div className="min-h-screen bg-paper px-5">
      <div className="mx-auto w-full max-w-md py-10">
        {/* ── Where you are in the book ── */}
        <div className="mb-2 flex gap-1.5" aria-hidden="true">
          {([1, 2, 3, 4] as Step[]).map((n) => (
            <div key={n} className={`h-px flex-1 ${step >= n ? 'bg-ink' : 'bg-rule'}`} />
          ))}
        </div>
        <p className="mb-8 font-serif text-note italic text-pencil">
          {t('intake.progress', { step, total: TOTAL_STEPS })}
        </p>

        {step === 1 && (
          <div className="flex flex-col">
            <h1 className="font-serif text-head text-ink">{t('intake.s1.title')}</h1>
            <p className="prose-log mt-2">{t('intake.s1.subtitle')}</p>

            <div className="mt-6 py-3">
              <label htmlFor="intake-age" className={FIELD_LABEL}>
                {t('intake.s1.age')}
              </label>
              <input
                id="intake-age"
                type="number"
                inputMode="numeric"
                value={s1.age}
                onChange={e => setS1(p => ({ ...p, age: e.target.value }))}
                min={10}
                max={100}
                placeholder={t('intake.s1.agePlaceholder')}
                className={FIELD_PENCIL}
              />
            </div>

            <fieldset className="py-3">
              <legend className={FIELD_LABEL}>{t('intake.s1.sex')}</legend>
              <div className="mt-2 flex gap-2">
                <OptionBtn value="male" current={s1.sex} label={t('intake.s1.male')} onClick={v => setS1(p => ({ ...p, sex: v }))} />
                <OptionBtn value="female" current={s1.sex} label={t('intake.s1.female')} onClick={v => setS1(p => ({ ...p, sex: v }))} />
              </div>
            </fieldset>

            <div className="mt-6 border-t border-rule pt-4">
              <p className="block-label">{t('intake.s1.goalLabel')}</p>
              <p className="font-sans text-entry text-ink">{t('intake.s1.goalValue')}</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col">
            <h1 className="font-serif text-head text-ink">{t('intake.s2.title')}</h1>
            <p className="prose-log mt-2">{t('intake.s2.subtitle')}</p>

            <fieldset className="mt-6 py-3">
              <legend className={FIELD_LABEL}>{t('intake.s2.surgicalLeg')}</legend>
              <div className="mt-2 flex gap-2">
                <OptionBtn value="left" current={s2.surgicalLeg} label={t('intake.s2.left')} onClick={v => setS2(p => ({ ...p, surgicalLeg: v }))} />
                <OptionBtn value="right" current={s2.surgicalLeg} label={t('intake.s2.right')} onClick={v => setS2(p => ({ ...p, surgicalLeg: v }))} />
              </div>
            </fieldset>

            <fieldset className="py-3">
              <legend className={FIELD_LABEL}>
                {t('intake.s2.surgeryDate')}{' '}
                <span className="not-italic">{t('intake.s2.surgeryDateHint')}</span>
              </legend>
              <div className="mt-1 flex gap-4">
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={t('intake.s2.yearPlaceholder')}
                  value={s2.surgeryYear}
                  onChange={e => setS2(p => ({ ...p, surgeryYear: e.target.value }))}
                  placeholder={t('intake.s2.yearPlaceholder')}
                  min={2015}
                  max={new Date().getFullYear()}
                  className={FIELD_PENCIL}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={t('intake.s2.monthPlaceholder')}
                  value={s2.surgeryMonth}
                  onChange={e => setS2(p => ({ ...p, surgeryMonth: e.target.value }))}
                  placeholder={t('intake.s2.monthPlaceholder')}
                  min={1}
                  max={12}
                  className={FIELD_PENCIL}
                />
              </div>
            </fieldset>

            <div className="py-3">
              <label htmlFor="intake-weekly" className={FIELD_LABEL}>
                {t('intake.s2.weeklyRun')}{' '}
                <span className="not-italic">{t('intake.s2.weeklyRunHint')}</span>
              </label>
              <input
                id="intake-weekly"
                type="number"
                inputMode="numeric"
                value={s2.weeklyRunMinutes}
                onChange={e => setS2(p => ({ ...p, weeklyRunMinutes: e.target.value }))}
                placeholder={t('intake.s2.weeklyRunPlaceholder')}
                min={0}
                className={FIELD_PENCIL}
              />
            </div>

            {/* The ladder ceiling: the one number on this screen that is not the
                athlete's to estimate, so it is the one written in ink. */}
            <div className="mt-2 border-l-2 border-ink py-1 pl-4">
              <label htmlFor="intake-segment" className={FIELD_LABEL}>
                {t('intake.s2.clearedSegment')}{' '}
                <span className="not-italic">{t('intake.s2.clearedSegmentHint')}</span>
              </label>
              <input
                id="intake-segment"
                type="number"
                inputMode="numeric"
                value={s2.longestRunSegmentMin}
                onChange={e => setS2(p => ({ ...p, longestRunSegmentMin: e.target.value }))}
                placeholder={t('intake.s2.clearedSegmentPlaceholder')}
                min={0}
                max={180}
                aria-describedby="intake-segment-help"
                className={FIELD_INK}
              />
              <p
                id="intake-segment-help"
                className="mt-2 font-serif text-note italic leading-relaxed text-pencil"
              >
                {t('intake.s2.clearedSegmentHelp')}
              </p>
            </div>

            <fieldset className="mt-2 py-3">
              <legend className={FIELD_LABEL}>{t('intake.s2.pain')}</legend>
              <div className="mt-2 flex gap-2">
                {([
                  { value: 'none' as PainLevel, label: t('intake.s2.painNone') },
                  { value: 'sometimes' as PainLevel, label: t('intake.s2.painSometimes') },
                  { value: 'yes' as PainLevel, label: t('intake.s2.painYes') },
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
            </fieldset>
          </div>
        )}

        {step === 3 && <StrengthAnchorStep entries={strength} onChange={setStrength} />}

        {step === 4 && <RunAnchorStep value={runAnchor} onChange={setRunAnchor} />}

        {error && (
          <p role="alert" className="mt-6 font-sans text-entry text-stop">
            {error}
          </p>
        )}

        {/* ── Navigation ── */}
        <div className="mt-8 flex gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className={`${BTN_QUIET} flex-1`}
            >
              {t('intake.back')}
            </button>
          )}
          {step < TOTAL_STEPS ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={!canAdvance}
              className={`${BTN_INK} flex-1`}
            >
              {t('intake.next')} <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || !runValid}
              className={`${BTN_INK} flex-1`}
            >
              <Check size={15} />
              {saving ? t('intake.saving') : t('intake.finish')}
            </button>
          )}
        </div>

        {/* Skipping an anchor step is a supported answer, not an escape hatch —
            so it is a button you can see, and it states what it leaves behind. */}
        {(step === 3 || step === 4) && (
          <div className="mt-4 border-t border-rule pt-4">
            <button
              type="button"
              onClick={() => {
                if (step === 3) {
                  setStrength(EMPTY_STRENGTH_ENTRIES)
                  setStep(4)
                } else {
                  setRunAnchor(EMPTY_RUN_ANCHOR)
                  void handleSubmit({ runAnchor: EMPTY_RUN_ANCHOR })
                }
              }}
              disabled={saving}
              className={`${BTN_QUIET} w-full`}
            >
              {t('intake.skipStep')}
            </button>
            <p className="marginalia mt-3">
              {step === 3 ? t('intake.strength.skipNote') : t('intake.run.skipNote')}
            </p>
          </div>
        )}

        {step >= 3 && <p className="marginalia mt-4">{t('intake.confidenceNote')}</p>}
      </div>
    </div>
  )
}
