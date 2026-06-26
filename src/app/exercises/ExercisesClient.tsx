'use client'

import { useState, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import type { ExerciseEntry, PlyoEntry, PrehabEntry, StretchEntry } from '@/types/library'
import { ExerciseCard, PlyoCard, PrehabCard, StretchCard } from '@/components/library'
import BottomNav from '@/components/BottomNav'

type Tab = 'exercises' | 'plyos' | 'prehab' | 'stretches'

const PAGE_SIZE = 50

interface Props {
  exercises: ExerciseEntry[]
  plyos: PlyoEntry[]
  prehab: PrehabEntry[]
  stretches: StretchEntry[]
}

// ── Chip button ───────────────────────────────────────────────────────────────
function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
        active
          ? 'bg-primary text-bg'
          : 'bg-surface text-secondary border border-border hover:text-primary',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ── Unique sorted values from an array field ──────────────────────────────────
function uniq(values: string[]): string[] {
  const seen: Record<string, true> = {}
  return values.filter((v) => {
    if (seen[v]) return false
    seen[v] = true
    return true
  }).sort()
}

export default function ExercisesClient({ exercises, plyos, prehab, stretches }: Props) {
  const [tab, setTab] = useState<Tab>('exercises')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Filter chip states
  const [exLevel, setExLevel] = useState<string | null>(null)
  const [exEquip, setExEquip] = useState<string | null>(null)
  const [plyoTier, setPlyoTier] = useState<number | null>(null)
  const [prehabRegion, setPrehabRegion] = useState<string | null>(null)
  const [stretchType, setStretchType] = useState<string | null>(null)
  const [stretchWhen, setStretchWhen] = useState<string | null>(null)

  // Reset visible count whenever filters change
  const resetPaging = () => setVisibleCount(PAGE_SIZE)

  // ── Derive filter options ──────────────────────────────────────────────────
  const exLevels = useMemo(
    () => uniq(exercises.map((e) => e.level ?? '').filter(Boolean)),
    [exercises],
  )
  const exEquips = useMemo(
    () => uniq(exercises.map((e) => e.equipment[0] ?? '').filter(Boolean)),
    [exercises],
  )
  const prehabRegions = useMemo(
    () => uniq(prehab.map((p) => p.bodyRegion)),
    [prehab],
  )
  const stretchTypes = useMemo(
    () => uniq(stretches.map((s) => s.type)),
    [stretches],
  )
  const stretchWhens = useMemo(
    () => uniq(stretches.map((s) => s.whenToUse)),
    [stretches],
  )

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const q = search.toLowerCase().trim()

  const filteredExercises = useMemo(() => {
    return exercises.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false
      if (exLevel && e.level?.toLowerCase() !== exLevel.toLowerCase()) return false
      if (exEquip && e.equipment[0]?.toLowerCase() !== exEquip.toLowerCase()) return false
      return true
    })
  }, [exercises, q, exLevel, exEquip])

  const filteredPlyos = useMemo(() => {
    return plyos.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (plyoTier !== null && p.progressionTier !== plyoTier) return false
      return true
    })
  }, [plyos, q, plyoTier])

  const filteredPrehab = useMemo(() => {
    return prehab.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (prehabRegion && p.bodyRegion !== prehabRegion) return false
      return true
    })
  }, [prehab, q, prehabRegion])

  const filteredStretches = useMemo(() => {
    return stretches.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false
      if (stretchType && s.type.toLowerCase() !== stretchType.toLowerCase()) return false
      if (stretchWhen && s.whenToUse.toLowerCase() !== stretchWhen.toLowerCase()) return false
      return true
    })
  }, [stretches, q, stretchType, stretchWhen])

  // Active list + count
  const { activeList, totalCount } = useMemo(() => {
    if (tab === 'exercises') return { activeList: filteredExercises as (ExerciseEntry | PlyoEntry | PrehabEntry | StretchEntry)[], totalCount: filteredExercises.length }
    if (tab === 'plyos') return { activeList: filteredPlyos as (ExerciseEntry | PlyoEntry | PrehabEntry | StretchEntry)[], totalCount: filteredPlyos.length }
    if (tab === 'prehab') return { activeList: filteredPrehab as (ExerciseEntry | PlyoEntry | PrehabEntry | StretchEntry)[], totalCount: filteredPrehab.length }
    return { activeList: filteredStretches as (ExerciseEntry | PlyoEntry | PrehabEntry | StretchEntry)[], totalCount: filteredStretches.length }
  }, [tab, filteredExercises, filteredPlyos, filteredPrehab, filteredStretches])

  const visibleList = activeList.slice(0, visibleCount)
  const hasMore = visibleCount < totalCount

  // ── Tab labels ─────────────────────────────────────────────────────────────
  const TABS: { key: Tab; label: string }[] = [
    { key: 'exercises', label: 'Exercises' },
    { key: 'plyos', label: 'Plyos' },
    { key: 'prehab', label: 'Prehab' },
    { key: 'stretches', label: 'Stretches' },
  ]

  const handleTabChange = (t: Tab) => {
    setTab(t)
    setSearch('')
    setVisibleCount(PAGE_SIZE)
  }

  const handleSearchChange = (v: string) => {
    setSearch(v)
    resetPaging()
  }

  // ── Count label ────────────────────────────────────────────────────────────
  const countLabel = (() => {
    const noun =
      tab === 'exercises' ? 'exercise' :
      tab === 'plyos' ? 'plyo' :
      tab === 'prehab' ? 'prehab exercise' :
      'stretch'
    return `${totalCount} ${noun}${totalCount !== 1 ? 's' : ''}`
  })()

  return (
    <div className="min-h-screen bg-bg">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3">
          <h1 className="text-sm font-bold text-primary">Library</h1>
        </div>

        {/* Tabs */}
        <div className="max-w-md mx-auto px-4 pb-2">
          <div className="flex gap-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={[
                  'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                  tab === key
                    ? 'bg-primary text-bg'
                    : 'text-secondary hover:text-primary hover:bg-surface',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-3">
        {/* ── Search bar ──────────────────────────────────────────────────── */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={`Search ${tab}…`}
            className="w-full bg-surface border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-primary/50 transition-colors"
          />
          {search && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Filter chips (tab-specific) ──────────────────────────────────── */}
        {tab === 'exercises' && (
          <div className="flex flex-col gap-2">
            {/* Level chips */}
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted uppercase tracking-wider self-center mr-1">Level</span>
              {exLevels.map((lvl) => (
                <Chip
                  key={lvl}
                  label={lvl}
                  active={exLevel === lvl}
                  onClick={() => {
                    setExLevel(exLevel === lvl ? null : lvl)
                    resetPaging()
                  }}
                />
              ))}
            </div>
            {/* Equipment chips */}
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted uppercase tracking-wider self-center mr-1">Equip</span>
              {exEquips.map((eq) => (
                <Chip
                  key={eq}
                  label={eq}
                  active={exEquip === eq}
                  onClick={() => {
                    setExEquip(exEquip === eq ? null : eq)
                    resetPaging()
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {tab === 'plyos' && (
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted uppercase tracking-wider self-center mr-1">Tier</span>
            {[1, 2, 3].map((tier) => (
              <Chip
                key={tier}
                label={`Tier ${tier}`}
                active={plyoTier === tier}
                onClick={() => {
                  setPlyoTier(plyoTier === tier ? null : tier)
                  resetPaging()
                }}
              />
            ))}
          </div>
        )}

        {tab === 'prehab' && (
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-[10px] text-muted uppercase tracking-wider self-center mr-1">Region</span>
            {prehabRegions.map((region) => (
              <Chip
                key={region}
                label={region}
                active={prehabRegion === region}
                onClick={() => {
                  setPrehabRegion(prehabRegion === region ? null : region)
                  resetPaging()
                }}
              />
            ))}
          </div>
        )}

        {tab === 'stretches' && (
          <div className="flex flex-col gap-2">
            {/* Type chips */}
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted uppercase tracking-wider self-center mr-1">Type</span>
              {stretchTypes.map((type) => (
                <Chip
                  key={type}
                  label={type}
                  active={stretchType === type}
                  onClick={() => {
                    setStretchType(stretchType === type ? null : type)
                    resetPaging()
                  }}
                />
              ))}
            </div>
            {/* When to use chips */}
            <div className="flex gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted uppercase tracking-wider self-center mr-1">When</span>
              {stretchWhens.map((when) => (
                <Chip
                  key={when}
                  label={when}
                  active={stretchWhen === when}
                  onClick={() => {
                    setStretchWhen(stretchWhen === when ? null : when)
                    resetPaging()
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Count ───────────────────────────────────────────────────────── */}
        <p className="text-xs text-muted">{countLabel}</p>

        {/* ── Card grid ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {totalCount === 0 && (
            <div className="card text-center py-8">
              <p className="text-sm text-secondary">No results found</p>
              <p className="text-xs text-muted mt-1">Try adjusting your search or filters</p>
            </div>
          )}

          {tab === 'exercises' &&
            (visibleList as ExerciseEntry[]).map((ex) => (
              <ExerciseCard key={ex.id} exercise={ex} />
            ))}

          {tab === 'plyos' &&
            (visibleList as PlyoEntry[]).map((pl) => (
              <PlyoCard key={pl.id} plyo={pl} />
            ))}

          {tab === 'prehab' &&
            (visibleList as PrehabEntry[]).map((pr) => (
              <PrehabCard key={pr.id} prehab={pr} />
            ))}

          {tab === 'stretches' &&
            (visibleList as StretchEntry[]).map((st) => (
              <StretchCard key={st.id} stretch={st} />
            ))}
        </div>

        {/* ── Load more ───────────────────────────────────────────────────── */}
        {hasMore && (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="w-full py-3 rounded-xl border border-border text-sm text-secondary hover:text-primary hover:border-primary/50 transition-colors"
          >
            Load {Math.min(PAGE_SIZE, totalCount - visibleCount)} more
            <span className="text-xs text-muted ml-1">
              ({visibleCount}/{totalCount})
            </span>
          </button>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
