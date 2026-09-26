import { MIN_LEVEL_CHANGE } from '../levels.js';
import { defaultMaterial } from '../materials.js';
import type { BudgetBand, MaintenanceLevel, StyleDirection } from '../brief.js';
import type { DesignElement } from '../concepts.js';
import type { Neighbour } from '../boundary/graph.js';
import type { EdgeTreatment } from './treatments.js';

/**
 * What a designer would build where two particular things meet.
 *
 * **Recommendations, not a lookup.** Each rule is a sentence with a reason attached, and the reason
 * is shown to the user — which is what makes the automatic answer inspectable rather than a black
 * box the only response to is turning it off. The order is the argument: the first rule that
 * matches wins, and the ones about *where* a stretch is come before the ones about what it is made
 * of, because a course buried in a fence line is wrong whatever the two materials are.
 *
 * Pure, and shared by the renderer, the editor, the generator and the assistant's planner. Nothing
 * here writes geometry; it names a treatment and a reason, and `resolve.ts` turns that into runs.
 *
 * Two things are deliberately out of scope. A **structure** — a raised bed, a shed — never reaches
 * these rules, because the boundary graph only knows about surfaces on the ground; a raised bed's
 * sides are the thing itself rather than a join between two things. And a **raised surface** is
 * refused outright rather than given a kerb: `plan/levels.ts` already derives a retaining face from
 * its edge, and two answers to one edge is how a drawing comes to show a kerb on top of a wall.
 */

export interface EdgeRuleContext {
  style: StyleDirection | null;
  budget: BudgetBand | null;
  maintenance: MaintenanceLevel | null;
}

export interface EdgeRecommendation {
  treatment: EdgeTreatment;
  /** A `MaterialId`, or null where the treatment names no product. */
  materialId: string | null;
  /** One sentence, shown in the inspector beside the stretch it explains. */
  why: string;
}

/**
 * Which edging product a style asks for, and whether it asks for one at all.
 *
 * Moved here from the generator's `edgingFor`, unchanged, because the editor and the planner need
 * the same answer and a second copy is how the plan a user edits comes to disagree with the plan
 * the generator drew. `null` is a real answer: a naturalistic garden on a modest budget has mown
 * edges and spade-cut borders, and inventing a course for it would be inventing a cost.
 */
export function styleEdgeProduct(
  style: StyleDirection | null,
  budget: BudgetBand | null,
  maintenance: MaintenanceLevel | null,
): string | null {
  if (budget === 'low') return null;

  const dear = budget === 'high' || budget === 'premium';
  const lowUpkeep = maintenance === 'low' || style === 'lowMaintenance';

  if (style === 'formal') return dear ? 'sett-edging' : 'brick-edging';
  if (style === 'cottage') return 'brick-edging';
  if (style === 'modern' || lowUpkeep) return 'steel-edging';

  return dear ? 'steel-edging' : null;
}

/** The treatment a product id implies, so a style's answer lands in this vocabulary. */
function productTreatment(product: string | null): { treatment: EdgeTreatment; materialId: string | null } {
  switch (product) {
    case 'brick-edging':
      return { treatment: 'brick', materialId: product };
    case 'sett-edging':
      return { treatment: 'stone', materialId: product };
    case 'steel-edging':
      return { treatment: 'steel', materialId: product };
    case 'timber-sleeper':
      return { treatment: 'timber', materialId: product };
    case 'concrete-kerb':
      return { treatment: 'kerb', materialId: product };
    default:
      return { treatment: 'none', materialId: null };
  }
}

const NONE = (why: string): EdgeRecommendation => ({ treatment: 'none', materialId: null, why });
const FLUSH = (why: string): EdgeRecommendation => ({ treatment: 'flush', materialId: null, why });

export function recommendTreatment(
  host: DesignElement,
  neighbour: Neighbour,
  context: EdgeRuleContext,
): EdgeRecommendation {
  const hostMaterial = host.material ?? defaultMaterial(host.category);
  const isPath = host.shape.kind === 'polyline';
  const style = styleEdgeProduct(context.style, context.budget, context.maintenance);
  const styled = productTreatment(host.edging ?? style);

  /* ---- where it is, before what it is made of ---- */

  if (neighbour.kind === 'house') {
    return NONE('Nothing is built where a surface meets the house.');
  }

  if (neighbour.kind === 'boundary') {
    return NONE('A course along the fence line is one nobody sees and everybody pays for.');
  }

  if (Math.abs(host.elevation ?? 0) >= MIN_LEVEL_CHANGE) {
    return NONE('This surface is raised, so its edge is already a retaining face.');
  }

  if (host.category === 'water-feature') {
    return NONE("A pool's lip is drawn as part of the water.");
  }

  /* ---- what the two things are ---- */

  if (neighbour.kind === 'element' && (neighbour.material ?? defaultMaterial(neighbour.category)) === hostMaterial) {
    return NONE('Both sides are the same material, so there is no join to mark.');
  }

  if (neighbour.kind === 'element' && neighbour.category === 'paved-area') {
    if (host.category === 'paved-area') {
      return FLUSH('Two paved surfaces meet level, with no upstand between them.');
    }
    return NONE('The paving holds this in; a second edge would be a line on top of a line.');
  }

  const meetsSoft =
    neighbour.kind === 'ground' ||
    (neighbour.kind === 'element' &&
      (neighbour.category === 'lawn' ||
        neighbour.category === 'planting-bed' ||
        neighbour.category === 'gravel-mulch'));

  if (!meetsSoft) return NONE('Nothing is needed where these meet.');

  if (hostMaterial === 'stepping-stones') {
    return NONE('Stepping stones sit in the grass; there is nothing to hold in.');
  }

  if (host.category === 'paved-area' && hostMaterial === 'timber-decking') {
    return { treatment: 'timber', materialId: 'timber-sleeper', why: 'A deck is finished with its own fascia board.' };
  }

  if (host.category === 'gravel-mulch') {
    /*
     * The one place a product is invented where the style asked for none. Loose aggregate spreads
     * into whatever is beside it, so gravel with no edge is gravel in the lawn within a season —
     * which is a defect rather than a style.
     */
    const contained = styled.treatment === 'none' ? productTreatment('steel-edging') : styled;
    return { ...contained, why: 'Loose aggregate has to be held in where it meets soft ground.' };
  }

  if (host.category === 'lawn' && neighbour.kind === 'element' && neighbour.category === 'planting-bed') {
    return NONE('The bed on the other side carries this edge.');
  }

  if (host.category === 'planting-bed') {
    if (context.style === 'other' || context.style === null) {
      return styled.treatment === 'none'
        ? NONE('A spade-cut edge is enough between planting and grass.')
        : { ...styled, why: 'A course keeps the border off the grass.' };
    }
    return styled.treatment === 'none'
      ? NONE('This style keeps a spade-cut edge between planting and grass.')
      : { ...styled, why: 'A course keeps the border off the grass.' };
  }

  if (host.category === 'paved-area') {
    if (isPath) {
      /*
       * A path is already a firm edge, and a mown strip runs up to one perfectly well. Only a
       * formal garden edges its paths, where the line itself is the point.
       */
      return context.style === 'formal' && styled.treatment !== 'none'
        ? { ...styled, why: 'A formal path is set out with its own course.' }
        : NONE('A path is its own edge; grass can run up to it.');
    }
    return styled.treatment === 'none'
      ? NONE('The paving is its own edge against soft ground.')
      : { ...styled, why: 'A course between paving and soft ground keeps the line clean.' };
  }

  return NONE('Nothing is needed where these meet.');
}

/**
 * Who owns a seam two surfaces share.
 *
 * One physical join is one thing built, however many surfaces touch it — so a seam is resolved
 * once and the loser draws nothing there. Deciding by category rather than by array order is what
 * stops the answer depending on which element the generator happened to emit first, which is what
 * the old first-claim-wins rule did.
 *
 * A bed beats the grass beside it because the course is part of the border; a hard surface beats a
 * soft one because the edge belongs to the thing that needs containing.
 */
const OWNERSHIP: Record<string, number> = {
  'planting-bed': 4,
  'gravel-mulch': 3,
  'paved-area': 2,
  'water-feature': 1,
  lawn: 0,
};

export function seamOwner(
  a: { id: string; category: string },
  b: { id: string; category: string },
): string {
  const rankA = OWNERSHIP[a.category] ?? 0;
  const rankB = OWNERSHIP[b.category] ?? 0;
  if (rankA !== rankB) return rankA > rankB ? a.id : b.id;
  // Same category on both sides: the ids settle it, so two builds agree.
  return a.id < b.id ? a.id : b.id;
}
