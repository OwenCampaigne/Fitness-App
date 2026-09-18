'use client';

// ── Records table ─────────────────────────────────────────────────────────────
// One family of records — lifts or runs — with the date doing as much work as
// the number. A personal best with no date on it is a claim about today, and
// most of them are not: the currency band beside every row says how much of it
// still counts, and the row for a record set two years ago says so in words.
//
// No judgement here. `recordCurrency` in `lib/records.ts` decides the band and
// writes the sentence; this file only decides how dark to set it.
//
// And that is the whole design in one table. An anchor arc shows a belief
// moving *towards* ink as it is confirmed; a record shows a number fading
// *back* to graphite as it ages out of relevance. Same idea, drawn twice, in
// opposite directions — which is why neither of them uses a colour to say it.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { RecordBand, RecordFamily, RecordRow } from '@/lib/records';
import { formatRecordValue } from '@/lib/records';
import LogSection from '@/components/ui/LogSection';
import { useLang } from '@/lib/i18n';

/** How dark this record is still worth setting. Fresh is ink; old is graphite. */
const BAND_CLASS: Record<RecordBand, string> = {
  current: 'text-ink font-medium',
  aging: 'text-ink font-normal',
  stale: 'text-pencil font-normal',
  historical: 'text-faint font-normal',
};

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function RecordsTable({
  family,
  records,
}: {
  family: RecordFamily;
  records: RecordRow[];
}) {
  const { t } = useLang();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <LogSection label={t(`trends.history.${family}sTitle`)}>
      {records.length === 0 ? (
        <p className="prose-log text-note text-pencil">{t(`trends.history.${family}sEmpty`)}</p>
      ) : (
        <ul>
          {records.map((record) => {
            const bandClass = BAND_CLASS[record.currency.band];
            const expanded = open === record.id;
            return (
              <li key={record.id} className="entry py-2.5">
                <button
                  onClick={() => setOpen(expanded ? null : record.id)}
                  aria-expanded={expanded}
                  className="w-full text-left"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-entry text-ink truncate">{record.label}</span>
                    <span className={`text-head figures shrink-0 ${bandClass}`}>
                      {record.display}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-note text-pencil figures">
                      {shortDate(record.achievedOn)}
                    </span>
                    <span className="text-faint" aria-hidden="true">·</span>
                    <span className={`font-serif text-note italic ${bandClass}`}>
                      {t(`trends.history.band.${record.currency.band}`)}
                    </span>

                    {/* Evidence, not decoration: a stated best is pencil. */}
                    <span
                      className={`ml-auto font-serif text-note italic ${
                        record.verified ? 'text-ink' : 'text-pencil'
                      }`}
                    >
                      {record.verified
                        ? t('trends.history.verified')
                        : t(
                            record.source === 'stated'
                              ? 'trends.history.stated'
                              : 'trends.history.thin',
                          )}
                    </span>

                    <ChevronDown
                      size={12}
                      aria-hidden="true"
                      className={`text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {expanded && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {/* How much of this record still counts, in words */}
                    <p className="prose-log text-note text-pencil">{record.currency.note}</p>
                    <p className="text-note text-faint figures leading-snug">
                      {t('trends.history.confidence', {
                        pct: Math.round(record.currency.confidence * 100),
                        halfLife: record.currency.halfLifeDays,
                      })}
                    </p>
                    {record.notes && <p className="marginalia">{record.notes}</p>}

                    {/* Everything it beat, still dated — the record has a history */}
                    {record.history.length > 0 && (
                      <dl className="flex flex-col gap-0.5 pt-1.5 border-t border-rule">
                        <dt className="block-label mb-0">{t('trends.history.superseded')}</dt>
                        {record.history.map((entry) => (
                          <div key={entry.id} className="flex items-baseline justify-between gap-2">
                            <dd className="text-note text-faint figures">
                              {shortDate(entry.achievedOn)}
                            </dd>
                            <dd className="text-note text-pencil figures">
                              {formatRecordValue(record.unit, entry.value, null)}
                              {entry.source === 'stated' && ` · ${t('trends.history.stated')}`}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </LogSection>
  );
}
