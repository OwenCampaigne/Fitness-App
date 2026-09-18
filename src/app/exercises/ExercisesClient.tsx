'use client'

// ── /exercises — the library ─────────────────────────────────────────────────
// Four catalogs, 873 movements between them. This is the one screen in the app
// where browsing speed beats the ruled-entry-per-thing rhythm, so: a fixed
// header carrying the tabs, the search line and the filters, and beneath it a
// plain dense list. Everything above the list stays put while the list scrolls,
// because the whole job here is narrowing.

import { useState, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { useLang } from '@/lib/i18n'
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

// ── Filter chip ───────────────────────────────────────────────────────────────
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
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'whitespace-nowrap rounded-sm border px-2 py-0.5 font-sans text-note capitalize transition-colors',
        active
          ? 'border-ink bg-ink font-semibold text-paper'
          : 'border-rule text-pencil hover:text-ink',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-serif text-note italic text-pencil">{label}</span>
      {children}
    </div>
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
  const { t } = useLang()
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

  const TABS: { key: Tab; label: string }[] = [
    { key: 'exercises', label: t('library.tabs.exercises') },
    { key: 'plyos', label: t('library.tabs.plyos') },
    { key: 'prehab', label: t('library.tabs.prehab') },
    { key: 'stretches', label: t('library.tabs.stretches') },
  ]

  const handleTabChange = (next: Tab) => {
    setTab(next)
    setSearch('')
    setVisibleCount(PAGE_SIZE)
  }

  const handleSearchChange = (v: string) => {
    setSearch(v)
    resetPaging()
  }

  const clearFilters = () => {
    setSearch('')
    setExLevel(null)
    setExEquip(null)
    setPlyoTier(null)
    setPrehabRegion(null)
    setStretchType(null)
    setStretchWhen(null)
    resetPaging()
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* ── Header: everything that narrows the list ────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 pb-2 pt-3">
          <h1 className="font-serif text-head text-ink">{t('nav.exercises')}</h1>

          <div className="mt-2 flex gap-4 border-b border-rule">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => handleTabChange(key)}
                className={[
                  '-mb-px border-b-2 pb-1.5 font-sans text-entry transition-colors',
                  tab === key
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-pencil hover:text-ink',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Search ── */}
          <div className="relative mt-2">
            <label htmlFor="library-search" className="sr-only">
              {t('library.search')}
            </label>
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-pencil"
            />
            <input
              id="library-search"
              type="search"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t('library.search')}
              className="w-full rounded-none border-0 border-b border-rule bg-transparent py-2 pl-6 pr-7 font-sans text-entry text-ink placeholder:text-faint focus:border-ink"
            />
            {search && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                aria-label={t('library.clearSearch')}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-pencil transition-colors hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* ── Filters ── */}
          <div className="mt-2 flex flex-col gap-1.5">
            {tab === 'exercises' && (
              <>
                <FilterRow label={t('library.filters.level')}>
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
                </FilterRow>
                <FilterRow label={t('library.filters.equipment')}>
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
                </FilterRow>
              </>
            )}

            {tab === 'plyos' && (
              <FilterRow label={t('library.filters.tier')}>
                {[1, 2, 3].map((tier) => (
                  <Chip
                    key={tier}
                    label={t('library.tier', { n: tier })}
                    active={plyoTier === tier}
                    onClick={() => {
                      setPlyoTier(plyoTier === tier ? null : tier)
                      resetPaging()
                    }}
                  />
                ))}
              </FilterRow>
            )}

            {tab === 'prehab' && (
              <FilterRow label={t('library.filters.region')}>
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
              </FilterRow>
            )}

            {tab === 'stretches' && (
              <>
                <FilterRow label={t('library.filters.type')}>
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
                </FilterRow>
                <FilterRow label={t('library.filters.when')}>
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
                </FilterRow>
              </>
            )}
          </div>

          <p aria-live="polite" className="figures py-1.5 font-serif text-note italic text-pencil">
            {t('library.showing', { count: totalCount })}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pb-28">
        {totalCount === 0 && (
          <div className="py-10">
            <p className="font-sans text-entry text-ink">{t('library.none.title')}</p>
            <p className="prose-log mt-1 text-entry">{t('library.none.body')}</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 rounded-sm border border-rule px-3 py-1.5 font-sans text-note text-ink transition-colors hover:border-ink"
            >
              {t('library.none.clear')}
            </button>
          </div>
        )}

        {tab === 'exercises' &&
          (visibleList as ExerciseEntry[]).map((ex) => (
            <ExerciseCard key={ex.id} exercise={ex} />
          ))}

        {tab === 'plyos' &&
          (visibleList as PlyoEntry[]).map((pl) => <PlyoCard key={pl.id} plyo={pl} />)}

        {tab === 'prehab' &&
          (visibleList as PrehabEntry[]).map((pr) => <PrehabCard key={pr.id} prehab={pr} />)}

        {tab === 'stretches' &&
          (visibleList as StretchEntry[]).map((st) => <StretchCard key={st.id} stretch={st} />)}

        {hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="mt-4 w-full rounded-sm border border-rule py-2.5 font-sans text-entry text-ink transition-colors hover:border-ink"
          >
            {t('library.loadMore', { count: Math.min(PAGE_SIZE, totalCount - visibleCount) })}
            <span className="figures ml-1.5 font-serif text-note italic text-pencil">
              {t('library.shownOf', { shown: visibleCount, total: totalCount })}
            </span>
          </button>
        )}

        {/* Framework §15 — the prehab catalog is medical-adjacent, so the
            disclaimer renders wherever it is on screen. */}
        {tab === 'prehab' && <p className="marginalia mt-6">{t('library.disclaimer')}</p>}
      </main>

      <BottomNav />
    </div>
  )
}
