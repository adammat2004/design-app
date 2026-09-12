'use client';

/**
 * The bones the side editor and the wall editor share: a header that names the segment and gives
 * its length, a one-line description of where it is relative to the house, and titled sections.
 *
 * Presentation only. The two editors differ in everything that matters — what a side is keyed on,
 * which way its normal points, what may sit on it — and a shared *schema* type for them would be a
 * union with two branches everywhere. What they genuinely share is how they look, and that is all
 * this file holds. It makes no assumption about the width it is given, so the panel can move into a
 * bottom sheet on a small screen without touching the editors.
 */

export function EditorHeader({
  icon,
  title,
  measure,
  detail,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  /** The segment's length, already formatted. */
  measure: string;
  /** Where it is relative to the house, or `null` when there is no house to say. */
  detail: string | null;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-garden-sage">
        {icon}
      </span>
      <div className="min-w-0">
        <p data-testid={testId} className="text-xs font-semibold text-garden-ink">
          {title}
          <span className="ml-1.5 font-normal text-garden-muted">{measure}</span>
        </p>
        {detail ? (
          <p data-testid={`${testId}-detail`} className="mt-0.5 text-[11px] text-garden-muted">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EditorSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-garden-line pt-3">
      <h3 className="text-[11px] font-semibold text-garden-ink">{title}</h3>
      {detail ? <p className="text-[10px] leading-relaxed text-garden-muted">{detail}</p> : null}
      {children}
    </section>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1">{children}</div>;
}
