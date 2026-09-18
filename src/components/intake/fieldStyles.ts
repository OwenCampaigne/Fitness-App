// ── Form furniture for the log ───────────────────────────────────────────────
// A field here is a ruled line you write on, not a box that floats. Two input
// variants, and which one a field gets is the whole design: `FIELD_INK` is for
// numbers transcribed from a clinician, `FIELD_PENCIL` for anything the athlete
// is recalling or guessing at. An estimate never renders as ink.

export const FIELD_INK =
  'w-full rounded-none border-0 border-b border-rule bg-transparent px-0 py-2 font-sans text-entry text-ink tabular-nums placeholder:text-faint placeholder:not-italic focus:border-ink';

export const FIELD_PENCIL =
  'w-full rounded-none border-0 border-b border-rule bg-transparent px-0 py-2 font-sans text-entry text-pencil tabular-nums placeholder:text-faint focus:border-ink';

/** The coach's hand: a label written in the margin, sentence case, never caps. */
export const FIELD_LABEL = 'block font-serif text-note italic text-pencil';

/** A picked answer is filled ink — the colour tokens are reserved for verdicts. */
export function choiceCls(active: boolean): string {
  return [
    'flex-1 rounded-sm border px-3 py-2 text-note transition-colors',
    active ? 'border-ink bg-ink font-semibold text-paper' : 'border-rule text-pencil hover:text-ink',
  ].join(' ');
}

export const BTN_INK =
  'flex items-center justify-center gap-2 rounded-sm bg-ink px-4 py-3 text-entry font-semibold text-paper transition-opacity disabled:opacity-40';

export const BTN_QUIET =
  'flex items-center justify-center gap-2 rounded-sm border border-rule px-4 py-3 text-entry text-ink transition-colors hover:border-ink disabled:opacity-40';
