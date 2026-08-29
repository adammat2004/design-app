'use client';

import { SquarePen } from 'lucide-react';
import { STYLE_DIRECTIONS, STYLE_OTHER } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { ChoiceCard, SelectionBadge } from './ChoiceCard';
import { OtherTextField } from './OtherTextField';
import { StyleThumbnail } from './StyleThumbnail';

/**
 * Section 5. Same single-select contract as budget and maintenance — round badge, native
 * radio — laid out as a gallery, with the badge floating over the artwork.
 *
 * The artwork slot is one element, so swapping `StyleThumbnail` for real photography later
 * touches nothing else here.
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
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
      >
        {STYLE_DIRECTIONS.map((option) => (
          <li key={option.id}>
            <ChoiceCard
              testId={`style-${option.id}`}
              name="style"
              label={option.label}
              checked={style === option.id}
              onSelect={() => setStyle(option.id)}
              padded={false}
            >
              <span className="block aspect-4/3 w-full overflow-hidden bg-garden-sage/40">
                <StyleThumbnail style={option.id} />
              </span>
              <span className="border-t border-garden-line bg-white p-2.5 text-xs leading-tight font-semibold text-garden-ink">
                {option.label}
              </span>
            </ChoiceCard>
          </li>
        ))}

        <li>
          {/* Dashed and icon-only, because there is no picture of "something else". */}
          <label
            className={[
              'relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border-2 border-dashed transition-colors',
              'focus-within:ring-2 focus-within:ring-garden-green',
              style === 'other'
                ? 'border-garden-green shadow-sm'
                : 'border-garden-line hover:border-garden-green',
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
            <span className="flex aspect-4/3 w-full items-center justify-center bg-white">
              <SquarePen aria-hidden className="h-5 w-5 text-garden-muted" />
            </span>
            <span className="border-t border-dashed border-garden-line bg-white p-2.5 text-xs leading-tight font-semibold text-garden-ink">
              {STYLE_OTHER.label}
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
