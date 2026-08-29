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

export const DesiredFeatureSchema = z.enum([
  'seating',
  'play',
  'vegPatch',
  'water',
  'pergola',
  'firePit',
  'storage',
  'outdoorKitchen',
  'other',
]);
export type DesiredFeature = z.infer<typeof DesiredFeatureSchema>;

export const BudgetBandSchema = z.enum(['low', 'medium', 'high', 'premium']);
export type BudgetBand = z.infer<typeof BudgetBandSchema>;

export const MaintenanceLevelSchema = z.enum(['low', 'medium', 'high']);
export type MaintenanceLevel = z.infer<typeof MaintenanceLevelSchema>;

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
  seating: 'Seating / dining area',
  play: 'Play area',
  vegPatch: 'Veg patch / kitchen garden',
  water: 'Water feature',
  pergola: 'Pergola / shade structure',
  firePit: 'Fire pit',
  storage: 'Storage / shed',
  outdoorKitchen: 'Outdoor kitchen / BBQ area',
  other: 'Other',
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

export const STYLE_LABELS: Record<StyleDirection, string> = {
  modern: 'Modern / minimal',
  cottage: 'Cottage / naturalistic',
  formal: 'Formal / structured',
  lowMaintenance: 'Low-maintenance / contemporary',
  other: 'Other',
};
