import { z } from 'zod';

/**
 * What the user wants, as opposed to what is already there.
 *
 * Steps 1 and 2 are geometry; this is the only step whose answer is prose and preference.
 *
 * The three single-select answers are `null` rather than defaulted. A pre-picked budget or
 * style would quietly bias every generated concept without the user ever choosing it, so
 * "not answered" has to be representable — nullable rather than optional, so it survives the
 * round trip.
 */

/**
 * The garden *spaces* a user can ask for — not a catalogue of objects.
 *
 * The distinction is the point: the brief asks how the garden will be used, and the generator
 * turns each answer into a room with a footprint, a place to sit and a way to reach it. "Outdoor
 * dining area" is a thing `FEATURE_SPECS` can compose; "table" is not.
 *
 * **Every id here is honoured somewhere in generation**, and adding one is deliberately a compile
 * error in four total `Record`s — the labels below, `FEATURE_SPECS`, the slot-preference table and
 * the web app's icon map — so a card on screen cannot be a tick the design ignores.
 *
 * Three of them (`lawn`, `plantingBeds`, `lighting`) are **composed rather than placed**: the
 * templates already draw a lawn panel and borders, and `lightingScheme` already composes a scheme
 * from what was placed. Asking for one of those steers what is already happening instead of
 * dropping a second copy on top of it — see `concepts.service.ts`.
 *
 * Growing this enum needs no migration and no `PLAN_DOCUMENT_VERSION` bump: a union that only
 * *gains* permitted values still parses every stored document.
 */
export const DesiredFeatureSchema = z.enum([
  'seating',
  'dining',
  'pergola',
  'firePit',
  'hotTub',
  'outdoorKitchen',
  'gardenRoom',
  'greenhouse',
  'vegPatch',
  'plantingBeds',
  'lawn',
  'water',
  'play',
  'storage',
  'lighting',
  'other',
]);
export type DesiredFeature = z.infer<typeof DesiredFeatureSchema>;

export const BudgetBandSchema = z.enum(['low', 'medium', 'high', 'premium']);
export type BudgetBand = z.infer<typeof BudgetBandSchema>;

export const MaintenanceLevelSchema = z.enum(['low', 'medium', 'high']);
export type MaintenanceLevel = z.infer<typeof MaintenanceLevelSchema>;

/**
 * The overall look, and **the ids are the contract** — generation branches on these exact strings
 * in a dozen places (the planting style, the tree palette, corner radius, edging, paving, the
 * retaining material, which template is recommended). The *words* below are free to change; these
 * are not, and a new direction is only worth adding when it earns its own branches. A style card
 * that generates the same garden as the one beside it is worse than no card.
 */
export const StyleDirectionSchema = z.enum([
  'modern',
  'cottage',
  'formal',
  'lowMaintenance',
  'other',
]);
export type StyleDirection = z.infer<typeof StyleDirectionSchema>;

export const PURPOSE_LIMIT = 500;

/** Free-text "Other" answers are a label, not a paragraph. */
export const OTHER_LIMIT = 120;

export const GardenBriefSchema = z.object({
  /** Free text, capped at `PURPOSE_LIMIT`. Optional but encouraged. */
  purpose: z.string().max(PURPOSE_LIMIT).default(''),
  desiredFeatures: z.array(DesiredFeatureSchema).default([]),
  /** Only meaningful while `desiredFeatures` includes 'other', the way `replaceWith` follows status. */
  featuresOther: z.string().max(OTHER_LIMIT).default(''),
  budget: BudgetBandSchema.nullable().default(null),
  maintenance: MaintenanceLevelSchema.nullable().default(null),
  style: StyleDirectionSchema.nullable().default(null),
  /** Only meaningful while `style` is 'other'. */
  styleOther: z.string().max(OTHER_LIMIT).default(''),
});
export type GardenBrief = z.infer<typeof GardenBriefSchema>;

export function emptyBrief(): GardenBrief {
  return {
    purpose: '',
    desiredFeatures: [],
    featuresOther: '',
    budget: null,
    maintenance: null,
    style: null,
    styleOther: '',
  };
}

/**
 * One label per answer, read by the brief form, the concepts panel and the server's concept
 * summaries alike. Presentation *arrangement* stays in the web app — the grid order, the icons,
 * the tint hexes — but the words themselves live here so a generated concept and the form that
 * produced it cannot call the same thing by two names.
 */
export const DESIRED_FEATURE_LABELS: Record<DesiredFeature, string> = {
  seating: 'Seating area',
  dining: 'Dining area',
  pergola: 'Pergola',
  firePit: 'Fire pit',
  hotTub: 'Hot tub',
  outdoorKitchen: 'Outdoor kitchen',
  gardenRoom: 'Garden room',
  greenhouse: 'Greenhouse',
  vegPatch: 'Kitchen garden',
  plantingBeds: 'Planting beds',
  lawn: 'Lawn',
  water: 'Water feature',
  play: 'Play area',
  storage: 'Storage / shed',
  lighting: 'Garden lighting',
  other: 'Something else',
};

export const BUDGET_LABELS: Record<BudgetBand, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  premium: 'Premium',
};

export const MAINTENANCE_LABELS: Record<MaintenanceLevel, string> = {
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
};

/**
 * One word each, because the style is chosen from a picture rather than read from a list — and a
 * concept card has room for a name, not for a name and its gloss. The ids they are keyed by have
 * not moved; only the wording has.
 */
export const STYLE_LABELS: Record<StyleDirection, string> = {
  modern: 'Modern',
  cottage: 'Natural',
  formal: 'Traditional',
  lowMaintenance: 'Minimalist',
  other: 'Something else',
};
