'use client';

// ── Surgical clearance entry (framework §15) ─────────────────────────────────
// `filterContraindicated` and the return-to-run ladder both read what this form
// writes, and both hold their most conservative posture while it is empty. The
// design problem is therefore not "collect the fields" — it is making sure a
// user who does not have these numbers walks away without entering anything,
// rather than filling in something plausible. Hence: no prefilled defaults, no
// pre-selected toggles, an all-or-nothing save, and copy that names the source
// of every number before it asks for it.
//
// In the log, that idea has a shape: the fields sit inside a single transcription
// block, ruled down the left in ink and labelled with whose numbers they are.
// It is the only block in the app whose inputs are ink — everywhere else the
// athlete is recalling or estimating, and pencil says so.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Minus, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useLang } from '@/lib/i18n';
import {
  DEEP_FLEXION_THRESHOLD_DEG,
  STALE_CLEARANCE_MONTHS,
  clearanceAgeMonths,
  clearanceConsequences,
  parseClearanceSubmission,
} from '@/lib/clearance';
import type { ClearanceEntry, ClearanceErrorCode, ClearanceSubmission } from '@/lib/clearance';
import { BTN_INK, FIELD_INK, FIELD_LABEL } from './fieldStyles';

const EMPTY: ClearanceSubmission = {
  maxKneeFlexionDeg: '',
  noFlexionLimit: false,
  openChainCleared: null,
  impactCleared: null,
  pivotCleared: null,
  longestRunSegmentMin: '',
  surgeryDateApprox: '',
  clearedOn: '',
  clearedBy: '',
  notes: '',
};

/** Which field each rejection belongs to, so the message lands next to it. */
const ERROR_FIELD: Record<ClearanceErrorCode, string> = {
  flexion_required: 'flexion',
  flexion_range: 'flexion',
  open_chain_required: 'open-chain',
  impact_required: 'impact',
  pivot_required: 'pivot',
  run_segment_required: 'run-segment',
  run_segment_range: 'run-segment',
  surgery_date_required: 'surgery-date',
  surgery_date_invalid: 'surgery-date',
  cleared_on_required: 'cleared-on',
  cleared_on_invalid: 'cleared-on',
  cleared_on_future: 'cleared-on',
};

// ── Tri-state toggle ──────────────────────────────────────────────────────────
// Three visual states, two stored values. "Not addressed" and "not cleared" both
// persist as `false`, because the engine only ever acts on an affirmative yes —
// but they stay visually distinct from *unanswered*, which blocks the save.
// Neither answer is coloured: a picked answer is ink, and which one it is comes
// from the word, not from green meaning good.
function ClearedToggle({
  value,
  onChange,
  yesLabel,
  noLabel,
  describedBy,
  invalid,
}: {
  value: boolean | null | undefined;
  onChange: (v: boolean) => void;
  yesLabel: string;
  noLabel: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const base = 'flex flex-1 items-center justify-center gap-1.5 rounded-sm border px-3 py-2 text-note transition-colors';
  return (
    <div className="flex gap-2">
      <button
        type="button"
        aria-pressed={value === true}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => onChange(true)}
        className={clsx(
          base,
          value === true
            ? 'border-ink bg-ink font-semibold text-paper'
            : 'border-rule text-pencil hover:text-ink',
        )}
      >
        <Check size={13} />
        {yesLabel}
      </button>
      <button
        type="button"
        aria-pressed={value === false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => onChange(false)}
        className={clsx(
          base,
          value === false
            ? 'border-ink bg-ink font-semibold text-paper'
            : 'border-rule text-pencil hover:text-ink',
        )}
      >
        <Minus size={13} />
        {noLabel}
      </button>
    </div>
  );
}

function PermitRow({ label, allowed, allowedLabel, hiddenLabel }: {
  label: string;
  allowed: boolean;
  allowedLabel: string;
  hiddenLabel: string;
}) {
  return (
    <div className="entry flex items-baseline justify-between gap-3 py-1.5">
      <dt className="font-sans text-note text-pencil">{label}</dt>
      <dd className={allowed ? 'font-sans text-note font-semibold text-ready' : 'font-sans text-note text-pencil'}>
        {allowed ? allowedLabel : hiddenLabel}
      </dd>
    </div>
  );
}

export default function ClearanceForm() {
  const { t } = useLang();

  const [form, setForm] = useState<ClearanceSubmission>(EMPTY);
  const [saved, setSaved] = useState<ClearanceEntry | null>(null);
  const [savedSegment, setSavedSegment] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A clearance has to attach to a profile row; without one there is nothing to
  // write it to, and a 404 dressed up as a validation error would be a lie.
  const [hasProfile, setHasProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ClearanceErrorCode[]>([]);
  const [generic, setGeneric] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) return;
      const data = (await res.json()) as {
        exists: boolean;
        clearance: ClearanceEntry | null;
        longestRunSegmentMin: number | null;
        submission: ClearanceSubmission | null;
      };
      setHasProfile(data.exists);
      setSaved(data.clearance ?? null);
      setSavedSegment(data.longestRunSegmentMin ?? null);
      // Only a *stored* answer ever lands in a field. No profile, no prefill.
      if (data.submission) setForm({ ...EMPTY, ...data.submission });
    } catch {
      /* a failed read leaves the form empty, which is the safe state */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof ClearanceSubmission>(key: K, value: ClearanceSubmission[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors([]);
    setGeneric(null);
  };

  async function submit(payload: ClearanceSubmission | null) {
    setSaving(true);
    setGeneric(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearance: payload }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        codes?: ClearanceErrorCode[];
      };
      if (!res.ok) {
        setErrors(data.codes ?? []);
        if (!data.codes?.length) setGeneric(t('clearance.errors.generic'));
        return;
      }
      setErrors([]);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 2500);
      await load();
    } catch {
      setGeneric(t('clearance.errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    // Validated here for the round-trip-free error, and again on the server,
    // which is the boundary that actually matters.
    const parsed = parseClearanceSubmission(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    void submit(form);
  }

  function handleRemove() {
    if (!confirm(t('clearance.removeConfirm'))) return;
    setForm(EMPTY);
    void submit(null);
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={16} className="animate-spin text-pencil" />
      </div>
    );
  }

  const consequences = clearanceConsequences({
    clearance: saved ?? undefined,
    longestRunSegmentMin: savedSegment ?? undefined,
  });
  const ageMonths = saved ? clearanceAgeMonths(saved) : null;

  const codesFor = (field: string) => errors.filter((code) => ERROR_FIELD[code] === field);
  const errId = (field: string) => `clearance-error-${field}`;

  /** One rejection, rendered under the field it belongs to. */
  function FieldError({ field }: { field: string }) {
    const codes = codesFor(field);
    if (codes.length === 0) return null;
    return (
      <p id={errId(field)} className="mt-1.5 font-sans text-note text-stop">
        {codes.map((code) => t(`clearance.errors.${code}`)).join(' ')}
      </p>
    );
  }

  const described = (field: string) =>
    codesFor(field).length > 0 ? errId(field) : undefined;
  const invalid = (field: string) => (codesFor(field).length > 0 ? true : undefined);

  return (
    <section aria-labelledby="clearance-heading" className="flex flex-col">
      <h2 id="clearance-heading" className="font-serif text-head text-ink">
        {t('clearance.sectionTitle')}
      </h2>
      <p className="mt-0.5 font-serif text-note italic text-pencil">{t('clearance.subtitle')}</p>

      <p className="prose-log mt-3">{t('clearance.intro')}</p>

      {/* ── State of play ── */}
      {!saved ? (
        <div className="mt-5 border-t border-rule pt-3">
          <p className="block-label">{t('clearance.emptyTitle')}</p>
          <p className="prose-log text-entry">{t('clearance.emptyBody')}</p>
        </div>
      ) : (
        <div className="mt-5 border-t border-rule pt-3">
          <p className="block-label">{t('clearance.currentTitle')}</p>
          <dl>
            <PermitRow
              label={t('clearance.deepFlexionLabel')}
              allowed={consequences.deepFlexionAllowed}
              allowedLabel={t('clearance.allowed')}
              hiddenLabel={t('clearance.hidden')}
            />
            <PermitRow
              label={t('clearance.openChainLabel')}
              allowed={consequences.openChainAllowed}
              allowedLabel={t('clearance.allowed')}
              hiddenLabel={t('clearance.hidden')}
            />
            <PermitRow
              label={t('clearance.impactLabel')}
              allowed={consequences.impactAllowed}
              allowedLabel={t('clearance.allowed')}
              hiddenLabel={t('clearance.hidden')}
            />
            <PermitRow
              label={t('clearance.pivotLabel')}
              allowed={consequences.pivotAllowed}
              allowedLabel={t('clearance.allowed')}
              hiddenLabel={t('clearance.hidden')}
            />
            <div className="entry flex items-baseline justify-between gap-3 py-1.5">
              <dt className="font-sans text-note text-pencil">{t('clearance.runLabel')}</dt>
              <dd
                className={clsx(
                  'figures font-sans text-note',
                  consequences.runSegmentMin === null
                    ? 'text-pencil'
                    : 'font-semibold text-ready',
                )}
              >
                {consequences.runSegmentMin === null
                  ? t('clearance.runNone')
                  : t('clearance.runCeiling', { min: consequences.runSegmentMin })}
              </dd>
            </div>
          </dl>

          {!consequences.deepFlexionAllowed && saved.maxKneeFlexionDeg !== null && (
            <p className="mt-2 font-serif text-note italic leading-relaxed text-pencil">
              {t('clearance.deepFlexionNote', { deg: DEEP_FLEXION_THRESHOLD_DEG })}
            </p>
          )}

          <p className="figures mt-3 font-sans text-note text-pencil">
            {t('clearance.givenOn', { date: saved.clearedOn })}
            {saved.clearedBy ? ` ${t('clearance.givenBy', { who: saved.clearedBy })}` : ''}
          </p>
          {saved.notes && <p className="marginalia mt-2">“{saved.notes}”</p>}
        </div>
      )}

      {/* A clearance ages. Six months on, it describes a different knee. */}
      {ageMonths !== null && ageMonths >= STALE_CLEARANCE_MONTHS && (
        <p className="mt-4 flex items-start gap-2 border-l-2 border-caution pl-3 font-sans text-note leading-relaxed text-caution">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {t('clearance.staleWarning', { months: ageMonths })}
        </p>
      )}

      <p className="prose-log mt-5 text-entry">{t('clearance.blankIsSafe')}</p>
      <p className="prose-log mt-2 text-entry">{t('clearance.partialWarning')}</p>

      {/* ── The transcription block ──────────────────────────────────────────
          Ruled down the left in ink and labelled with whose numbers these are.
          Everything inside it is copied, not recalled. */}
      <div className="mt-5 border-l-2 border-ink pl-4">
        <p className="block-label">{t('clearance.subtitle')}</p>

        <div className="py-2">
          <label htmlFor="clearance-flexion" className={FIELD_LABEL}>
            {t('clearance.fields.maxFlexion')}{' '}
            <span className="not-italic">{t('clearance.fields.maxFlexionUnit')}</span>
          </label>
          <input
            id="clearance-flexion"
            type="number"
            inputMode="numeric"
            value={String(form.maxKneeFlexionDeg ?? '')}
            onChange={(e) => set('maxKneeFlexionDeg', e.target.value)}
            disabled={form.noFlexionLimit === true}
            min={0}
            max={160}
            placeholder={t('clearance.fields.maxFlexionPlaceholder')}
            aria-invalid={invalid('flexion')}
            aria-describedby={described('flexion')}
            className={clsx(FIELD_INK, form.noFlexionLimit === true && 'opacity-40')}
          />
          {/* The affirmative tick: "no limit" is a thing a clinician said, not
              an empty field, so it has to be stated rather than left blank. */}
          <label
            htmlFor="clearance-no-limit"
            className="mt-2 flex cursor-pointer items-start gap-2 font-sans text-note text-ink"
          >
            <input
              id="clearance-no-limit"
              type="checkbox"
              checked={form.noFlexionLimit === true}
              onChange={(e) => {
                set('noFlexionLimit', e.target.checked);
                if (e.target.checked) set('maxKneeFlexionDeg', '');
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-current"
            />
            {t('clearance.fields.noFlexionLimit')}
          </label>
          <FieldError field="flexion" />
        </div>

        <fieldset className="py-2">
          <legend className={FIELD_LABEL}>{t('clearance.fields.openChain')}</legend>
          <p className="mb-2 font-serif text-note italic text-pencil">
            {t('clearance.fields.openChainHelp')}
          </p>
          <ClearedToggle
            value={form.openChainCleared}
            onChange={(v) => set('openChainCleared', v)}
            yesLabel={t('clearance.cleared')}
            noLabel={t('clearance.notCleared')}
            describedBy={described('open-chain')}
            invalid={invalid('open-chain')}
          />
          <FieldError field="open-chain" />
        </fieldset>

        <fieldset className="py-2">
          <legend className={FIELD_LABEL}>{t('clearance.fields.impact')}</legend>
          <p className="mb-2 font-serif text-note italic text-pencil">
            {t('clearance.fields.impactHelp')}
          </p>
          <ClearedToggle
            value={form.impactCleared}
            onChange={(v) => set('impactCleared', v)}
            yesLabel={t('clearance.cleared')}
            noLabel={t('clearance.notCleared')}
            describedBy={described('impact')}
            invalid={invalid('impact')}
          />
          <FieldError field="impact" />
        </fieldset>

        <fieldset className="py-2">
          <legend className={FIELD_LABEL}>{t('clearance.fields.pivot')}</legend>
          <p className="mb-2 font-serif text-note italic text-pencil">
            {t('clearance.fields.pivotHelp')}
          </p>
          <ClearedToggle
            value={form.pivotCleared}
            onChange={(v) => set('pivotCleared', v)}
            yesLabel={t('clearance.cleared')}
            noLabel={t('clearance.notCleared')}
            describedBy={described('pivot')}
            invalid={invalid('pivot')}
          />
          <FieldError field="pivot" />
          <p className="mt-2 font-serif text-note italic text-pencil">
            {t('clearance.triStateHelp')}
          </p>
        </fieldset>

        <div className="py-2">
          <label htmlFor="clearance-run-segment" className={FIELD_LABEL}>
            {t('clearance.fields.runSegment')}{' '}
            <span className="not-italic">{t('clearance.fields.runSegmentUnit')}</span>
          </label>
          <input
            id="clearance-run-segment"
            type="number"
            inputMode="numeric"
            value={String(form.longestRunSegmentMin ?? '')}
            onChange={(e) => set('longestRunSegmentMin', e.target.value)}
            min={0}
            max={180}
            placeholder={t('clearance.fields.runSegmentPlaceholder')}
            aria-invalid={invalid('run-segment')}
            aria-describedby={clsx(described('run-segment'), 'clearance-run-help')}
            className={FIELD_INK}
          />
          <FieldError field="run-segment" />
          <p id="clearance-run-help" className="mt-1.5 font-serif text-note italic leading-relaxed text-pencil">
            {t('clearance.fields.runSegmentHelp')}
          </p>
        </div>

        <div className="flex gap-4 py-2">
          <div className="flex-1">
            <label htmlFor="clearance-surgery-date" className={FIELD_LABEL}>
              {t('clearance.fields.surgeryDate')}{' '}
              <span className="not-italic">{t('clearance.fields.surgeryDateUnit')}</span>
            </label>
            <input
              id="clearance-surgery-date"
              type="month"
              value={String(form.surgeryDateApprox ?? '')}
              onChange={(e) => set('surgeryDateApprox', e.target.value)}
              aria-invalid={invalid('surgery-date')}
              aria-describedby={described('surgery-date')}
              className={FIELD_INK}
            />
            <FieldError field="surgery-date" />
          </div>
          <div className="flex-1">
            <label htmlFor="clearance-cleared-on" className={FIELD_LABEL}>
              {t('clearance.fields.clearedOn')}
            </label>
            <input
              id="clearance-cleared-on"
              type="date"
              value={String(form.clearedOn ?? '')}
              onChange={(e) => set('clearedOn', e.target.value)}
              aria-invalid={invalid('cleared-on')}
              aria-describedby={clsx(described('cleared-on'), 'clearance-cleared-help')}
              className={FIELD_INK}
            />
            <FieldError field="cleared-on" />
          </div>
        </div>
        <p id="clearance-cleared-help" className="font-serif text-note italic text-pencil">
          {t('clearance.fields.clearedOnHelp')}
        </p>

        <div className="py-2">
          <label htmlFor="clearance-cleared-by" className={FIELD_LABEL}>
            {t('clearance.fields.clearedBy')}{' '}
            <span className="not-italic">{t('clearance.fields.clearedByOptional')}</span>
          </label>
          <input
            id="clearance-cleared-by"
            type="text"
            value={String(form.clearedBy ?? '')}
            onChange={(e) => set('clearedBy', e.target.value)}
            maxLength={80}
            placeholder={t('clearance.fields.clearedByPlaceholder')}
            className={FIELD_INK}
          />
        </div>

        <div className="py-2">
          <label htmlFor="clearance-notes" className={FIELD_LABEL}>
            {t('clearance.fields.notes')}{' '}
            <span className="not-italic">{t('clearance.fields.notesOptional')}</span>
          </label>
          <textarea
            id="clearance-notes"
            value={String(form.notes ?? '')}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={t('clearance.fields.notesPlaceholder')}
            className={clsx(FIELD_INK, 'resize-none')}
          />
        </div>
      </div>

      {/* ── What happened ── */}
      {errors.length > 0 && (
        <p role="alert" className="mt-4 font-sans text-entry leading-relaxed text-stop">
          {t('clearance.errors.summary', { count: errors.length })}
        </p>
      )}
      {generic && (
        <p role="alert" className="mt-4 font-sans text-entry text-stop">
          {generic}
        </p>
      )}
      {flash && (
        <p role="status" className="mt-4 font-sans text-entry text-ready">
          {t('clearance.saved')}
        </p>
      )}
      {!hasProfile && (
        <p className="mt-4 font-sans text-entry leading-relaxed text-caution">
          {t('clearance.needsProfile')}
        </p>
      )}

      {/* ── Actions ── */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !hasProfile}
        className={`${BTN_INK} mt-5 w-full`}
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        {saving ? t('clearance.saving') : t('clearance.save')}
      </button>

      {saved && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={saving}
          className="mx-auto mt-3 flex items-center gap-2 py-1 font-sans text-note text-pencil transition-colors hover:text-stop"
        >
          <Trash2 size={13} />
          {t('clearance.remove')}
        </button>
      )}

      {/* Framework §15 — visible, not buried. */}
      <p className="marginalia mt-5">{t('clearance.disclaimer')}</p>
    </section>
  );
}
