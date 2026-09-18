'use client';

// ── Rehab progression (framework §15, §11) ───────────────────────────────────
// The screen that answers "I'm through rehab — now what?". Three jobs, in order
// of how much trouble getting them wrong would cause:
//
//   1. Say which stage is current **and who set it**. A self-report and a
//      surgeon's note change the engines by different amounts, and a card that
//      renders them identically is the failure mode this whole feature exists to
//      avoid. Provenance is a badge, not a footnote — and in the log it is the
//      one thing here allowed to carry colour, because it is a safety flag.
//   2. Show what the stage permits in the engine's own words, so "through rehab"
//      is a concrete list of movements rather than a vibe.
//   3. Never apply anything on one tap. A button states something on the
//      athlete's behalf, the server reads it and answers with a *proposal*, and
//      the change lands only after the athlete sees the consequence and says yes
//      (§11). The same route the chat coach uses — one funnel, no shortcut.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useLang } from '@/lib/i18n';
import { CANONICAL_STATEMENTS, SELF_REPORT_RUN_CEILING_MIN } from '@/lib/rehabStage';
import type { ClearanceProposal, RehabStage, StageActor, StagePermits } from '@/lib/rehabStage';
import { BTN_INK, BTN_QUIET } from './fieldStyles';

interface HistoryRow {
  id: number;
  recordedOn: string;
  stage: string;
  setBy: string;
  sourceQuote: string | null;
  notes: string | null;
}

interface StageResponse {
  exists: boolean;
  stage: RehabStage;
  record: { setBy: StageActor; recordedOn: string; sourceQuote: string | null } | null;
  permits: StagePermits;
  history: HistoryRow[];
}

function PermitRow({ label, allowed, yes, no }: { label: string; allowed: boolean; yes: string; no: string }) {
  return (
    <div className="entry flex items-baseline justify-between gap-3 py-1.5">
      <dt className="font-sans text-note text-pencil">{label}</dt>
      <dd className={allowed ? 'font-sans text-note font-semibold text-ready' : 'font-sans text-note text-pencil'}>
        {allowed ? yes : no}
      </dd>
    </div>
  );
}

export default function RehabStageCard() {
  const { t } = useLang();

  const [data, setData] = useState<StageResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The previewed proposal. Its presence is what gates the confirm button —
  // there is no code path that applies without one on screen first.
  const [preview, setPreview] = useState<ClearanceProposal | null>(null);
  const [noChange, setNoChange] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/clearance/stage');
      if (res.ok) setData((await res.json()) as StageResponse);
    } catch {
      /* a failed read leaves the card empty, which shows nothing it cannot back up */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Step one: ask the server what the statement would mean. Never applies.
  async function propose(target: keyof typeof CANONICAL_STATEMENTS) {
    setBusy(true);
    setError(null);
    setNoChange(false);
    setPreview(null);
    try {
      const res = await fetch('/api/clearance/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: CANONICAL_STATEMENTS[target] }),
      });
      const body = (await res.json().catch(() => ({}))) as { proposal?: ClearanceProposal | null };
      if (!res.ok) {
        setError(t('rehab.error'));
        return;
      }
      if (!body.proposal) {
        setNoChange(true);
        return;
      }
      setPreview(body.proposal);
    } catch {
      setError(t('rehab.error'));
    } finally {
      setBusy(false);
    }
  }

  // Step two. The server re-derives the proposal from the same sentence rather
  // than trusting this one, so the confirm is a confirmation and not a token.
  async function confirm() {
    if (!preview || !preview.applicable) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/clearance/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: preview.sourceQuote, confirm: true, proposal: preview }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t('rehab.error'));
        return;
      }
      setPreview(null);
      await load();
    } catch {
      setError(t('rehab.error'));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={16} className="animate-spin text-pencil" />
      </div>
    );
  }

  const permits = data?.permits ?? null;
  const stage = data?.stage ?? 'unknown';
  const setBy = data?.record?.setBy ?? permits?.setBy ?? null;

  return (
    <section aria-labelledby="rehab-heading" className="flex flex-col">
      <h2 id="rehab-heading" className="font-serif text-head text-ink">
        {t('rehab.sectionTitle')}
      </h2>
      <p className="mt-0.5 font-serif text-note italic text-pencil">{t('rehab.subtitle')}</p>

      <p className="prose-log mt-3">{t('rehab.intro')}</p>

      {/* ── Current stage + provenance ── */}
      <div className="mt-5 border-t border-rule pt-3">
        <p className="block-label">{t('rehab.stageTitle')}</p>
        <div className="flex items-start justify-between gap-3">
          <p className="font-sans text-entry font-semibold text-ink">{t(`rehab.stage.${stage}`)}</p>
          {/* The badge is the point: a self-report must never read as a clearance. */}
          {permits?.selfReported && (
            <span className="flex-shrink-0 rounded-sm border border-caution px-2 py-0.5 font-sans text-note text-caution">
              {t('rehab.selfReported')}
            </span>
          )}
        </div>
        <p className="prose-log mt-1.5 text-entry">{t(`rehab.blurb.${stage}`)}</p>
        {setBy && (
          <p className="figures mt-2 font-sans text-note text-pencil">
            {t(`rehab.setBy.${setBy}`)}
            {data?.record?.recordedOn ? ` · ${data.record.recordedOn}` : ''}
          </p>
        )}
        {data?.record?.sourceQuote && (
          <p className="marginalia mt-2">“{data.record.sourceQuote}”</p>
        )}
      </div>

      {permits?.selfReported && (
        <p className="mt-3 border-l-2 border-caution pl-3 font-sans text-note leading-relaxed text-caution">
          {t('rehab.selfReportedNote', { min: SELF_REPORT_RUN_CEILING_MIN })}
        </p>
      )}

      {/* ── What it permits, in the engine's own terms ── */}
      {permits && (
        <div className="mt-5 border-t border-rule pt-3">
          <p className="block-label">{t('rehab.permitsTitle')}</p>
          <dl>
            <PermitRow label={t('rehab.deepFlexionLabel')} allowed={permits.deepFlexionAllowed} yes={t('rehab.allowed')} no={t('rehab.hidden')} />
            <PermitRow label={t('rehab.openChainLabel')} allowed={permits.openChainAllowed} yes={t('rehab.allowed')} no={t('rehab.hidden')} />
            <PermitRow label={t('rehab.impactLabel')} allowed={permits.impactAllowed} yes={t('rehab.allowed')} no={t('rehab.hidden')} />
            <PermitRow label={t('rehab.pivotLabel')} allowed={permits.pivotAllowed} yes={t('rehab.allowed')} no={t('rehab.hidden')} />
            <div className="entry flex items-baseline justify-between gap-3 py-1.5">
              <dt className="font-sans text-note text-pencil">{t('rehab.runLabel')}</dt>
              <dd
                className={clsx(
                  'figures font-sans text-note',
                  permits.runSegmentMin === null ? 'text-pencil' : 'font-semibold text-ready',
                )}
              >
                {permits.runSegmentMin === null
                  ? t('rehab.runNone')
                  : t('rehab.runCeiling', { min: permits.runSegmentMin })}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* ── Propose a change ── */}
      {data?.exists === false ? (
        <p className="mt-4 font-sans text-entry leading-relaxed text-caution">
          {t('rehab.needsProfile')}
        </p>
      ) : (
        <div className="mt-5 border-t border-rule pt-3">
          <p className="block-label">{t('rehab.updateTitle')}</p>
          <div className="flex flex-wrap gap-2">
            {(['progressing', 'graduated', 'restricted'] as const).map((target) => (
              <button
                key={target}
                type="button"
                disabled={busy}
                onClick={() => void propose(target)}
                className={`${BTN_QUIET} min-w-[8rem] flex-1 py-2.5 text-note`}
              >
                {t(`rehab.propose.${target}`)}
              </button>
            ))}
          </div>
          {noChange && (
            <p className="mt-2 font-serif text-note italic text-pencil">{t('rehab.noChange')}</p>
          )}
        </div>
      )}

      {/* ── Preview → confirm (§11) ── */}
      {preview && (
        <div
          className={clsx(
            'mt-4 border-l-2 pl-3',
            preview.applicable ? 'border-ink' : 'border-stop',
          )}
        >
          <p
            className={clsx(
              'font-serif text-note italic',
              preview.applicable ? 'text-pencil' : 'text-stop',
            )}
          >
            {!preview.applicable && <AlertTriangle size={12} className="mr-1 inline align-[-1px]" />}
            {preview.applicable ? t('rehab.previewTitle') : t('rehab.blockedTitle')}
          </p>

          {preview.applicable ? (
            <>
              <p className="prose-log mt-1 text-entry">
                {t('rehab.previewLead', { stage: t(`rehab.stage.${preview.to}`) })}
              </p>
              <ul className="mt-2">
                {preview.unlocks.map((line) => (
                  <li key={line} className="font-sans text-note leading-relaxed text-ink">
                    · {line}
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-serif text-note italic text-pencil">
                {t('rehab.quoted', { quote: preview.sourceQuote })}
              </p>
            </>
          ) : (
            <p className="mt-1 font-sans text-note leading-relaxed text-stop">
              {preview.blockedReason}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {preview.applicable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirm()}
                className={`${BTN_INK} flex-1 py-2.5 text-note`}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t('rehab.confirm')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPreview(null)}
              className={`${BTN_QUIET} flex-1 py-2.5 text-note`}
            >
              <X size={14} />
              {t('rehab.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 font-sans text-entry leading-relaxed text-stop">
          {error}
        </p>
      )}

      {/* ── The dated history ── */}
      <div className="mt-5 border-t border-rule pt-3">
        <p className="block-label">{t('rehab.historyTitle')}</p>
        {!data?.history.length ? (
          <p className="font-serif text-note italic text-pencil">{t('rehab.historyEmpty')}</p>
        ) : (
          <ul>
            {data.history.map((row) => (
              <li key={row.id} className="entry grid grid-cols-[5.5rem_1fr] gap-x-3 py-2">
                <span className="figures font-sans text-note text-pencil">{row.recordedOn}</span>
                <div className="min-w-0">
                  <p className="font-sans text-entry text-ink">{t(`rehab.stage.${row.stage}`)}</p>
                  <p className="font-serif text-note italic text-pencil">
                    {t(`rehab.historyBy.${row.setBy}`)}
                  </p>
                  {row.sourceQuote && (
                    <p className="mt-1 font-serif text-note italic leading-relaxed text-pencil">
                      “{row.sourceQuote}”
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Framework §15 — renders wherever this does. */}
      <p className="marginalia mt-5">{t('rehab.disclaimer')}</p>
    </section>
  );
}
