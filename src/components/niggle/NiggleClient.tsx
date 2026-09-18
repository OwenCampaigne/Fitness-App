'use client'

// ── The niggle tracker (framework §9, §15) ────────────────────────────────────
// "Left Achilles, 3/10" goes in; a targeted protocol, a load down-weight and an
// escalation verdict come out. This is the most medical-adjacent surface in the
// app, so it is also the most conservative:
//
//   · the §15 disclaimer comes from the API on every response and is rendered
//     from that value — never retyped here, so the UI cannot drift from the
//     wording or forget it
//   · the app describes a region and a protocol and never names a condition;
//     any authored copy that would has already been dropped server-side by
//     `containsDiagnosisLanguage`
//   · `stop_and_refer` is terminal — nothing more is prescribed into that area
//     and the screen says to see a professional
//
// Everything it shows about what the engine decided comes from the engine's own
// `reason` and `flag` strings. Re-wording them here would be the app forming
// its own opinion about someone's body.
//
// Typographically it is the Today screen's sibling: entries ruled apart with
// hanging serif labels, the escalation level stamped as a word in the margin,
// and ink for what you reported against pencil for what was worked out from it.

import { useCallback, useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n'
import { prescriptionLine } from '@/lib/todayView'
import type {
  BodyRegion,
  EscalationLevel,
  NiggleAssessment,
  NiggleQuality,
  NiggleSide,
  SeverityTrend,
} from '@/types/movement'
import type { SessionItem } from '@/types/session'

const REGIONS: BodyRegion[] = [
  'ankle_foot',
  'shin',
  'knee',
  'hip',
  'hamstring',
  'low_back',
  'other',
]
const SIDES: NiggleSide[] = ['left', 'right', 'both']
const QUALITIES: NiggleQuality[] = ['dull', 'achy', 'tight', 'stiff', 'sharp', 'burning']

/** A safety verdict is the one thing on this page allowed any colour. */
const LEVEL_INK: Record<EscalationLevel, string> = {
  none: 'text-pencil',
  monitor: 'text-caution',
  downweight: 'text-caution',
  stop_and_refer: 'text-stop',
}

const LEVEL_RULE: Record<EscalationLevel, string> = {
  none: 'border-rule',
  monitor: 'border-caution',
  downweight: 'border-caution',
  stop_and_refer: 'border-stop',
}

const TREND_TEXT: Record<SeverityTrend, string> = {
  improving: 'improving',
  stable: 'stable',
  worsening: 'worsening',
}

const FIELD =
  'w-full bg-transparent border-0 border-b border-rule focus:border-ink py-2 text-entry text-ink rounded-none'

interface ListResponse {
  niggles: NiggleAssessment[]
  episodeIds: Record<string, number | null>
  disclaimer: string
  scenarioMode?: string | null
  error?: string
}

interface LogResponse {
  ok: boolean
  persisted: boolean
  assessment: NiggleAssessment | null
  prescribed: {
    items: SessionItem[]
    targeted: boolean
    why: string
    flag: string | null
    disclaimer: string
    adjustment: { summary: string } | null
  } | null
  escalation: { level: EscalationLevel; reason: string; flag: string | null } | null
  disclaimer: string
  error?: string
}

function episodeKey(region: BodyRegion, side: NiggleSide | null): string {
  return `${region}|${side ?? 'none'}`
}

export default function NiggleClient() {
  const { t } = useLang()

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [region, setRegion] = useState<BodyRegion>('ankle_foot')
  const [side, setSide] = useState<NiggleSide | ''>('')
  const [severity, setSeverity] = useState(3)
  const [quality, setQuality] = useState<NiggleQuality | ''>('')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<LogResponse | null>(null)
  const [resolving, setResolving] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/niggle', { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as ListResponse
      if (!res.ok) throw new Error(json.error ?? t('niggle.error'))
      setData(json)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('niggle.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    setSaving(true)
    setFormError(null)
    setResult(null)
    try {
      const res = await fetch('/api/niggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyRegion: region,
          ...(side ? { side } : {}),
          severity,
          ...(quality ? { quality } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as LogResponse
      if (!res.ok) throw new Error(json.error ?? t('niggle.form.error'))
      setResult(json)
      setNotes('')
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('niggle.form.error'))
    } finally {
      setSaving(false)
    }
  }

  async function resolve(id: number) {
    setResolving(id)
    try {
      const res = await fetch('/api/niggle/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? t('niggle.active.resolveError'))
      setResult(null)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('niggle.active.resolveError'))
    } finally {
      setResolving(null)
    }
  }

  if (loading) {
    return <p className="font-serif italic text-note text-pencil py-8">{t('niggle.loading')}</p>
  }

  // The disclaimer is the API's, always. A failure to load it is a reason to
  // show less, never a reason to render this screen without it (§15).
  const disclaimer = result?.disclaimer ?? data?.disclaimer ?? null
  const active = (data?.niggles ?? []).filter((n) => n.level !== 'none' || n.currentSeverity > 0)

  return (
    <div className="flex flex-col gap-5">
      {loadError && (
        <div className="border-l-2 border-stop pl-3 py-1">
          <p className="text-entry text-stop leading-relaxed">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-note text-stop underline underline-offset-4"
          >
            {t('niggle.retry')}
          </button>
        </div>
      )}

      {/* ── Log one ──────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="block-label mb-0">{t('niggle.form.title')}</h2>
          {data?.scenarioMode && (
            <span className="ml-auto text-note text-faint">{data.scenarioMode}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 mt-1">
          <div className="entry py-2">
            <label htmlFor="niggle-region" className="block-label block">
              {t('niggle.form.region')}
            </label>
            <select
              id="niggle-region"
              value={region}
              onChange={(e) => setRegion(e.target.value as BodyRegion)}
              className={FIELD}
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`niggle.regions.${r}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="entry py-2">
            <label htmlFor="niggle-side" className="block-label block">
              {t('niggle.form.side')}
            </label>
            <select
              id="niggle-side"
              value={side}
              onChange={(e) => setSide(e.target.value as NiggleSide | '')}
              className={FIELD}
            >
              <option value="">{t('niggle.form.sideNone')}</option>
              {SIDES.map((s) => (
                <option key={s} value={s}>
                  {t(`niggle.sides.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="entry py-2">
          <label htmlFor="niggle-severity" className="block-label block">
            {t('niggle.form.severity')}
          </label>
          <div className="flex items-center gap-4">
            <input
              id="niggle-severity"
              type="range"
              min={0}
              max={10}
              step={1}
              value={severity}
              onChange={(e) => setSeverity(Number(e.target.value))}
              className="flex-1 accent-ink"
            />
            {/* You felt it and you reported it. That is a measurement. */}
            <span className="measured font-serif text-head w-8 text-right">{severity}</span>
          </div>
        </div>

        <div className="entry py-2">
          <label htmlFor="niggle-quality" className="block-label block">
            {t('niggle.form.quality')}
          </label>
          <select
            id="niggle-quality"
            value={quality}
            onChange={(e) => setQuality(e.target.value as NiggleQuality | '')}
            className={FIELD}
          >
            <option value="">{t('niggle.form.qualityNone')}</option>
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {t(`niggle.qualities.${q}`)}
              </option>
            ))}
          </select>
          {quality === 'sharp' && (
            <p className="mt-2 border-l-2 border-caution pl-3 text-entry text-caution leading-relaxed">
              {t('niggle.form.sharpNote')}
            </p>
          )}
        </div>

        <div className="entry py-2">
          <label htmlFor="niggle-notes" className="block-label block">
            {t('niggle.form.notes')}
          </label>
          <input
            id="niggle-notes"
            type="text"
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('niggle.form.notesPlaceholder')}
            className={`${FIELD} placeholder:text-faint`}
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="mt-3 w-full border border-ink text-ink text-entry font-medium py-2.5 rounded-sm disabled:opacity-40 hover:bg-ink hover:text-paper transition-colors"
        >
          {saving ? t('niggle.form.saving') : t('niggle.form.submit')}
        </button>

        {formError && <p className="mt-2 text-note text-stop">{formError}</p>}
      </section>

      {/* ── What the engine did about it ─────────────────────────────────── */}
      {result && (
        <section className="border-t border-rule pt-2">
          <p className="block-label">{t('niggle.prescribed.title')}</p>

          {result.escalation && (
            <div className={`border-l-2 pl-3 ${LEVEL_RULE[result.escalation.level]}`}>
              <p className={`font-serif text-head ${LEVEL_INK[result.escalation.level]}`}>
                {t(`niggle.levels.${result.escalation.level}`)}
              </p>
              <p className="text-entry text-ink leading-relaxed mt-0.5">
                {result.escalation.reason}
              </p>
              {result.escalation.flag && (
                <p
                  className={`text-entry leading-relaxed mt-1.5 ${
                    LEVEL_INK[result.escalation.level]
                  }`}
                >
                  {result.escalation.flag}
                </p>
              )}
            </div>
          )}

          {result.prescribed && (
            <>
              <p className="prose-log mt-3">{result.prescribed.why}</p>
              {result.prescribed.adjustment && (
                <p className="mt-1.5 text-entry text-caution leading-relaxed">
                  {result.prescribed.adjustment.summary}
                </p>
              )}
              {result.prescribed.items.length > 0 ? (
                <ul className="mt-2">
                  {result.prescribed.items.map((item) => (
                    <li key={item.id} className="entry py-2">
                      <p className="text-entry text-ink">{item.ref.name}</p>
                      {/* A prescription is the plan, not the record. Pencil. */}
                      <p className="estimated text-entry">{prescriptionLine(item.params)}</p>
                      {item.why && <p className="marginalia mt-1">{item.why}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-serif italic text-note text-pencil mt-2">
                  {t('niggle.prescribed.none')}
                </p>
              )}
            </>
          )}

          {!result.persisted && <p className="marginalia mt-3">{t('niggle.scenarioNote')}</p>}
        </section>
      )}

      {/* ── Active episodes ──────────────────────────────────────────────── */}
      <section className="border-t border-rule pt-2">
        <h2 className="block-label">{t('niggle.active.title')}</h2>

        {active.length === 0 ? (
          <p className="prose-log">{t('niggle.active.none')}</p>
        ) : (
          <ul>
            {active.map((n) => {
              const id = data?.episodeIds?.[episodeKey(n.bodyRegion, n.side)] ?? null
              return (
                <li key={episodeKey(n.bodyRegion, n.side)} className="entry">
                  <div className="flex items-baseline gap-3">
                    <span className="text-entry text-ink font-medium">
                      {t(`niggle.regions.${n.bodyRegion}`)}
                      {n.side ? ` · ${t(`niggle.sides.${n.side}`)}` : ''}
                    </span>
                    <span
                      className={`ml-auto shrink-0 font-serif italic text-note ${LEVEL_INK[n.level]}`}
                    >
                      {t(`niggle.levels.${n.level}`)}
                    </span>
                  </div>

                  {/* What you reported is ink; the trend read off it is pencil. */}
                  <p className="text-note mt-1">
                    <span className="measured">
                      {t('niggle.active.stats', {
                        severity: n.currentSeverity,
                        peak: n.peakSeverity,
                        days: n.daysActive,
                        reports: n.reports,
                      })}
                    </span>{' '}
                    <span className="estimated">
                      · {t(`niggle.active.trend.${TREND_TEXT[n.trend]}`)}
                    </span>
                  </p>

                  <p className="marginalia mt-1.5">{n.reason}</p>
                  {n.flag && (
                    <p className={`text-entry leading-relaxed mt-1.5 ${LEVEL_INK[n.level]}`}>
                      {n.flag}
                    </p>
                  )}
                  {!n.prescribeIntoRegion && (
                    <p className="text-entry text-stop leading-relaxed mt-1.5">
                      {t('niggle.active.closed')}
                    </p>
                  )}

                  {id !== null && (
                    <button
                      type="button"
                      onClick={() => void resolve(id)}
                      disabled={resolving === id}
                      className="mt-2 text-note text-pencil hover:text-ink underline underline-offset-4 decoration-rule hover:decoration-ink disabled:opacity-40 transition-colors"
                    >
                      {resolving === id ? t('niggle.active.resolving') : t('niggle.active.resolve')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* §15 — persistent, visible, and in the API's own words */}
      {disclaimer && <p className="marginalia">{disclaimer}</p>}
    </div>
  )
}
