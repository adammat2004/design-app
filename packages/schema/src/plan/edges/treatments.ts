import { z } from 'zod';

/**
 * What can be built where one surface meets another.
 *
 * **A treatment is not a material.** "Brick" is a decision a designer makes about a join; which
 * brick is a product question the run may answer separately and usually does not. Keeping the two
 * apart is what lets the palette grow — a second sett, a different kerb profile — without touching
 * the vocabulary the editor, the planner and the model all share.
 *
 * Two of the seven name no product at all, and both are real answers rather than gaps:
 *
 * - **`none`** — nothing is built here. A bed against a fence, two patios of the same stone, a
 *   surface against the house. This is the commonest answer in a real garden and it is the default,
 *   which is why a plan with nothing said about it draws no outline.
 * - **`flush`** — the two surfaces meet level, with no upstand. A path joining a patio is the case
 *   it exists for: something is built there, it is drawn, and it has no height. Drawn as a fine
 *   joint rather than as a course, and `raised: false` is what keeps it out of the elevated stack.
 *
 * This module is a **leaf**: it imports nothing but Zod and types, so `concepts.ts` can take the
 * enum without dragging the material catalogue behind it. Same rule, same reason, as `zone-id.ts`.
 */

export const EDGE_TREATMENT_IDS = [
  'none',
  'flush',
  'brick',
  'stone',
  'steel',
  'timber',
  'kerb',
] as const;

export const EdgeTreatmentSchema = z.enum(EDGE_TREATMENT_IDS);
export type EdgeTreatment = z.infer<typeof EdgeTreatmentSchema>;

/** Which dimensions a treatment has. Anything absent here is not asked for and not drawn. */
export type EdgeDimension = 'width' | 'height';

export interface EdgeTreatmentSpec {
  id: EdgeTreatment;
  label: string;
  /** A `MaterialId` from `EDGING_MATERIALS`, or null where nothing is bought by the metre. */
  defaultMaterial: string | null;
  /**
   * The dimensions worth offering, in the order a panel should show them.
   *
   * This is what makes "do not ask for a height on something that has none" a property of the
   * table rather than a condition written again in every form. A flush transition has neither; a
   * steel blade has only a height, because its 3 mm thickness is drawn at the width it *reads* at
   * and typing a number for it would be editing a drawing convention.
   */
  dims: EdgeDimension[];
  /** Whether it stands proud of the ground, and therefore whether Visualise extrudes it. */
  raised: boolean;
  /** One line, shown under the swatch grid. */
  hint: string;
}

export const EDGE_TREATMENTS: EdgeTreatmentSpec[] = [
  {
    id: 'none',
    label: 'None',
    defaultMaterial: null,
    dims: [],
    raised: false,
    hint: 'Nothing built where these meet.',
  },
  {
    id: 'flush',
    label: 'Flush',
    defaultMaterial: null,
    dims: [],
    raised: false,
    hint: 'The two surfaces meet level, with no upstand.',
  },
  {
    id: 'brick',
    label: 'Brick',
    defaultMaterial: 'brick-edging',
    dims: ['width', 'height'],
    raised: true,
    hint: 'A soldier course laid on edge.',
  },
  {
    id: 'stone',
    label: 'Stone',
    defaultMaterial: 'sett-edging',
    dims: ['width', 'height'],
    raised: true,
    hint: 'A granite sett course.',
  },
  {
    id: 'steel',
    label: 'Steel',
    defaultMaterial: 'steel-edging',
    dims: ['height'],
    raised: true,
    hint: 'A thin blade, almost invisible in plan.',
  },
  {
    id: 'timber',
    label: 'Timber',
    defaultMaterial: 'timber-sleeper',
    dims: ['width', 'height'],
    raised: true,
    hint: 'A sleeper or board on edge.',
  },
  {
    id: 'kerb',
    label: 'Kerb',
    defaultMaterial: 'concrete-kerb',
    dims: ['width', 'height'],
    raised: true,
    hint: 'A cast kerb, set proud to hold a level.',
  },
];

const BY_ID = new Map(EDGE_TREATMENTS.map((spec) => [spec.id, spec]));

export function treatmentSpec(id: EdgeTreatment): EdgeTreatmentSpec {
  return BY_ID.get(id) ?? BY_ID.get('none')!;
}

/** Whether a treatment puts anything on the ground at all. */
export function treatmentIsDrawn(id: EdgeTreatment): boolean {
  return id !== 'none';
}

/**
 * The treatment a stored product id stands for.
 *
 * `DesignElement.edging` names a product, not a treatment, and it predates this vocabulary — so a
 * plan written before any of this reads back as the treatment its product implies rather than as
 * nothing. Unknown ids answer `brick`, which is the commonest course and the one `edgingWidth`
 * already falls back to.
 */
export function treatmentForMaterial(materialId: string | undefined): EdgeTreatment {
  if (!materialId) return 'none';
  const match = EDGE_TREATMENTS.find((spec) => spec.defaultMaterial === materialId);
  return match?.id ?? 'brick';
}

/**
 * How wide an edging product is drawn, in millimetres.
 *
 * **Presentation, and nothing measures it** — the schedule counts a run by its length, because that
 * is how edging is bought. That licence matters for exactly one entry: a steel edging is a 3 mm
 * blade, a fifth of a pixel at any zoom the plan supports, so it is drawn at the width it reads at.
 * The other four are real product widths.
 *
 * Here rather than in the web palette because the API quotes runs too, and a second copy is how the
 * two would come to disagree about what a kerb is. `apps/web/src/lib/materials/palette/edges.ts`
 * re-exports it.
 */
export const EDGING_WIDTHS_MM: Record<string, number> = {
  /** A brick on end: the course is one brick width across. */
  'brick-edging': 102,
  /** A garden kerb, the small one — a road kerb is 250 and would eat the border. */
  'concrete-kerb': 150,
  'sett-edging': 100,
  'timber-sleeper': 200,
  /** A drawing width, not a product one. The blade is 3 mm. */
  'steel-edging': 45,
};

/** Metres, resolved for a drawing. Falls back to a brick course for an unknown product. */
export function edgingWidthMetres(material: string | undefined): number {
  return (
    (material === undefined ? undefined : EDGING_WIDTHS_MM[material]) ??
    EDGING_WIDTHS_MM['brick-edging']!
  ) / 1000;
}

/**
 * How wide a flush transition is drawn.
 *
 * Nothing is built there, so there is no product to quote — this is the width of the *joint* the
 * drawing shows, on the order of a paving joint, which is what says "these meet" without claiming
 * a course nobody laid.
 */
export const FLUSH_WIDTH_MM = 18;

/**
 * The shortest run worth drawing or ordering, in metres.
 *
 * Below this a run is a rounding artefact of tessellation rather than a length of product. It is
 * also the floor a drag refuses at, so an end handle stops dead rather than silently pinning — a
 * limit the user can see beats one that looks like the drag stopped tracking.
 */
export const MIN_EDGE_RUN_LENGTH = 0.15;
