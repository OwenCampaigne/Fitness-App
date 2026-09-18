'use client';

// ── Intake: run anchor (framework §5a) ────────────────────────────────────────
// A recent race or a recent easy run, and "neither" is a first-class answer.
// The anchor this writes is always `source: 'estimate'`, and `resolveTarget` in
// runEngine refuses to issue a pace target from an estimate — so a wrong guess
// here cannot turn into a hard prescription. That guarantee is why the copy can
// afford to be relaxed about asking, and why the derived pace is set in pencil
// rather than in the ink the rest of the app reserves for measured numbers.

import { useLang } from '@/lib/i18n';
import { RACE_DISTANCES_KM, formatPace, parseRunAnchorSubmission } from '@/lib/intakeAnchors';
import type { RunAnchorSubmission } from '@/lib/intakeAnchors';
import { FIELD_LABEL, FIELD_PENCIL, choiceCls } from './fieldStyles';

export const EMPTY_RUN_ANCHOR: RunAnchorSubmission = {
  kind: 'skip',
  raceDistance: '',
  raceTime: '',
  easyPace: '',
};

function Choice({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={choiceCls(active)}>
      {label}
    </button>
  );
}

export default function RunAnchorStep({
  value,
  onChange,
}: {
  value: RunAnchorSubmission;
  onChange: (next: RunAnchorSubmission) => void;
}) {
  const { t } = useLang();
  const result = parseRunAnchorSubmission(value);
  const showErrors = value.kind !== 'skip';
  const invalid = showErrors && !result.ok;

  const set = <K extends keyof RunAnchorSubmission>(key: K, v: RunAnchorSubmission[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col">
      <h1 className="font-serif text-head text-ink">{t('intake.run.title')}</h1>
      <p className="prose-log mt-2">{t('intake.run.subtitle')}</p>

      <div className="mt-6 flex gap-2">
        <Choice
          active={value.kind === 'race'}
          label={t('intake.run.kindRace')}
          onClick={() => set('kind', 'race')}
        />
        <Choice
          active={value.kind === 'easy'}
          label={t('intake.run.kindEasy')}
          onClick={() => set('kind', 'easy')}
        />
        <Choice
          active={value.kind === 'skip'}
          label={t('intake.run.kindSkip')}
          onClick={() => set('kind', 'skip')}
        />
      </div>

      {value.kind === 'race' && (
        <>
          <fieldset className="mt-5">
            <legend className={FIELD_LABEL}>{t('intake.run.distance')}</legend>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {Object.keys(RACE_DISTANCES_KM).map((key) => (
                <Choice
                  key={key}
                  active={value.raceDistance === key}
                  label={key === 'half' ? '21.1k' : key === 'marathon' ? '42.2k' : key}
                  onClick={() => set('raceDistance', key)}
                />
              ))}
            </div>
          </fieldset>
          <div className="mt-4">
            <label htmlFor="run-time" className={FIELD_LABEL}>
              {t('intake.run.time')}
            </label>
            <input
              id="run-time"
              type="text"
              inputMode="numeric"
              value={value.raceTime ?? ''}
              onChange={(e) => set('raceTime', e.target.value)}
              placeholder={t('intake.run.timePlaceholder')}
              className={FIELD_PENCIL}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'run-anchor-error' : undefined}
            />
          </div>
        </>
      )}

      {value.kind === 'easy' && (
        <div className="mt-5">
          <label htmlFor="run-easy" className={FIELD_LABEL}>
            {t('intake.run.easyPace')}
          </label>
          <input
            id="run-easy"
            type="text"
            inputMode="numeric"
            value={value.easyPace ?? ''}
            onChange={(e) => set('easyPace', e.target.value)}
            placeholder={t('intake.run.easyPacePlaceholder')}
            className={FIELD_PENCIL}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? 'run-anchor-error' : undefined}
          />
        </div>
      )}

      {/* "Neither" needs no field, and its consequence is stated once — under
          the skip button on the step itself, where it is always on screen. */}

      {showErrors && result.ok && result.anchor?.value !== null && result.anchor && (
        <p className="mt-4 font-serif text-note italic text-pencil">
          {t('intake.run.estimated', { pace: formatPace(result.anchor.value as number) })}
        </p>
      )}

      {invalid && (
        <ul id="run-anchor-error" className="mt-4">
          {result.errors.map((code) => (
            <li key={code} className="font-sans text-note text-stop">
              {t(`intake.errors.${code}`)}
            </li>
          ))}
        </ul>
      )}

      <p className="marginalia mt-6">{t('intake.run.honesty')}</p>
    </div>
  );
}
