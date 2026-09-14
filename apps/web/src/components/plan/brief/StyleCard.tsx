'use client';

import { useState } from 'react';
import Image from 'next/image';
import type { StyleOption } from '@/lib/brief';
import { ChoiceCard } from './ChoiceCard';
import { StyleThumbnail } from './StyleThumbnail';

/**
 * One style direction, as a photograph.
 *
 * A thin wrapper on `ChoiceCard` rather than a second implementation of it: the radio grouping,
 * the round `SelectionBadge` and the "there is no way to unselect" rule all come along unchanged,
 * and this file only supplies the picture and the caption. `padded={false}` is the escape hatch
 * that file already documents for edge-to-edge artwork.
 *
 * Photographs rather than the miniatures the spaces use, and the difference is the question being
 * asked. A space is a component — here is a pergola, it comes with paving and seating — and a
 * model on a plain ground says that best. A *style* is planting density, edge treatment and colour
 * temperature, which a simplified render is exactly what flattens. You cannot tell somebody what
 * "naturalistic" means; you show them one.
 */
export function StyleCard({
  option,
  checked,
  onSelect,
}: {
  option: StyleOption;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <ChoiceCard
      testId={`style-${option.id}`}
      name="style"
      label={option.label}
      checked={checked}
      onSelect={onSelect}
      padded={false}
    >
      <StyleArt option={option} />
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-sm leading-tight font-semibold text-garden-ink">
          {option.label}
        </span>
        <span className="line-clamp-2 text-xs leading-snug text-garden-muted">
          {option.description}
        </span>
      </span>
    </ChoiceCard>
  );
}

/**
 * The photograph, falling back to the drawn motif it replaces.
 *
 * `StyleThumbnail`'s own header has said since it was written that it is a stand-in for real
 * photography and that swapping this one element is all that should be needed. It is — and it
 * survives as the fallback rather than being deleted, so a style card with no file on disk still
 * shows something that distinguishes the four rather than an empty grey box.
 */
function StyleArt({ option }: { option: StyleOption }) {
  const [failed, setFailed] = useState(false);

  if (failed || !option.image) {
    return (
      <span className="block aspect-3/2 w-full overflow-hidden bg-garden-sage/40">
        <StyleThumbnail style={option.id} />
      </span>
    );
  }

  return (
    <span className="block aspect-3/2 w-full overflow-hidden bg-garden-sage/30">
      <Image
        unoptimized
        src={option.image}
        alt={option.label}
        width={768}
        height={512}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
