'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Check } from 'lucide-react';
import type { DesiredFeatureOption } from '@/lib/brief';
import { DesiredFeatureIcon } from './BriefIcons';

/**
 * One garden space, as a picture you can tick.
 *
 * The multi-select twin of `ChoiceCard`, and it keeps that file's contract in both halves:
 *
 * - **A real `<input type="checkbox">` hidden with `sr-only` inside its `<label>`**, so the whole
 *   card is a hit target, keyboard and screen-reader behaviour come for free, and nothing has to
 *   be simulated with `aria-pressed`. Same recipe `DesignAreasPanel` and the old chips used.
 * - **Square indicator means many, round means one.** The badge has moved to the top right to sit
 *   over the artwork — there is nowhere else for it on an edge-to-edge image — so the *shape* is
 *   now carrying that distinction on its own. Keep it square.
 *
 * The image is the point of the card, so the selected state is deliberately quiet: a green border,
 * a wash of sage behind the caption and the tick. Nothing dims or tints the photograph, because a
 * user comparing sixteen of these is reading the pictures, and a selected card that is harder to
 * look at than an unselected one punishes them for choosing.
 */
export function SpaceCard({
  option,
  checked,
  onToggle,
}: {
  option: DesiredFeatureOption;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      data-testid={`space-card-${option.id}`}
      data-checked={checked}
      className={[
        'group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border',
        'transition-[border-color,box-shadow,background-color] duration-150',
        'focus-within:ring-2 focus-within:ring-garden-green focus-within:ring-offset-1',
        checked
          ? 'border-garden-green bg-garden-sage/60 shadow-sm'
          : 'border-garden-line bg-white hover:border-garden-green/50 hover:shadow-sm',
      ].join(' ')}
    >
      <input
        type="checkbox"
        data-testid={`desired-${option.id}`}
        checked={checked}
        onChange={onToggle}
        className="sr-only"
      />

      <SpaceArt option={option} />
      <TickBadge checked={checked} />

      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-sm leading-tight font-semibold text-garden-ink">
          {option.label}
        </span>
        <span className="line-clamp-2 text-xs leading-snug text-garden-muted">
          {option.description}
        </span>
      </span>
    </label>
  );
}

/**
 * The artwork, and the fallback for when there is none.
 *
 * `next/image` with `unoptimized`, following `CatalogueThumbnail` — the files are local WebP that
 * were already sized by the generator, so there is nothing for the optimiser to do and no
 * `next.config.ts` change to make.
 *
 * A file that is missing or fails to decode falls back to a drawn panel rather than an empty box
 * or a broken-image glyph. That is the same guarantee `registry.ts` gives the plan painters, and
 * it is what lets this screen ship and be used before a single picture has been generated.
 */
function SpaceArt({ option }: { option: DesiredFeatureOption }) {
  const [failed, setFailed] = useState(false);

  if (failed || !option.image) {
    return (
      <span className="flex aspect-4/3 w-full items-center justify-center bg-garden-sage/50">
        <DesiredFeatureIcon id={option.id} className="h-7 w-7 text-garden-green/70" />
      </span>
    );
  }

  return (
    <span className="block aspect-4/3 w-full overflow-hidden bg-garden-sage/30">
      <Image
        unoptimized
        src={option.image}
        alt={option.label}
        width={640}
        height={480}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

/** Square, because this question takes many answers. See the note at the top of the file. */
function TickBadge({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={[
        'absolute top-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-md border-2',
        'transition-colors',
        checked
          ? 'border-garden-green bg-garden-green text-white'
          : 'border-white/70 bg-white/75 shadow-sm group-hover:border-garden-green/60',
      ].join(' ')}
    >
      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}
