'use client';

import { defaultMaterial } from '@/lib/materials';
import type { CatalogueEntry } from '@/lib/catalogue';
import { CatalogueThumbnail } from '../CatalogueThumbnail';
import { EnclosureThumbnail } from './EnclosureThumbnail';

/**
 * One thing that can be put on the plan: its picture, its name, and the one fact that tells it from
 * the tile beside it. Pressing it arms the placement; pressing it again, or another, disarms it.
 */
export function CatalogueTile({
  entry,
  detail,
  active,
  onChoose,
}: {
  entry: CatalogueEntry;
  detail: string;
  active: boolean;
  onChoose: (entry: CatalogueEntry) => void;
}) {
  const arm = entry.arm;
  return (
    <button
      type="button"
      data-testid={`palette-${entry.id}`}
      aria-pressed={active}
      title={
        arm.kind === 'enclosure'
          ? 'Choose, then click along the plan; double-click to finish'
          : 'Choose, then click the plan to place'
      }
      onClick={() => onChoose(entry)}
      className={`flex h-full w-full flex-col rounded-lg border p-1.5 text-left transition hover:border-garden-green focus-visible:outline-2 focus-visible:outline-garden-green ${
        active ? 'border-garden-green bg-garden-sage' : 'border-garden-line bg-white'
      }`}
    >
      <span className="block h-14 w-full overflow-hidden rounded bg-[#fafbf9] p-1">
        {arm.kind === 'enclosure' ? (
          <EnclosureThumbnail kind={arm.enclosure} />
        ) : (
          <CatalogueThumbnail
            element={{
              category: arm.category,
              material: defaultMaterial(arm.category),
              ...(arm.symbol ? { symbol: arm.symbol } : {}),
              ...(arm.plantId ? { plantId: arm.plantId } : {}),
            }}
          />
        )}
      </span>
      <span className="mt-1 line-clamp-2 text-[11px] leading-4 font-medium text-garden-ink">{entry.label}</span>
      <span className="truncate text-[10px] leading-4 text-garden-muted">{detail}</span>
    </button>
  );
}
