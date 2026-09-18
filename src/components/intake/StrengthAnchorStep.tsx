'use client';

// ── Intake: strength anchors (framework §5a) ─────────────────────────────────
// A form over the set logger, exactly as §21's Executor argued: the same three
// numbers the logger already collects (weight × reps × RIR), against the four
// key lifts the session builder reaches for first. It shows, per row, the load
// it will actually start you at — visibly under what you reported — so the
// conservatism is something you can see rather than something you discover.
//
// Every number on this page is recalled from memory, so every field is pencil
// and the derived starting load is set in the coach's own hand. Nothing here
// is allowed to look measured.

import { useLang } from '@/lib/i18n';
import { KEY_LIFTS_BY_ID } from '@/lib/keyLifts';
import { INTAKE_LIFT_IDS, deriveIntakeWorkingLoadAnchor } from '@/lib/intakeAnchors';
import type { IntakeSetEntry } from '@/lib/intakeAnchors';
import { FIELD_PENCIL } from './fieldStyles';

export type StrengthEntries = Record<string, { weightKg: string; reps: string; rir: string }>;

export const EMPTY_STRENGTH_ENTRIES: StrengthEntries = Object.fromEntries(
  INTAKE_LIFT_IDS.map((id) => [id, { weightKg: '', reps: '', rir: '' }]),
);

/** Only rows the athlete actually filled in. A skipped lift sends nothing. */
export function toSetEntries(entries: StrengthEntries): IntakeSetEntry[] {
  return Object.entries(entries).map(([liftId, v]) => ({
    liftId,
    weightKg: v.weightKg,
    reps: v.reps,
    rir: v.rir,
  }));
}

const CELL = `${FIELD_PENCIL} text-center`;

export default function StrengthAnchorStep({
  entries,
  onChange,
}: {
  entries: StrengthEntries;
  onChange: (next: StrengthEntries) => void;
}) {
  const { t } = useLang();

  const set = (liftId: string, field: 'weightKg' | 'reps' | 'rir', value: string) => {
    onChange({ ...entries, [liftId]: { ...entries[liftId], [field]: value } });
  };

  return (
    <div className="flex flex-col">
      <h1 className="font-serif text-head text-ink">{t('intake.strength.title')}</h1>
      <p className="prose-log mt-2">{t('intake.strength.subtitle')}</p>

      {/* §21: say out loud that this is a guess, and that it starts low. */}
      <p className="marginalia mt-4">{t('intake.strength.honesty')}</p>

      <div className="mt-6">
        {INTAKE_LIFT_IDS.map((liftId) => {
          const lift = KEY_LIFTS_BY_ID[liftId];
          if (!lift) return null;

          const row = entries[liftId] ?? { weightKg: '', reps: '', rir: '' };
          const result = deriveIntakeWorkingLoadAnchor(
            { liftId, weightKg: row.weightKg, reps: row.reps, rir: row.rir },
            lift,
          );
          const errorId = `${liftId}-error`;
          const invalid = !result.ok;

          return (
            <div key={liftId} className="entry">
              <div className="flex items-baseline gap-2">
                <span className="font-sans text-entry text-ink">{lift.name}</span>
                {lift.bodyweight && (
                  <span className="font-serif text-note italic text-pencil">
                    {t('intake.strength.bodyweightNote')}
                  </span>
                )}
              </div>

              <div className="mt-1 flex gap-5">
                {!lift.bodyweight && (
                  <div className="flex-1">
                    <input
                      id={`${liftId}-weight`}
                      type="number"
                      inputMode="decimal"
                      value={row.weightKg}
                      onChange={(e) => set(liftId, 'weightKg', e.target.value)}
                      min={0}
                      step={0.5}
                      className={CELL}
                      aria-label={`${lift.name} — ${t('intake.strength.weight')}`}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? errorId : undefined}
                    />
                    <label
                      htmlFor={`${liftId}-weight`}
                      className="mt-1 block text-center font-serif text-note italic text-pencil"
                    >
                      {t('intake.strength.weight')}
                    </label>
                  </div>
                )}
                <div className="flex-1">
                  <input
                    id={`${liftId}-reps`}
                    type="number"
                    inputMode="numeric"
                    value={row.reps}
                    onChange={(e) => set(liftId, 'reps', e.target.value)}
                    min={1}
                    max={50}
                    className={CELL}
                    aria-label={`${lift.name} — ${t('intake.strength.reps')}`}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorId : undefined}
                  />
                  <label
                    htmlFor={`${liftId}-reps`}
                    className="mt-1 block text-center font-serif text-note italic text-pencil"
                  >
                    {t('intake.strength.reps')}
                  </label>
                </div>
                <div className="flex-1">
                  <input
                    id={`${liftId}-rir`}
                    type="number"
                    inputMode="numeric"
                    value={row.rir}
                    onChange={(e) => set(liftId, 'rir', e.target.value)}
                    min={0}
                    max={10}
                    className={CELL}
                    aria-label={`${lift.name} — ${t('intake.strength.rir')}`}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorId : undefined}
                  />
                  <label
                    htmlFor={`${liftId}-rir`}
                    className="mt-1 block text-center font-serif text-note italic text-pencil"
                  >
                    {t('intake.strength.rir')}
                  </label>
                </div>
              </div>

              {/* The haircut, shown rather than applied quietly — and shown in
                  pencil, because it is derived from a number you recalled. */}
              {result.ok && result.anchor && result.anchor.value !== null && (
                <p className="mt-2 font-serif text-note italic text-pencil">
                  {t('intake.strength.startingAt', {
                    kg: result.anchor.value,
                    reported: result.anchor.reportedKg ?? '',
                  })}
                </p>
              )}
              {result.ok && result.anchor && result.anchor.value === null && (
                <p className="mt-2 font-serif text-note italic text-pencil">
                  {t('intake.strength.startingReps', { reps: result.anchor.reportedReps })}
                </p>
              )}
              {invalid && (
                <ul id={errorId} className="mt-2">
                  {result.errors.map((code) => (
                    <li key={code} className="font-sans text-note text-stop">
                      {t(`intake.errors.${code}`)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-5 font-serif text-note italic leading-relaxed text-pencil">
        {t('intake.strength.rirHelp')}
      </p>
      <p className="mt-2 font-serif text-note italic leading-relaxed text-pencil">
        {t('intake.strength.notPrescription')}
      </p>
    </div>
  );
}
