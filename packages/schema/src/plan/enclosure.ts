import { z } from 'zod';

/**
 * What encloses a garden, as part of the design rather than of the survey.
 *
 * Step 1 records what each side of the property *is* — `boundaryStyles`, one kind per side — and
 * that stays the survey. A fence, a screen, a wall, a hedge or a kerb the design *proposes* is an
 * element of the `enclosure` category with a polyline for its line: drawn with the same tools as a
 * path, snapped to the fence line, selected, locked, undone and persisted like everything else on
 * the plan, and added or removed by the designer with verbs it already has.
 *
 * **One laid along the property's edge replaces the survey there, and which stretch it replaces is
 * derived, never stored.** `effectiveBoundaryRuns` finds the part of each side an enclosure lies
 * along and cuts it out, so the survey is untouched and dragging the new fence off the line gives
 * the old one back. The same element away from the edge is a freestanding garden wall or a screen
 * round the bins, and needs no second model.
 *
 * The schema half only, for the reason `boundary-style.ts` gives: `concepts.ts` needs it to put
 * `enclosure` on an element, and the resolvers need geometry from modules that import `concepts.ts`.
 */

export const EnclosureKindSchema = z.enum([
  'fence',
  /** Horizontal slats with gaps: a screen you half see through, the modern garden's fence. */
  'screen',
  'wall',
  'hedge',
  'railing',
  /** A kerb or a low retaining edge: a line on the ground rather than a thing that encloses. */
  'kerb',
  /**
   * Nothing: laid along the property's edge, it takes away what the survey has there — "open the
   * front garden to the street". Away from the edge it is a line that means nothing, and is drawn as
   * the dashed line the survey's own open side is.
   */
  'open',
]);
export type EnclosureKind = z.infer<typeof EnclosureKindSchema>;

export const EnclosureSchema = z.object({
  kind: EnclosureKindSchema,
  /** A fence's panel or a screen's slat, by name — "hit-and-miss", "horizontal slats". Free text. */
  panel: z.string().max(48).optional(),
  /** A wall's coping — "brick on edge", "stone". Free text, and nothing measures it. */
  coping: z.string().max(48).optional(),
});
export type Enclosure = z.infer<typeof EnclosureSchema>;

export interface EnclosureKindSpec {
  label: string;
  /** Metres. The ordinary British value, used where the element has no height of its own. */
  height: number;
  /** Metres on the ground: the polyline's width when one is drawn. */
  thickness: number;
  /** The material a new one is made of. */
  material: string;
  /** The materials it may be made of — what the inspector offers, first the default. */
  materials: string[];
  /** Words a sentence might use for it, for `enclosureKindNamed`. */
  words: string[];
}

export const ENCLOSURE_KINDS: Record<EnclosureKind, EnclosureKindSpec> = {
  fence: {
    label: 'Fence',
    height: 1.8,
    thickness: 0.1,
    material: 'closeboard-fence',
    materials: ['closeboard-fence', 'hit-and-miss-fence'],
    words: ['fence', 'fencing', 'panel', 'close board', 'closeboard', 'hit and miss'],
  },
  screen: {
    label: 'Screen',
    height: 1.8,
    thickness: 0.08,
    material: 'slatted-screen',
    materials: ['slatted-screen', 'hit-and-miss-fence'],
    words: ['screen', 'screening', 'slatted', 'slats', 'trellis'],
  },
  wall: {
    label: 'Wall',
    height: 1.2,
    thickness: 0.22,
    material: 'brick-garden-wall',
    materials: ['brick-garden-wall', 'rendered-garden-wall', 'stone-garden-wall'],
    words: ['wall', 'walling', 'brick', 'masonry', 'blockwork', 'rendered'],
  },
  hedge: {
    label: 'Hedge',
    height: 1.5,
    thickness: 0.6,
    material: 'hedge-planting',
    materials: ['hedge-planting'],
    words: ['hedge', 'hedging', 'hedgerow'],
  },
  railing: {
    label: 'Railing',
    height: 1.1,
    thickness: 0.05,
    material: 'metal-railing',
    materials: ['metal-railing'],
    words: ['railing', 'railings', 'balustrade', 'estate fence'],
  },
  kerb: {
    label: 'Kerb',
    height: 0.1,
    thickness: 0.15,
    material: 'kerb-line',
    materials: ['kerb-line'],
    words: ['kerb', 'curb', 'upstand'],
  },
  open: {
    label: 'Opening',
    height: 0,
    thickness: 0.1,
    material: 'open-boundary',
    materials: ['open-boundary'],
    words: ['open', 'opening', 'no fence', 'remove the fence', 'take down'],
  },
};

export const ENCLOSURE_KIND_IDS = Object.keys(ENCLOSURE_KINDS) as EnclosureKind[];

/**
 * The kind a sentence or a name means: "a slatted screen", "a 1.2 m brick wall", "beech hedging".
 * The first kind any of whose words appears, in the order below — the more particular words first,
 * so a "slatted screen fence" is a screen and "beech hedging" is not a fence. `null` when nothing matches,
 * never a default: a planner that guessed "fence" would build one nobody asked for.
 */
export function enclosureKindNamed(name: string | undefined): EnclosureKind | null {
  if (!name) return null;
  const text = ` ${name.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `;
  const order: EnclosureKind[] = ['screen', 'hedge', 'railing', 'kerb', 'open', 'wall', 'fence'];
  for (const kind of order) {
    if (ENCLOSURE_KINDS[kind].words.some((word) => text.includes(` ${word} `) || text.includes(` ${word}s `))) {
      return kind;
    }
  }
  return null;
}
