'use client';

import { Check, Info } from 'lucide-react';
import type { BriefSectionId } from '@/lib/brief';

/**
 * One numbered question. The badge is the same `h-6 w-6` circle `SubStepChecklist` uses on
 * step 1 — forest while outstanding, green once answered — so the wizard numbers things the
 * same way on every screen.
 */
export function FormSection({
  id,
  number,
  title,
  hint,
  description,
  helper,
  done,
  children,
}: {
  id: BriefSectionId;
  number: number;
  title: string;
  /** The parenthetical after the title, e.g. "select all that apply". */
  hint?: string;
  description?: string;
  /** The muted line under the controls explaining what the answer is used for. */
  helper?: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={`brief-section-${id}`}
      data-done={done}
      className="rounded-xl border border-garden-line bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
            done ? 'bg-garden-green' : 'bg-garden-forest',
          ].join(' ')}
        >
          {done ? <Check aria-hidden className="h-3.5 w-3.5" /> : number}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-garden-ink">
            {title}
            {hint ? <span className="ml-1.5 font-normal text-garden-muted">({hint})</span> : null}
          </h2>

          {description ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-garden-muted">{description}</p>
          ) : null}

          <div className="mt-3">{children}</div>

          {helper ? (
            <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-garden-muted">
              <Info aria-hidden className="mt-px h-3 w-3 shrink-0" />
              {helper}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
