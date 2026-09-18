'use client'

// ── The verdict (framework §14 step 1) ────────────────────────────────────────
// The hero of the whole product: one word, stamped at the top of the page, with
// the two numbers that decided it directly underneath and the plain-language
// line between them.
//
// Not a coloured pill. The word itself carries the colour, because this and a
// safety flag are the only two things on the screen allowed any — a page where
// six things are coloured is a page where nothing is emphasised.
//
// While the baselines are still calibrating the verdict is a guess, so it is
// set in pencil rather than ink and the deciding numbers go with it. Dressing a
// provisional verdict in the same weight as a settled one is exactly the lie
// this type system exists to refuse.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { useLang } from '@/lib/i18n'
import type { ReadinessResult } from '@/types/readiness'
import PainStatusModal from './PainStatusModal'

type BandKey = 'green' | 'amber' | 'red'

const BAND_INK: Record<BandKey, string> = {
  green: 'text-ready',
  amber: 'text-caution',
  red: 'text-stop',
}

/**
 * The locale bundle loads in an effect, so the first paint has no messages and
 * `t` hands back the key. Everywhere else that shows for a frame and nobody
 * notices — but this word is 2.75rem and it is the answer the page exists to
 * give, so it gets a fallback rather than a flash of `readiness.bands.green`.
 */
const BAND_FALLBACK: Record<BandKey, string> = {
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
}

interface Props {
  result: ReadinessResult
  scenarioMode?: string
  /**
   * Drop the secondary stat rows and the sync line.
   *
   * The Today screen is "one screen, one answer" (§14) and explicitly not a
   * dashboard — the verdict, the two deciding numbers, the plain-language line
   * and the calibration note earn their place there; sleep, body battery and
   * stress belong on the pages built around them. Defaults off, so every other
   * caller keeps the full read-out.
   */
  compact?: boolean
}

export default function ReadinessBand({ result, scenarioMode, compact = false }: Props) {
  const { t } = useLang()
  const [showPainModal, setShowPainModal] = useState(false)
  const router = useRouter()

  const lastSynced = result.lastSyncedAt
    ? formatDistanceToNow(new Date(result.lastSyncedAt), { addSuffix: true })
    : t('readiness.never')

  const painCurrent = result.currentPainLevel ?? (result.painFlagged ? 'yes' : 'none')

  // Measured until the baselines they are compared against have settled.
  const figureClass = result.provisional ? 'estimated' : 'measured'

  const bandKey = `readiness.bands.${result.band}`
  const bandWord = t(bandKey) === bandKey ? BAND_FALLBACK[result.band] : t(bandKey)

  return (
    <>
      <section aria-label={t('readiness.label')} className="pt-1">
        {scenarioMode && (
          <p className="block-label">{t('readiness.scenario', { name: scenarioMode })}</p>
        )}

        {/* The stamp. */}
        <p
          className={`font-serif text-verdict ${
            result.provisional ? 'text-pencil' : BAND_INK[result.band]
          }`}
        >
          {bandWord}
        </p>

        <p className="prose-log mt-1.5">{result.plainText}</p>

        {/* The two numbers that decided it, ruled off under the word. */}
        <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-1 border-t border-rule pt-2">
          {result.decidingSignals.map((signal, i) => (
            <li key={i} className={`text-entry ${figureClass}`}>
              {signal}
            </li>
          ))}
        </ul>

        {result.provisional && (
          <p className="marginalia mt-2.5">
            {result.daysUntilCalibrated !== null
              ? t('readiness.provisional', { days: result.daysUntilCalibrated })
              : t('readiness.provisionalNoDays')}
          </p>
        )}
      </section>

      {/* A safety flag — the second and last place colour is allowed. */}
      {result.painFlagged && (
        <button
          type="button"
          onClick={() => setShowPainModal(true)}
          className="w-full text-left border-l-2 border-caution pl-3 py-1 text-entry text-caution hover:text-ink transition-colors"
        >
          {t('readiness.pain')}
        </button>
      )}

      {/* The rest of the read-out, for the pages that are dashboards. */}
      {!compact &&
        (result.sleepHours !== null || result.bodyBattery !== null || result.stress !== null) && (
          <div className="border-t border-rule pt-2">
            {result.sleepHours !== null && (
              <StatRow
                label={t('readiness.stats.sleep')}
                value={`${result.sleepHours.toFixed(1)} h`}
                score={result.signals.sleepScore}
                max={100}
              />
            )}
            {result.bodyBattery !== null && (
              <StatRow
                label={t('readiness.stats.battery')}
                value={`${Math.round(result.bodyBattery)}`}
                score={result.bodyBattery}
                max={100}
              />
            )}
            {result.stress !== null && (
              <StatRow
                label={t('readiness.stats.stress')}
                value={`${Math.round(result.stress)}`}
                score={100 - result.stress}
                max={100}
              />
            )}
          </div>
        )}

      {!compact && (
        <p className="text-note text-faint">{t('readiness.synced', { when: lastSynced })}</p>
      )}

      {showPainModal && (
        <PainStatusModal
          current={painCurrent as 'none' | 'sometimes' | 'yes'}
          onClose={() => setShowPainModal(false)}
          onSaved={() => {
            setShowPainModal(false)
            router.refresh()
          }}
        />
      )}
    </>
  )
}

function StatRow({
  label,
  value,
  score,
  max,
}: {
  label: string
  value: string
  score: number
  max: number
}) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100))
  return (
    <div className="entry flex items-center gap-3 py-2">
      <span className="font-serif italic text-note text-pencil w-28 shrink-0">{label}</span>
      <span className="measured text-entry w-14 shrink-0 text-right">{value}</span>
      <div className="flex-1 h-px bg-rule relative">
        <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
