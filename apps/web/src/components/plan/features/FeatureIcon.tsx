'use client';

import {
  CirclePlus,
  DoorOpen,
  Droplets,
  Fence,
  Grid2x2,
  Route,
  Rows3,
  Sprout,
  TreeDeciduous,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureKind } from '@/lib/features';

/**
 * One icon per feature type, in one place. The palette, the placed list, the legend, the canvas
 * labels and the Selected object panel all draw from here, so a tree is the same tree wherever
 * the user meets it.
 */
const ICONS: Record<FeatureKind, LucideIcon> = {
  tree: TreeDeciduous,
  shed: Warehouse,
  patio: Grid2x2,
  path: Route,
  fence: Fence,
  gate: DoorOpen,
  water: Droplets,
  // lucide has no staircase; stacked rules read as steps in profile.
  steps: Rows3,
  planting: Sprout,
  other: CirclePlus,
};

export function FeatureIcon({ kind, className }: { kind: FeatureKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon aria-hidden className={className ?? 'h-4 w-4'} />;
}
