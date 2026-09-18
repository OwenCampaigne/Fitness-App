'use client'

// ── The preference library (framework §13) ────────────────────────────────────
// Four lists, in the order the athlete needs them:
//
//   1. **Active** — what binds, grouped by the part of training it speaks to,
//      each marked with whether it actually applies *today* (a weekend rule on
//      a Tuesday is real and inert, and saying so is the honest version).
//   2. **Waiting on you** — rules heard in conversation and patterns inferred
//      from edits. Neither binds. Each shows where it came from — the athlete's
//      own words for a stated one, the evidence rows for an inferred one — and
//      **what confirming it would retire**, before anything is retired.
//   3. **Disagreements** — live rules whose days overlap and whose answers
//      differ. The app does not pick a winner; it points at the pair.
//   4. **No longer true** — the retired ones, dated, with what replaced them.
//
// The through-line is that nothing here changes quietly. Confirming is the only
// action that makes a rule bind, and it is also the only one that retires
// anything, so a supersession is always something the athlete did on purpose.
//
// In the log that maps straight onto ink and pencil: a rule that binds is ink,
// a rule waiting on you is pencil, and a retired one is a struck-out line in a
// dated ledger — kept, because a diary does not erase.

import { useCallback, useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n'

type Scope = 'schedule' | 'modality' | 'exercise' | 'intensity' | 'other'
const SCOPES: Scope[] = ['schedule', 'modality', 'exercise', 'intensity', 'other']

interface PrefView {
  id: number
  label: string
  kind: string
  scope: Scope
  subject: string
  source: string
  origin: 'stated' | 'typed' | 'inferred'
  confidence: number
  confirmed: boolean
  sourceQuote: string | null
  statedOn: string | null
  confirmedAt: string | null
  supersededById: number | null
  sampleSize: number | null
  evidence: string[]
  bindingToday: boolean
}

interface PendingView extends PrefView {
  wouldSupersede: Array<{ id: number; label: string }>
}

interface HistoryView extends PrefView {
  retiredOn: string | null
}

interface Conflict {
  aId: number
  bId: number
  aLabel: string
  bLabel: string
  overlapDays: number[]
  reason: string
}

interface LibraryResponse {
  active: PrefView[]
  pending: PendingView[]
  conflicts: Conflict[]
  history: HistoryView[]
  error?: string
}

const SMALL_BTN = 'rounded-sm border border-rule px-2.5 py-1 font-sans text-note transition-colors disabled:opacity-40'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-rule pt-4">
      <h2 className="font-serif text-head text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function PreferencesClient({ today }: { today: string }) {
  const { t } = useLang()

  const [data, setData] = useState<LibraryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/preferences', { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as LibraryResponse
      if (!res.ok) throw new Error(json.error ?? t('prefs.error'))
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('prefs.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function act(body: Record<string, unknown>, id: number) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? t('prefs.actionError'))
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('prefs.actionError'))
    } finally {
      setBusy(null)
    }
  }

  async function add() {
    const value = text.trim()
    if (!value) return
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      // A rule it cannot type is refused rather than approximated, and the
      // refusal is the server's own words — it names the shapes that do work.
      if (!res.ok) throw new Error(json.error ?? t('prefs.actionError'))
      setText('')
      await load()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t('prefs.actionError'))
    } finally {
      setAdding(false)
    }
  }

  function originLabel(pref: PrefView): string {
    if (pref.origin === 'stated') return t('prefs.stated')
    if (pref.origin === 'inferred') return t('prefs.inferred')
    return t('prefs.typed')
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3">
          <p className="font-serif text-note italic text-pencil">{today}</p>
          <h1 className="font-serif text-head text-ink">{t('prefs.title')}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pb-28 pt-4">
        <p className="prose-log">{t('prefs.subtitle')}</p>

        {error && (
          <p role="alert" className="mt-4 font-sans text-entry text-stop">
            {error}
          </p>
        )}

        {loading && <p className="mt-6 font-serif text-note italic text-pencil">{t('common.loading')}</p>}

        {!loading && (
          <>
            {/* ── What binds ──────────────────────────────────────────────── */}
            <Section title={t('prefs.active.title')}>
              {!data || data.active.length === 0 ? (
                <p className="prose-log text-entry">{t('prefs.empty')}</p>
              ) : (
                SCOPES.map((scope) => {
                  const rules = data.active.filter((p) => p.scope === scope)
                  if (rules.length === 0) return null
                  return (
                    <div key={scope} className="mb-5">
                      <p className="block-label">{t(`prefs.scope.${scope}`)}</p>
                      {rules.map((p) => (
                        <div key={p.id} className="entry">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="font-sans text-entry text-ink">{p.label}</p>
                            <span
                              className={
                                p.bindingToday
                                  ? 'flex-shrink-0 font-sans text-note font-semibold text-ink'
                                  : 'flex-shrink-0 font-serif text-note italic text-pencil'
                              }
                            >
                              {p.bindingToday ? t('prefs.bindingToday') : t('prefs.inert')}
                            </span>
                          </div>
                          <p className="mt-0.5 font-serif text-note italic text-pencil">
                            {originLabel(p)}
                            {p.statedOn ? ` · ${t('prefs.statedOn', { date: p.statedOn })}` : ''}
                          </p>
                          {p.sourceQuote && <p className="marginalia mt-1.5">“{p.sourceQuote}”</p>}
                          <button
                            type="button"
                            onClick={() => void act({ retire: p.id }, p.id)}
                            disabled={busy === p.id}
                            className="mt-2 font-sans text-note text-pencil underline underline-offset-2 transition-colors hover:text-stop disabled:opacity-40"
                          >
                            {busy === p.id ? t('prefs.retiring') : t('prefs.retire')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                })
              )}
            </Section>

            {/* ── Waiting on you — binding on nothing until confirmed ─────── */}
            <Section title={t('prefs.pending.title')}>
              {!data || data.pending.length === 0 ? (
                <p className="font-serif text-note italic text-pencil">{t('prefs.pending.none')}</p>
              ) : (
                <>
                  <p className="prose-log text-entry">{t('prefs.pending.note')}</p>
                  <div className="mt-3">
                    {data.pending.map((p) => (
                      <div key={p.id} className="entry">
                        {/* Pencil, not ink: nothing here is acting on anything. */}
                        <p className="font-sans text-entry text-pencil">{p.label}</p>
                        <p className="figures mt-0.5 font-serif text-note italic text-pencil">
                          {originLabel(p)} ·{' '}
                          {t('prefs.confidence', { value: Math.round(p.confidence * 100) })}
                          {p.sampleSize ? ` · ${t('prefs.sample', { count: p.sampleSize })}` : ''}
                        </p>
                        {p.sourceQuote && <p className="marginalia mt-1.5">“{p.sourceQuote}”</p>}
                        {p.evidence.length > 0 && (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-serif text-note italic text-pencil">
                              {t('prefs.pending.evidence')}
                            </summary>
                            <ul className="mt-1">
                              {p.evidence.map((e, i) => (
                                <li key={i} className="font-sans text-note text-pencil">
                                  · {e}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {p.wouldSupersede.length > 0 && (
                          <p className="mt-2 border-l border-ink pl-2.5 font-sans text-note leading-relaxed text-ink">
                            {t('prefs.pending.wouldSupersede', {
                              labels: p.wouldSupersede.map((s) => s.label).join(', '),
                            })}
                          </p>
                        )}
                        <div className="mt-2.5 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void act({ confirm: p.id }, p.id)}
                            disabled={busy === p.id}
                            className={`${SMALL_BTN} text-ink hover:border-ink`}
                          >
                            {t('prefs.pending.confirm')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void act({ dismiss: p.id }, p.id)}
                            disabled={busy === p.id}
                            className={`${SMALL_BTN} text-pencil hover:text-stop`}
                          >
                            {t('prefs.pending.dismiss')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Section>

            {/* ── Disagreements the graph will not resolve for you ────────── */}
            {data && data.conflicts.length > 0 && (
              <Section title={t('prefs.conflicts.title')}>
                <p className="prose-log text-entry">{t('prefs.conflicts.note')}</p>
                <div className="mt-3">
                  {data.conflicts.map((c) => (
                    <div key={`${c.aId}-${c.bId}`} className="entry border-l-2 border-ink pl-3">
                      <p className="font-sans text-entry text-ink">{c.aLabel}</p>
                      <p className="font-sans text-entry text-ink">{c.bLabel}</p>
                      <p className="mt-1 font-serif text-note italic text-pencil">{c.reason}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── What used to be true ────────────────────────────────────── */}
            <Section title={t('prefs.history.title')}>
              {!data || data.history.length === 0 ? (
                <p className="font-serif text-note italic text-pencil">{t('prefs.history.none')}</p>
              ) : (
                <ul>
                  {data.history.map((p) => (
                    <li key={p.id} className="entry grid grid-cols-[5.5rem_1fr] gap-x-3">
                      <span className="figures font-sans text-note text-pencil">
                        {p.retiredOn ?? p.statedOn ?? ''}
                      </span>
                      <div className="min-w-0">
                        <p className="font-sans text-entry text-pencil line-through">{p.label}</p>
                        <p className="mt-0.5 font-serif text-note italic text-pencil">
                          {p.statedOn ? `${t('prefs.statedOn', { date: p.statedOn })} · ` : ''}
                          {p.supersededById
                            ? t('prefs.history.replacedBy', { id: p.supersededById })
                            : t('prefs.history.retiredByHand')}
                        </p>
                        {p.sourceQuote && <p className="marginalia mt-1.5">“{p.sourceQuote}”</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* ── Add one by hand ─────────────────────────────────────────── */}
            <Section title={t('prefs.add.title')}>
              <label htmlFor="prefs-add" className="block font-serif text-note italic text-pencil">
                {t('prefs.add.hint')}
              </label>
              <div className="mt-2 flex items-end gap-3">
                <input
                  id="prefs-add"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('prefs.add.placeholder')}
                  aria-invalid={addError ? true : undefined}
                  aria-describedby={addError ? 'prefs-add-error' : undefined}
                  className="w-full flex-1 rounded-none border-0 border-b border-rule bg-transparent px-0 py-2 font-sans text-entry text-ink placeholder:text-faint focus:border-ink"
                />
                <button
                  type="button"
                  onClick={() => void add()}
                  disabled={adding || text.trim().length === 0}
                  className={`${SMALL_BTN} flex-shrink-0 py-2 text-ink hover:border-ink`}
                >
                  {adding ? t('prefs.add.saving') : t('prefs.add.submit')}
                </button>
              </div>
              {addError && (
                <p id="prefs-add-error" role="alert" className="mt-2 font-sans text-note text-stop">
                  {addError}
                </p>
              )}
            </Section>
          </>
        )}
      </main>
    </>
  )
}
