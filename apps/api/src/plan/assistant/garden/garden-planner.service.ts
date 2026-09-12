import { Inject, Injectable } from '@nestjs/common';
import {
  boundaryPolygon,
  computeZones,
  defaultFeatureName,
  featureIsLegal,
  featureOutline,
  FEATURE_DEFINITIONS,
  geometryAnchor,
  housePolygon,
  moveGeometry,
  polygonCentroid,
  polygonsIntersect,
  type FeatureKind,
  type GardenAction,
  type GardenChange,
  type GardenProposal,
  type PlacedFeature,
  type PlanDocument,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';
import { PlacementService } from '../../generation/placement.service.js';
import { anchorPoint, buildAnchorContext, type AnchorContext } from './anchors.js';

/**
 * Actions in, geometry out.
 *
 * The interesting half of the garden assistant, and the half with no model in it. `GardenAction`
 * objects go straight in, so the whole of this is testable against real PostGIS with nothing
 * faked — exactly what `planner.service.test.ts` already does for step 5.
 *
 * Two rules it never breaks:
 *
 * - **Every feature it produces passes `featureIsLegal`**, the same predicate the canvas, the
 *   store and the validator use. A change that cannot be placed is omitted and reported, never
 *   fudged into somewhere approximate-but-illegal.
 * - **It measures its own reasons.** "There is no clear 3 × 2 m space in the back garden" is a
 *   fact this file established, not a sentence the model wrote. The model gets to say what it
 *   understood; it does not get to say what happened.
 */

/** How many candidate centres to sample. More variety per query, one query either way. */
const SAMPLES = 64;

/** Fixed, so the same sentence twice proposes the same spot rather than wandering. */
const SEED = 7;

/**
 * How big the assistant makes a thing it was not given a size for.
 *
 * `FEATURE_DEFINITIONS` covers the kinds the palette places with one tap, but a patio and a
 * planting bed are drawn corner by corner there, so the manifest has no size for them — a user
 * drawing one states it. The assistant has to choose, so it chooses here, visibly, rather than
 * inside a prompt where nothing could check it. Modest on purpose: an approximate patio the user
 * drags bigger is a better wrong answer than one that swallows the lawn.
 */
const ASSISTANT_SIZE: Record<FeatureKind, { width: number; depth: number }> = {
  tree: { width: 3, depth: 3 },
  shed: { width: 2.5, depth: 2 },
  patio: { width: 4, depth: 3 },
  path: { width: 4, depth: 1 },
  fence: { width: 5, depth: 0.2 },
  gate: { width: 0.9, depth: 0.9 },
  water: { width: 1.2, depth: 1.2 },
  steps: { width: 1.5, depth: 0.8 },
  planting: { width: 3, depth: 1.5 },
  other: { width: 1, depth: 1 },
};

/** Shrink steps tried before giving up on a spot, as a fraction of the asked-for size. */
const SHRINK_LADDER = [1, 0.8, 0.6];

@Injectable()
export class GardenPlannerService {
  constructor(@Inject(PlacementService) private readonly placement: PlacementService) {}

  async plan(
    document: PlanDocument,
    actions: GardenAction[],
  ): Promise<Pick<GardenProposal, 'changes' | 'scope' | 'unplaceable'>> {
    const changes: GardenChange[] = [];
    const unplaceable: { description: string; reason: string }[] = [];
    let scope: GardenProposal['scope'] = null;

    const site = document.site;
    const boundary = boundaryPolygon(site);
    const houseRing = site.house ? housePolygon(site.house) : null;
    const zones = computeZones(boundary, site.house);
    const context = buildAnchorContext(site, zones);

    if (boundary.length < 3) {
      return { changes, scope, unplaceable };
    }

    /*
     * A working copy, advanced as each action lands. Two trees in one sentence must not be
     * proposed on top of each other, which they would be if every action were planned against the
     * document as it arrived.
     */
    let features = [...document.features.features];
    let counter = 0;
    const nextId = () => `ai-${(counter += 1)}`;

    for (const action of actions) {
      if (action.kind === 'scope') {
        scope = { zones: action.zones };
        continue;
      }

      if (action.kind === 'add') {
        for (let n = 0; n < action.count; n += 1) {
          const placed = await this.place(action, features, {
            boundary,
            houseRing,
            context,
          });

          if (!placed) {
            unplaceable.push({
              description: describe(action.feature),
              reason: `There is no clear space left for ${article(describe(action.feature))} in that part of the garden.`,
            });
            continue;
          }

          const feature: PlacedFeature = {
            id: nextId(),
            kind: action.feature,
            name: action.name ?? defaultFeatureName(action.feature, features),
            geometry: placed,
            // Almost everything already in a garden is staying; Remove is said on purpose.
            status: 'keep',
            replaceWith: null,
          };

          features = [...features, feature];
          changes.push({
            id: nextId(),
            kind: 'add',
            featureId: null,
            label: feature.name,
            next: feature,
            previous: null,
          });
        }
        continue;
      }

      const existing = features.find((feature) => feature.id === action.featureId);
      if (!existing) {
        unplaceable.push({
          description: action.featureId,
          reason: 'One of the features mentioned is no longer on the plan.',
        });
        continue;
      }

      if (action.kind === 'delete') {
        features = features.filter((feature) => feature.id !== existing.id);
        changes.push({
          id: nextId(),
          kind: 'delete',
          featureId: existing.id,
          label: existing.name,
          next: existing,
          previous: existing,
        });
        continue;
      }

      if (action.kind === 'status') {
        const next: PlacedFeature = {
          ...existing,
          status: action.status,
          // A replacement note only means anything while the answer is "replace".
          replaceWith: action.status === 'replace' ? action.replaceWith : null,
        };

        features = features.map((feature) => (feature.id === existing.id ? next : feature));
        changes.push({
          id: nextId(),
          kind: 'status',
          featureId: existing.id,
          label: existing.name,
          next,
          previous: existing,
        });
        continue;
      }

      const moved =
        action.kind === 'move'
          ? this.relocate(existing, action.to, context, boundary, features)
          : this.rescale(existing, action.factor, boundary, features);

      if (!moved) {
        unplaceable.push({
          description: existing.name,
          reason:
            action.kind === 'move'
              ? `There is no clear space to move the ${existing.name.toLowerCase()} to.`
              : `The ${existing.name.toLowerCase()} cannot be resized that far without leaving the property.`,
        });
        continue;
      }

      features = features.map((feature) => (feature.id === existing.id ? moved : feature));
      changes.push({
        id: nextId(),
        kind: action.kind,
        featureId: existing.id,
        label: existing.name,
        next: moved,
        previous: existing,
      });
    }

    return { changes, scope, unplaceable };
  }

  /**
   * Somewhere legal to put a new thing, as near the named place as the garden allows.
   *
   * The anchor is a *preference*, never an answer: PostGIS computes what is genuinely free, the
   * sampler picks inside it, and `featureIsLegal` has the last word. So a vague phrase lands
   * somewhere sensible and a wrong one lands somewhere legal — never over the fence.
   */
  private async place(
    action: Extract<GardenAction, { kind: 'add' }>,
    features: PlacedFeature[],
    world: { boundary: Point[]; houseRing: Point[] | null; context: AnchorContext },
  ): Promise<PlanGeometry | null> {
    const { boundary, houseRing, context } = world;

    const aim = anchorPoint(action.at, context) ?? polygonCentroid(boundary);

    /*
     * Narrowed to one garden when the model named one. `zoneAt` is not consulted the other way
     * round: an anchor that lands just over a zone seam is still the place the user meant.
     */
    const zone = action.zone
      ? (context.zones.find((candidate) => candidate.id === action.zone)?.polygon ?? boundary)
      : boundary;

    const obstacles = [
      ...(houseRing ? [houseRing] : []),
      ...features.map((feature) => featureOutline(feature)),
    ];

    for (const shrink of SHRINK_LADDER) {
      const size = sizeFor(action, shrink);
      const candidates = await this.placement.candidates({
        zone,
        obstacles,
        inradius: inradiusOf(size),
        houseCentre: aim,
        affinity: 'near-point',
        reference: aim,
        seed: SEED,
        sampleCount: SAMPLES,
      });

      for (const at of candidates) {
        const geometry = geometryFor(action.feature, at, size);
        const candidate = { id: '', kind: action.feature, geometry } as PlacedFeature;

        /*
         * Both checks, and the second is not redundant. The erosion guarantees a *disc* of
         * `inradius` fits, which under-estimates a rectangle — a 2.5 × 2 shed eroded by 1 m can
         * still have its 1.25 m half-width lapping the obstacle it was meant to clear. So the
         * erosion only makes the sampling efficient; these two make it correct.
         */
        if (featureIsLegal(candidate, boundary) && clearOfOthers(candidate, features)) {
          return geometry;
        }
      }
    }

    return null;
  }

  /** Moves a feature towards a named place, taking the nearest legal spot on the way. */
  private relocate(
    feature: PlacedFeature,
    to: Parameters<typeof anchorPoint>[0],
    context: AnchorContext,
    boundary: Point[],
    features: PlacedFeature[],
  ): PlacedFeature | null {
    const aim = anchorPoint(to, context);
    if (!aim) return null;

    const from = geometryAnchor(feature.geometry);

    /*
     * All the way there, then progressively less. A shed asked to move to a corner it cannot reach
     * should end up nearer the corner than it was, rather than refusing to move at all — the same
     * ladder `planner.service.ts` walks for step 5's moves.
     */
    for (const share of [1, 0.75, 0.5, 0.25]) {
      const target = {
        x: from.x + (aim.x - from.x) * share,
        y: from.y + (aim.y - from.y) * share,
      };

      const next: PlacedFeature = { ...feature, geometry: moveGeometry(feature.geometry, target) };
      if (featureIsLegal(next, boundary) && clearOfOthers(next, features)) return next;
    }

    return null;
  }

  /** Scales a feature about its own anchor, clamped to what still fits. */
  private rescale(
    feature: PlacedFeature,
    factor: number,
    boundary: Point[],
    features: PlacedFeature[],
  ): PlacedFeature | null {
    // Back towards 1, so "make it much bigger" gives as much bigger as the garden allows.
    const steps = [factor, 1 + (factor - 1) * 0.66, 1 + (factor - 1) * 0.33];

    for (const step of steps) {
      const geometry = scaleGeometry(feature.geometry, step);
      if (!geometry) return null;

      const next: PlacedFeature = { ...feature, geometry };
      if (featureIsLegal(next, boundary) && clearOfOthers(next, features)) return next;
    }

    return null;
  }
}

/* ---------------------------------------------------------------- pure helpers */

function sizeFor(
  action: Extract<GardenAction, { kind: 'add' }>,
  shrink: number,
): { width: number; depth: number } {
  const stated = action.size;

  if (stated?.kind === 'rect') {
    return { width: stated.width * shrink, depth: stated.depth * shrink };
  }
  if (stated?.kind === 'point') {
    const side = stated.radius * 2 * shrink;
    return { width: side, depth: side };
  }

  const base = ASSISTANT_SIZE[action.feature];
  return { width: base.width * shrink, depth: base.depth * shrink };
}

/**
 * How far a centre must sit from the free region's edge.
 *
 * Half the smaller side: exact for a disc, an under-estimate for a rectangle. That is fine and
 * deliberate — erosion here only has to stop the sampler wasting its 64 draws on hopeless spots.
 * What makes a placement correct is `featureIsLegal` and `clearOfOthers` in `place`, which every
 * candidate must pass. Over-eroding instead (by the half-diagonal) would be safe and would find
 * nothing at all in a tight garden.
 */
function inradiusOf(size: { width: number; depth: number }): number {
  return Math.min(size.width, size.depth) / 2;
}

/** The geometry kind each feature is placed as, at the given size. */
function geometryFor(
  kind: FeatureKind,
  at: Point,
  size: { width: number; depth: number },
): PlanGeometry {
  const placement = FEATURE_DEFINITIONS[kind].placement;

  if (placement === 'point') {
    return { kind: 'point', at, radius: Math.max(0.2, Math.min(size.width, size.depth) / 2) };
  }

  if (placement === 'polyline') {
    /*
     * A straight run centred on the anchor, laid along +x. The user drags the ends; guessing a
     * route from a sentence would be inventing a path rather than recording one.
     */
    const half = size.width / 2;
    return {
      kind: 'polyline',
      points: [
        { x: at.x - half, y: at.y },
        { x: at.x + half, y: at.y },
      ],
      width: Math.max(0.2, size.depth),
    };
  }

  /*
   * A rectangle even for the kinds the palette draws corner by corner. `placement` is about the
   * gesture a person uses, not about what a patio *is* — and a rectangle is both the commonest
   * real shape and the one the editor gives resize handles for.
   */
  return { kind: 'rect', centre: at, width: size.width, depth: size.depth, rotation: 0 };
}

function scaleGeometry(geometry: PlanGeometry, factor: number): PlanGeometry | null {
  const MIN = 0.3;

  switch (geometry.kind) {
    case 'point':
      return { ...geometry, radius: Math.max(0.2, geometry.radius * factor) };
    case 'rect':
      return {
        ...geometry,
        width: Math.max(MIN, geometry.width * factor),
        depth: Math.max(MIN, geometry.depth * factor),
      };
    case 'polyline':
      return { ...geometry, width: Math.max(0.2, geometry.width * factor) };
    case 'polygon': {
      const centre = polygonCentroid(geometry.points);
      return {
        ...geometry,
        points: geometry.points.map((point) => ({
          x: centre.x + (point.x - centre.x) * factor,
          y: centre.y + (point.y - centre.y) * factor,
        })),
      };
    }
    default:
      return null;
  }
}

/**
 * Nothing the assistant places or moves may sit on top of another existing feature.
 *
 * The same thing `features_overlap` checks server-side, in its TypeScript form — so the assistant
 * cannot propose a plan that the validator guarding its own save would then reject.
 */
function clearOfOthers(candidate: PlacedFeature, features: PlacedFeature[]): boolean {
  const ring = featureOutline(candidate);

  return !features.some(
    (other) => other.id !== candidate.id && polygonsIntersect(ring, featureOutline(other)),
  );
}

function describe(kind: FeatureKind): string {
  return FEATURE_DEFINITIONS[kind].label.toLowerCase();
}

function article(noun: string): string {
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}
