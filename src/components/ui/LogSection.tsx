import type { ReactNode } from 'react';

// ── A section of the log ──────────────────────────────────────────────────────
// Not a card. A ruled break, a label hanging in the coach's handwriting, and
// the thing itself. Every block on /trends is one of these, which is why none
// of them needs to restate the same six classes.

export default function LogSection({
  label,
  figure,
  children,
  className,
}: {
  /** What this block is, in the coach's voice. Sentence case, never shouted. */
  label: string;
  /** The one number worth reading before the block itself. */
  figure?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-rule pt-3 ${className ?? ''}`}>
      <div className="flex items-baseline gap-3">
        <h2 className="block-label mb-0">{label}</h2>
        {figure != null && <div className="ml-auto shrink-0">{figure}</div>}
      </div>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
