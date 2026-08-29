import {
  DESIRED_FEATURE_LABELS,
  MAINTENANCE_LABELS,
  OTHER_LIMIT,
  PURPOSE_LIMIT,
  STYLE_LABELS,
  ZONE_ORDER,
  type BudgetBand,
  type DesiredFeature,
  type GardenBrief,
  type GardenZone,
  type MaintenanceLevel,
  type StyleDirection,
  type ZoneId,
} from '@garden-studio/schema';

/**
 * The brief form: the catalogues it renders and the rules that gate Continue.
 *
 * The brief itself — the seven answers and their wire schema — lives in
 * `@garden-studio/schema`, because the generator consumes it server-side. The labels come from
 * there too, so a concept's "Seating / dining area" cannot drift from the card the user ticked.
 * What is local is arrangement and colour: grid order, tint hexes, and which answers are
 * required.
 */

export {
  OTHER_LIMIT,
  PURPOSE_LIMIT,
  emptyBrief,
  GardenBriefSchema,
  type BudgetBand,
  type DesiredFeature,
  type GardenBrief,
  type MaintenanceLevel,
  type StyleDirection,
} from '@garden-studio/schema';

/** Past this the counter changes colour. A nudge, not a second limit. */
export const PURPOSE_WARN = 480;

/* Catalogues. Ids are the join key; the lucide icons live in `components/plan/brief/BriefIcons.tsx`
 * so this file stays pure data and can be tested without a component graph — the same split
 * `features.ts` and `FeatureIcon.tsx` already make. */

export interface DesiredFeatureOption {
  id: DesiredFeature;
  label: string;
}

/** Grid order, reading across, as laid out in the mockup. */
export const DESIRED_FEATURES: DesiredFeatureOption[] = (
  [
    'seating',
    'play',
    'vegPatch',
    'water',
    'pergola',
    'firePit',
    'storage',
    'outdoorKitchen',
  ] satisfies DesiredFeature[]
).map((id) => ({ id, label: DESIRED_FEATURE_LABELS[id] }));

/** Rendered as the trailing "+" card, so it is kept out of the grid array above. */
export const DESIRED_FEATURE_OTHER: DesiredFeatureOption = {
  id: 'other',
  label: DESIRED_FEATURE_LABELS.other,
};

export interface BudgetOption {
  id: BudgetBand;
  label: string;
  /** The money, in the mockup's own shorthand. */
  range: string;
  /**
   * Card background and selected-border colour. Literal hex in a plain map, matching how
   * `feature-colours.ts` and `zone-colours.ts` keep palette data out of components.
   */
  tint: string;
  accent: string;
}

export const BUDGET_BANDS: BudgetOption[] = [
  { id: 'low', label: 'Low', range: '€ – €€', tint: '#eef5ec', accent: '#6b8f5f' },
  { id: 'medium', label: 'Medium', range: '€€ – €€€', tint: '#e8f0e6', accent: '#2f7a3e' },
  { id: 'high', label: 'High', range: '€€€ – €€€€', tint: '#eeeaf4', accent: '#6d5aa8' },
  { id: 'premium', label: 'Premium', range: '€€€€+', tint: '#f6efdf', accent: '#a3781f' },
];

export interface MaintenanceOption {
  id: MaintenanceLevel;
  label: string;
  tint: string;
  accent: string;
}

export const MAINTENANCE_LEVELS: MaintenanceOption[] = [
  { id: 'low', label: MAINTENANCE_LABELS.low, tint: '#e8f0e6', accent: '#2f7a3e' },
  { id: 'medium', label: MAINTENANCE_LABELS.medium, tint: '#fdf0e0', accent: '#d98324' },
  { id: 'high', label: MAINTENANCE_LABELS.high, tint: '#fbeaea', accent: '#c2413a' },
];

export interface StyleOption {
  id: StyleDirection;
  label: string;
}

export const STYLE_DIRECTIONS: StyleOption[] = (
  ['modern', 'cottage', 'formal', 'lowMaintenance'] satisfies StyleDirection[]
).map((id) => ({ id, label: STYLE_LABELS[id] }));

/** The dashed fifth card. Kept out of the gallery array so it needs no artwork. */
export const STYLE_OTHER: StyleOption = { id: 'other', label: STYLE_LABELS.other };

/* Rules. Pure, so the gating can be tested without rendering anything — the trick
 * `FeatureLabels.test.ts` already uses for `layOut`. */

export type BriefSectionId = 'purpose' | 'features' | 'budget' | 'maintenance' | 'style';

export interface BriefSectionStatus {
  id: BriefSectionId;
  /** Named as the thing still missing, so it reads inside a sentence. */
  label: string;
  done: boolean;
  /** Optional sections still tick, but never hold Continue back. */
  required: boolean;
}

/**
 * Which of the five questions have been answered, and whether that is enough to continue.
 *
 * One source for the section badges, the progress panel and the bottom bar, so a tick in one
 * place cannot disagree with a tick in another.
 */
export function briefCompletion(brief: GardenBrief): {
  sections: BriefSectionStatus[];
  answered: number;
  requiredAnswered: number;
  requiredTotal: number;
  complete: boolean;
} {
  const sections: BriefSectionStatus[] = [
    {
      id: 'purpose',
      label: 'what the space is for',
      required: false,
      done: brief.purpose.trim().length > 0,
    },
    {
      id: 'features',
      label: 'what you would like in it',
      required: false,
      done: brief.desiredFeatures.length > 0,
    },
    {
      id: 'budget',
      label: 'a budget band',
      required: true,
      done: brief.budget !== null,
    },
    {
      id: 'maintenance',
      label: 'a maintenance preference',
      required: true,
      done: brief.maintenance !== null,
    },
    {
      id: 'style',
      label: 'a style direction',
      required: true,
      done: brief.style !== null,
    },
  ];

  const required = sections.filter((section) => section.required);

  return {
    sections,
    answered: sections.filter((section) => section.done).length,
    requiredAnswered: required.filter((section) => section.done).length,
    requiredTotal: required.length,
    complete: required.every((section) => section.done),
  };
}

/**
 * Why Continue is disabled, or null when it is not.
 *
 * Budget, maintenance and style are required; the purpose text, the desired features and both
 * "Other" boxes are not. Naming only what is still outstanding keeps the message useful as the
 * form fills in, rather than repeating the whole list every time.
 */
export function briefBlockedReason(brief: GardenBrief): string | null {
  const missing = briefCompletion(brief)
    .sections.filter((section) => section.required && !section.done)
    .map((section) => section.label);

  if (missing.length === 0) return null;

  return `Choose ${formatList(missing)} to continue.`;
}

/** Trims to the cap, so a paste over the limit is truncated rather than rejected. */
export function clampPurpose(text: string): string {
  return text.slice(0, PURPOSE_LIMIT);
}

export function clampOther(text: string): string {
  return text.slice(0, OTHER_LIMIT);
}

export function toggleDesiredFeature(
  chosen: DesiredFeature[],
  id: DesiredFeature,
): DesiredFeature[] {
  return chosen.includes(id) ? chosen.filter((candidate) => candidate !== id) : [...chosen, id];
}

/**
 * The design scope in words, for the read-only context card — "Front garden and back garden",
 * or "Entire outdoor space" when nothing is left out.
 *
 * Takes the zones that actually exist rather than the raw ticks: moving the house can dissolve
 * a zone while its tick stays in the draft, and this line must not claim an area the plan
 * beside it does not draw. Callers pass `effectiveZoneIds(selectedZoneIds, zones)`.
 */
export function zoneScopeLabel(zones: GardenZone[], selectedIds: ZoneId[]): string {
  const chosen = ZONE_ORDER.filter(
    (id) => selectedIds.includes(id) && zones.some((zone) => zone.id === id),
  );

  if (chosen.length === 0) return 'No areas chosen yet';
  if (zones.length > 1 && chosen.length === zones.length) return 'Entire outdoor space';

  const labels = chosen.map((id) => zones.find((zone) => zone.id === id)?.label ?? id);

  return sentenceCaseList(labels);
}

/** "a, b and c" — Intl.ListFormat, so the Oxford-comma question is not ours to answer. */
function formatList(parts: string[]): string {
  return new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(parts);
}

/** Zone labels are already capitalised; only the first survives when they are joined. */
function sentenceCaseList(labels: string[]): string {
  const [first, ...rest] = labels;
  if (first === undefined) return '';

  return formatList([
    first,
    ...rest.map((label) => label.charAt(0).toLowerCase() + label.slice(1)),
  ]);
}
