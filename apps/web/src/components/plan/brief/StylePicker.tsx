'use client';

import { SquarePen } from 'lucide-react';
import { STYLE_DIRECTIONS, STYLE_OTHER } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { SelectionBadge } from './ChoiceCard';
import { OtherTextField } from './OtherTextField';
import { StyleCard } from './StyleCard';

/**
 * The style gallery: one photograph each, single select.
 *
 * Wider cards than the space grid and fewer of them, because a style has to be *compared* rather
 * than recognised — the four sit in one row on a desktop so the eye can run along them, which is
 * the whole mechanism by which a picture answers this question better than a phrase does.
 */
export function StylePicker() {
  const style = useBriefStore((state) => state.present.style);
  const styleOther = useBriefStore((state) => state.present.styleOther);
  const setStyle = useBriefStore((state) => state.setStyle);
  const setStyleOther = useBriefStore((state) => state.setStyleOther);

  return (
    <div>
      <ul
        role="radiogroup"
        aria-label="Style direction"
        data-testid="style-directions"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
      >
        {STYLE_DIRECTIONS.map((option) => (
          <li key={option.id}>
            <StyleCard
              option={option}
              checked={style === option.id}
              onSelect={() => setStyle(option.id)}
            />
          </li>
        ))}

        <li>
          {/* Dashed and icon-only, because there is no picture of "something else". */}
          <label
            className={[
              'relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border-2 border-dashed transition-colors',
              'focus-within:ring-2 focus-within:ring-garden-green',
              style === 'other'
                ? 'border-garden-green bg-garden-sage/60'
                : 'border-garden-line bg-white hover:border-garden-green/50',
            ].join(' ')}
          >
            <input
              type="radio"
              name="style"
              data-testid="style-other"
              checked={style === 'other'}
              onChange={() => setStyle('other')}
              aria-label={STYLE_OTHER.label}
              className="sr-only"
            />

            <SelectionBadge checked={style === 'other'} />
            <span className="flex aspect-3/2 w-full items-center justify-center">
              <SquarePen aria-hidden className="h-6 w-6 text-garden-muted" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
              <span className="truncate text-sm leading-tight font-semibold text-garden-ink">
                {STYLE_OTHER.label}
              </span>
              <span className="text-xs leading-snug text-garden-muted">
                {STYLE_OTHER.description}
              </span>
            </span>
          </label>
        </li>
      </ul>

      {style === 'other' ? (
        <OtherTextField
          testId="style-other-text"
          label="Describe the style you have in mind"
          placeholder="e.g. Japanese, Mediterranean, coastal"
          value={styleOther}
          onChange={setStyleOther}
        />
      ) : null}
    </div>
  );
}
