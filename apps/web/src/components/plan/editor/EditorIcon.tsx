'use client';

import { Columns3, Droplets, Grid2x2, Sprout, Square, Trees, type LucideIcon } from 'lucide-react';
import type { ElementCategory } from '@/lib/concepts';

/**
 * One icon per surface category.
 *
 * A `Record` keyed by the union rather than a lookup with a fallback, so adding a category is a
 * compile error until an icon is chosen for it — the same guard `FeatureIcon.tsx` uses. Where a
 * category means the same thing as one of step 2's feature kinds it borrows that icon, so a patio
 * is the same glyph on step 2 and step 5.
 */
const ICONS: Record<ElementCategory, LucideIcon> = {
  'paved-area': Grid2x2,
  lawn: Square,
  'planting-bed': Sprout,
  'gravel-mulch': Columns3,
  structure: Trees,
  'water-feature': Droplets,
  'existing-feature': Trees,
};

export function EditorIcon({
  category,
  className,
}: {
  category: ElementCategory;
  className?: string;
}) {
  const Icon = ICONS[category];
  return <Icon aria-hidden className={className ?? 'h-4 w-4'} />;
}
