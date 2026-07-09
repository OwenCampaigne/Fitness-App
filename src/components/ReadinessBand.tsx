'use client'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { ReadinessResult } from '@/types/readiness'
import PainStatusModal from './PainStatusModal'

type BandKey = 'green' | 'amber' | 'red'

const BAND_CONFIG: Record<BandKey, { dot: string; text: string; label: string; bg: string }> = {
  green: {
    dot: 'bg-recovery-green',
    text: 'text-recovery-green',
    label: 'GREEN',
    bg: 'bg-recovery-green/10',
  },
  amber: {
    dot: 'bg-recovery-yellow',
    text: 'text-recovery-yellow',
    label: 'AMBER',
    bg: 'bg-recovery-yellow/10',
  },
  red: {
    dot: 'bg-recovery-red',
    text: 'text-recovery-red',
    label: 'RED',
    bg: 'bg-recovery-red/10',
  },
}

interface Props {
  result: ReadinessResult
  scenarioMode?: string
}

export default function ReadinessBand({ result, scenarioMode }: Props) {
  const [showPainModal, setShowPainModal] = useState(false)
  const config = BAND_CONFIG[result.band]

  const lastSynced = result.lastSyncedAt
    ? formatDistanceToNow(new Date(result.lastSyncedAt), { addSuffix: true })
    : 'never'

  const painCurrent = result.painFlagged ? 'yes' : 'none'

  return (
    <>
      {/* Main readiness card */}
      <div className={`relative rounded-2xl p-5 ${config.bg}`}>
        {scenarioMode && (
          <div className="absolute top-3 right-3">
            <span className="text-[9px] font-mono bg-border/80 text-secondary px-1.5 py-0.5 rounded">
              SCENARIO: {scenarioMode}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 mb-1">
          <div className={`w-4 h-4 rounded-full flex-shrink-0 ${config.dot}`} />
          <span className={`text-2xl font-black tracking-tight ${config.text}`}>
            {config.label}
          </span>
          {result.provisional && (
            <span className="text-[10px] text-muted border border-border px-1.5 py-0.5 rounded-full">
              provisional
            </span>
          )}
        </div>

        <p className="text-base font-semibold text-primary mb-4 ml-7">
          {result.plainText}
        </p>

        <div className="flex gap-2 ml-7">
          {result.decidingSignals.map((sig, i) => (
            <span
              key={i}
              className="text-xs font-mono text-secondary bg-bg/60 px-2.5 py-1 rounded-lg"
            >
              {sig}
            </span>
          ))}
        </div>
      </div>

      {/* Secondary stats */}
      {(result.sleepHours !== null || result.bodyBattery !== null || result.stress !== null) && (
        <div className="card flex flex-col gap-2.5">
          {result.sleepHours !== null && (
            <StatRow
              label="Sleep"
              value={`${result.sleepHours.toFixed(1)}h`}
              score={result.signals.sleepScore}
              max={100}
            />
          )}
          {result.bodyBattery !== null && (
            <StatRow
              label="Body Battery"
              value={`${Math.round(result.bodyBattery)}`}
              score={result.bodyBattery}
              max={100}
            />
          )}
          {result.stress !== null && (
            <StatRow
              label="Stress"
              value={`${Math.round(result.stress)}`}
              score={100 - result.stress}
              max={100}
            />
          )}
        </div>
      )}

      {/* Calibration warning */}
      {result.provisional && result.daysUntilCalibrated !== null && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface border border-recovery-yellow/30">
          <span className="text-xs text-recovery-yellow">
            Still calibrating · {result.daysUntilCalibrated} day
            {result.daysUntilCalibrated !== 1 ? 's' : ''} left · Being conservative
          </span>
        </div>
      )}

      {/* Pain chip */}
      {result.painFlagged && (
        <button
          onClick={() => setShowPainModal(true)}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface border border-recovery-yellow/40 w-full text-left"
        >
          <span className="text-recovery-yellow text-xs">
            Knee pain flagged · Prehab only · Tap to update
          </span>
        </button>
      )}

      {/* Last synced */}
      <p className="text-[11px] text-muted text-center">Last synced {lastSynced}</p>

      {showPainModal && (
        <PainStatusModal
          current={painCurrent as 'none' | 'sometimes' | 'yes'}
          onClose={() => setShowPainModal(false)}
          onSaved={() => {
            setShowPainModal(false)
            window.location.reload()
          }}
        />
      )}
    </>
  )
}

function StatRow({
  label, value, score, max,
}: {
  label: string
  value: string
  score: number
  max: number
}) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100))
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-secondary shrink-0">{label}</span>
      <span className="font-mono text-primary w-10 shrink-0">{value}</span>
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/40 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
