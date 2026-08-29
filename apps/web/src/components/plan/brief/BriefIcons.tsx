'use client';

import {
  Armchair,
  Banknote,
  CirclePlus,
  Coins,
  CookingPot,
  Columns3,
  Droplets,
  Flame,
  Gem,
  Leaf,
  Paintbrush,
  Scissors,
  Sprout,
  ToyBrick,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { BudgetBand, DesiredFeature, MaintenanceLevel } from '@/lib/brief';

/**
 * One icon per brief option, in one place — the split `features.ts` and `FeatureIcon.tsx`
 * already make. `brief.ts` stays pure data so it can be unit-tested without pulling in a
 * component library, and these `Record`s make TypeScript insist on an icon for every option
 * the moment one is added there.
 *
 * A shed is `Warehouse` and "other" is `CirclePlus` here as well as on step 2, so the same
 * thing looks the same wherever the user meets it.
 */

const DESIRED_FEATURE_ICONS: Record<DesiredFeature, LucideIcon> = {
  seating: Armchair,
  play: ToyBrick,
  vegPatch: Sprout,
  water: Droplets,
  // No pergola in lucide; three uprights read as a frame overhead.
  pergola: Columns3,
  firePit: Flame,
  storage: Warehouse,
  outdoorKitchen: CookingPot,
  other: CirclePlus,
};

const BUDGET_ICONS: Record<BudgetBand, LucideIcon> = {
  low: Coins,
  medium: Wallet,
  high: Banknote,
  premium: Gem,
};

const MAINTENANCE_ICONS: Record<MaintenanceLevel, LucideIcon> = {
  low: Leaf,
  medium: Paintbrush,
  high: Scissors,
};

export function DesiredFeatureIcon({ id, className }: { id: DesiredFeature; className?: string }) {
  const Icon = DESIRED_FEATURE_ICONS[id];
  return <Icon aria-hidden className={className ?? 'h-4 w-4'} />;
}

export function BudgetIcon({ id, className }: { id: BudgetBand; className?: string }) {
  const Icon = BUDGET_ICONS[id];
  return <Icon aria-hidden className={className ?? 'h-4 w-4'} />;
}

export function MaintenanceIcon({ id, className }: { id: MaintenanceLevel; className?: string }) {
  const Icon = MAINTENANCE_ICONS[id];
  return <Icon aria-hidden className={className ?? 'h-4 w-4'} />;
}
