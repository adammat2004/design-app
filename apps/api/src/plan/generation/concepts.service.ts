import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  computeZones,
  effectiveZoneIds,
  featureOutline,
  keptElement,
  treeStamp,
  mixForBed,
  bedExposure,
  PLANTING_MIXES,
  gardenDirection,
  gardenDoors,
  gateThresholdDepth,
  gateThresholdRect,
  geometryClearsHouse,
  geometryFitsInside,
  scopeRing,
  geometryOutline,
  elementOutline,
  trunkFootprint,
  housePolygon,
  polygonCentroid,
  polygonArea,
  polygonsIntersect,
  resolvedGates,
  sidePathGate,
  streetDirection,
  streetEdge,
  SYMBOLS,
  THRESHOLD_DEPTH,
  thresholdRect,
  zoneAt,
  type DesignElement,
  type ElementCategory,
  type DesiredFeature,
  type GardenZone,
  type GeneratedConcept,
  type MaterialId,
  type PlanDocument,
  type PlanGeometry,
  type Point,
  configureStructure,
  STRUCTURE_DEFINITIONS,
  type RequestedFeatureCheck,
  type ZoneId,
  estimateBudgetBand,
  describeGeometry,
  type GardenBrief,
  type BriefSlot,
} from '@garden-studio/schema';
import {
  archetypeFor,
  CONCEPTS_PER_SET,
  FEATURE_SPECS,
  REPEATABLE_FEATURES,
  edgingFor,
  featureLabel,
  fillPalette,
  geometryAt,
  inradius,
  materialFor,
  scaledSpec,
  shiftBudget,
  styleLabel,
  type FeatureSpec,
} from './archetypes.js';
import {
  featureAttempts,
  resolveConstraints,
  treeSpeciesFor,
  type DesignConstraints,
} from './constraints.js';
import { FillService } from './fill.service.js';
import { furnishRoom, hostSymbol, type FurnishOptions } from './furnish.js';
import { gardenIsLit, lightingScheme } from './lighting.js';
import { hostChoice, TERRACE_SLOTS, type HostChoice } from './knowledge/structures.js';
import { retainingFor, stepsFromTerrace, terraceRise } from './levels.js';
import { sunSeatAffordable, wantsLoungeRoom } from './room-policy.js';
import { assignByPriority } from './layout/assign.js';
import { fitInSlot, type FitContext } from './layout/fit.js';
import { backFrame, frontFrame, gardenRoom, localBox, MIN_ROOM_AREA } from './layout/frame.js';

import {
  rectSize,
  RESERVED_SEATS,
  terraceClaim,
  type LayoutSketch,
  type SketchRequest,
} from './layout/sketch.js';
import { MIN_TREES, treeBudget, treeCandidates } from './layout/trees.js';
import { zoneRoles } from './layout/zone-roles.js';
import { PlacementService } from './placement.service.js';
import { conceptSeed, makeRng, sqlSeed } from './rng.js';
import { placeable } from './realise/placeable.js';
import { plantStructure } from './realise/structure.js';
import { fenceBorders } from './realise/borders.js';
import { frontGardenElements } from './realise/front-garden.js';
import { groundCover } from './realise/ground.js';
import { lawnAndBeds } from './realise/lawn-and-beds.js';
import { footprintOf, layExtraRooms } from './realise/extra-rooms.js';
import { layPaths } from './realise/routes.js';
import { archetypesForSlots } from './design/archetype-selector.js';
import { chooseLayouts } from './design/choose.js';
import { withinRing } from './design/circulation.js';
import { PURPOSE_BY_KIND } from './design/composition/compose.js';
import type { DesignBrief } from '@garden-studio/schema';
import { DesignBriefService } from '../assistant/design-brief/design-brief.service.js';
import { buildBriefs } from './design/brief-builder.js';
import { buildExplanation, decide, placedSentence } from './design/decisions.js';
import { NO_ADJUSTMENTS, slotBarred } from './design/types.js';
import { interpretRequirements, withinCapacity } from './design/requirements.js';
import { analyseSite, localShade, localView, lowSides } from './design/site-analysis.js';
import { scoreConcept } from './design/index.js';
import { planZones } from './design/zone-planner.js';
import type { Decision, ZonePlan } from './design/types.js';
import { defaultParams } from './knowledge/archetypes/index.js';
import { FEATURE_LIBRARY, placementLadder, roomSpec } from './knowledge/feature-library.js';

/**
 * Design generation.
 *
 * Two stages landing in one `elements` array: the features the brief asked for, then a fill pass
 * so a concept reads as a finished garden rather than a few shapes floating on graph paper.
 *
 * ```
 * PlanDocument + seed + index
 *   ├─ archetype                       balanced | entertaining | retreat
 *   ├─ layout = chooseLayouts          a composition, its parameters, what repair changed
 *   ▼
 * [A] zones = computeZones             four half-plane bands round the house
 *     roles = zoneRoles                main | arrival | passage | secondary | remote
 *     constraints = resolveConstraints  the only thing downstream reads the brief through
 *   ▼
 * [B] obstacles: house, kept features, door thresholds 1.8 m, gate thresholds 1.0 m
 *   ▼
 * [C] frame + room                     origin at the garden door, u out, v along the wall
 *   ▼
 * [D] sketch = composition.sketch     terrace, lawn | courtyard, bays, corridors, masses, trees
 *   ▼
 * [E] terrace  → fitInSlot             refuses below TERRACE_FLOOR rather than shrinking
 * [F] features → assignByPriority → fitInSlot, into the bays the composition reserved
 * [G] no house, nothing to compose round → PostGIS sampler
 * [H] side rooms, paths, front garden, trees
 *   ▼                                   ── everything below is ground, in z-order ──
 * [I] base fill      one whole-zone polygon per zone, category by role
 * [J] passage strips beside the house and round to the front corner
 * [K] lawn panel     one, over the base
 * [L] planting       the composition's masses, cut round the lawn and the rooms
 * [M] borders        fence bands in every zone but the main one and the front
 * [N] specimens, then featureLayer last, so features sit on their own ground
 * ```
 *
 * Array order *is* stacking order, and several tests pin it.
 *
 * Determinism is a requirement rather than a nicety — "Regenerate" has to mean "roll again", and
 * a concept the user chose has to be the concept they get. Every random choice comes from either
 * `makeRng(conceptSeed(...))` in TypeScript or a seeded `ST_GeneratePoints` in SQL, so the same
 * document and seed produce the same three concepts. (Caveat worth knowing: `ST_GeneratePoints`
 * is deterministic for a given PostGIS version, not across versions. The compose file pins
 * `postgis:16-3.4`, so do not write a test that assumes otherwise.)
 */

/**
 * How far inside the drawn redesign area everything is composed, in metres.
 *
 * Three simplify tolerances, and that derivation is the whole of it. `clipTo` and `accentRegions`
 * run `ST_SimplifyPreserveTopology` at `SIMPLIFY_TOLERANCE` (0.05 m) *without* re-clamping, so a
 * bed clipped to the room can end up a few centimetres outside it; with a hard containment guard
 * downstream, every bed along the scope's edge would then be refused outright rather than trimmed,
 * and a plan would lose its planting for a reason nothing on screen could explain.
 *
 * The visible cost is a 15 cm margin of untouched ground round the drawn area — 1.5 mm at 1:100,
 * under the plan's own line weight. Clamping after every simplify instead would be exact, and would
 * change what the *unscoped* path draws, which is the one thing this feature may not do.
 */
export const SCOPE_INSET = 0.15;

/**
 * How many trees a concept will try to place, and how big their canopies are.
 *
 * A radius, not a diameter, because that is what `inradius` wants: for a disc the placer's erosion
 * is exact, so a tree can be pushed as close to the fence as its own canopy allows and no closer.
 */
const TREE_RADIUS = 1.6;

/**
 * The requested features this generator **composes** rather than places.
 *
 * A lawn, a planting scheme and a lighting scheme are not objects that go in a slot — they are
 * passes that run over the whole plan. The composition reserves the lawn and draws the planting
 * masses round it, and `lightingScheme` reads the finished garden. Sending these through slot
 * assignment and the sampler as well would put a second lawn on top of the first, a stray bed in
 * the middle of it, and a lone bollard somewhere nobody walks.
 *
 * So they are held out of stage 1 entirely and reported at the end from what actually landed. The
 * tick still has force — it lifts the low-upkeep lawn ban and the low-budget lighting gate through
 * `resolveConstraints` — it just steers a pass instead of asking for a footprint.
 */
type ComposedFeature = 'lawn' | 'plantingBeds' | 'lighting';
const COMPOSED_FEATURES: ComposedFeature[] = ['lawn', 'plantingBeds', 'lighting'];

function isComposed(feature: DesiredFeature): feature is ComposedFeature {
  return (COMPOSED_FEATURES as DesiredFeature[]).includes(feature);
}

/**
 * What counts as the composed feature having been drawn.
 *
 * Read off the finished element list rather than trusted from upstream: the point of reporting
 * these at all is that a courtyard with no room for a lawn should say so, and only the elements
 * can tell you that.
 */
const COMPOSED_CATEGORIES: Record<ComposedFeature, ElementCategory> = {
  lawn: 'lawn',
  plantingBeds: 'planting-bed',
  lighting: 'lighting',
};

/** Which brief slot a concept index fills. Slot A is the recommendation. */
const SLOTS: BriefSlot[] = ['A', 'B', 'C'];

@Injectable()
export class ConceptsService {
  constructor(
    private readonly placement: PlacementService,
    private readonly fill: FillService,
    /**
     * The strategic brief writer, when one is wired up.
     *
     * Optional in the Nest sense *and* in the constructor's, because three call sites build this
     * service by hand — the concept suite, the reference fixtures and the eval harness — and none of
     * them wants a model. `null` is the ordinary state: the deterministic brief builder answers, and
     * the whole generator behaves exactly as it did before Phase 5.
     */
    @Optional()
    @Inject(DesignBriefService)
    private readonly strategist: DesignBriefService | null = null,
  ) {}

  /** A fresh set of three. */
  async generate(document: PlanDocument, seed: number): Promise<GeneratedConcept[]> {
    const strategic = await this.strategy(document, 0);
    return Promise.all(
      Array.from({ length: CONCEPTS_PER_SET }, (_, index) =>
        this.build(document, seed, index, strategic),
      ),
    );
  }

  /** One slot, rerolled in place. */
  async regenerate(document: PlanDocument, seed: number, index: number): Promise<GeneratedConcept> {
    /*
     * The same question as `generate` asked, and the service caches on the site and the brief — so
     * rerolling one slot costs no second call. That is the whole reason the cache is keyed on the
     * rendered inputs rather than on the document.
     */
    return this.build(document, seed, index, await this.strategy(document, index));
  }

  /**
   * What the three concepts are each trying to be, from a model where one is configured.
   *
   * Returns `null` — meaning "use the deterministic builder" — whenever no model answered, and that
   * is deliberately a *different* value from the fallback briefs rather than the same list handed
   * back. `read` builds its briefs against its own slot's constraints, so passing the fallback down
   * would quietly replace a per-concept reading with slot A's and change what the generator drew
   * with the feature switched off. Null changes nothing at all.
   */
  private async strategy(document: PlanDocument, index: number): Promise<DesignBrief[] | null> {
    if (!this.strategist?.available) return null;

    /* The same budget position `build` will use for this slot, so the two readings agree. */
    const archetype = archetypeFor(index, 0);
    const analysis = analyseSite(document);
    const constraints = resolveConstraints(document.brief, archetype, analysis.scale.designedArea);
    const requirements = interpretRequirements(document.brief, analysis, constraints);
    const fallback = buildBriefs(document.brief, requirements, analysis);

    const briefs = await this.strategist.write(document.brief, analysis, requirements, fallback);
    return briefs === fallback ? null : briefs;
  }

  private async build(
    document: PlanDocument,
    seed: number,
    index: number,
    strategic: DesignBrief[] | null = null,
  ): Promise<GeneratedConcept> {
    const { brief } = document;
    const site = document.site;
    const house = site.house;

    /*
     * Three concepts are three *shapes of plan*, not three rolls of one.
     *
     * Which shapes is now a question about the plot rather than about the slot index. Every
     * composition scores itself against this site and this brief and a score of zero is a refusal
     * that is honoured — so a courtyard is no longer offered a formal axis, and a wide shallow plot
     * gets the composition that lays its rooms beside each other instead of three that lay them
     * front to back. See `design/archetype-selector.ts`.
     *
     * `archetypeFor` — the budget and upkeep position — still follows the slot, so the
     * recommendation goes on answering the brief as written.
     */
    /*
     * **Slot A is the best fit and is therefore the recommendation.** `recommendedIndex(style)`
     * mapped a style to a fixed slot, which meant something only while the slots were a fixed list
     * of templates; with the composition chosen by suitability the recommendation is simply the one
     * that scored highest. The style still decides — it is 40% of every score — it just no longer
     * decides by pointing at a position.
     */
    const recommended = 0;
    const archetype = archetypeFor(index, recommended);
    const rng = makeRng(conceptSeed(seed, index));
    const conceptId = `c${seed}-${index}`;

    let counter = 0;
    const nextId = () => {
      counter += 1;
      return `${conceptId}-e${counter}`;
    };

    const boundary = site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    const houseRing = house ? housePolygon(house) : null;
    const rotation = house?.rotation ?? 0;

    /*
     * Zones are recomputed here rather than taken from the client. They are derived state, and
     * `effectiveZoneIds` is applied for the same reason it is on screen: moving the house can
     * dissolve a zone whose tick is still in the document, and designing into one that no longer
     * exists would put a patio in the middle of the house. No ticks at all is treated as "the
     * whole garden" rather than as "nothing to design".
     */
    const allZones = computeZones(boundary, house);
    const ticked = effectiveZoneIds(site.selectedZoneIds, allZones);
    const scope = ticked.length > 0 ? ticked : allZones.map((zone) => zone.id);
    const selected = allZones.filter((zone) => scope.includes(zone.id));

    /*
     * The custom redesign area, if the user drew one. `null` is not "the whole plot": every clip
     * and every guard below short-circuits on it, so a plan without one runs the identical code it
     * always did. Intersecting with the boundary instead would re-simplify every zone and move
     * coordinates on plans that never asked for a scope.
     *
     * `allZones` deliberately stays unclipped. A zone's *identity* is a fact about where the house
     * is, not about what the user ticked — `zoneOf`, `zoneRoles` and `usableWidth` all read it, and
     * an element near the edge of the drawn area still belongs to the garden it is standing in.
     */
    const scopePolygon = scopeRing(site);

    const zones = scopePolygon
      ? (
          await this.fill.clipRingsTo(
            selected.map((zone) => zone.polygon),
            scopePolygon,
            SCOPE_INSET,
          )
        ).flatMap((pieces, index) => pieces.map((ring) => rezone(selected[index]!, ring)))
      : selected;

    /** The unclipped zone behind each id, for the measurements that are facts about the plot. */
    const zoneById = new Map(allZones.map((zone) => [zone.id, zone]));

    const designedArea = zones.reduce((total, zone) => total + zone.area, 0);
    const constraints = resolveConstraints(brief, archetype, designedArea);

    /*
     * ---- the design agent's reading, before any geometry ----
     *
     * Pure and query-free, so it costs a fraction of a millisecond beside the dozen PostGIS round
     * trips below. It decides what the garden is for, what each requested feature is worth, which
     * rooms the plan is made of and which composition suits this plot — and every one of those was
     * previously either absent or a constant.
     */
    const design = this.read(document, constraints, index, strategic);

    /*
     * What a new element has to avoid. Kept features are real obstacles; removed and replaced ones
     * are not — freeing that ground is the whole point of having said "remove".
     */
    const obstacles: Point[][] = [];
    if (houseRing) obstacles.push(houseRing);

    const elements: DesignElement[] = [];
    /** Held back and appended last, so features always sit on top of their own ground cover. */
    const featureLayer: DesignElement[] = [];
    /** Collected separately only so the count can be capped across every zone, not per zone. */
    const trees: DesignElement[] = [];
    const treeCap = treeBudget(designedArea);

    /**
     * Plants one tree, if a tree belongs there. The only place a tree is created.
     *
     * Three things happen here that used to happen somewhere else or not at all.
     *
     * **The species is chosen before the geometry, not stamped on afterwards.** `stampPlanting`
     * used to assign the species at the very end, so every tree was placed as a 1.6 m circle and
     * then told it was a seven-metre hornbeam — a canopy drawn at two thirds the size its own
     * symbol declares, and the same size whatever it turned out to be. Asking first means a rowan
     * is a rowan's width and a fruit tree is a fruit tree's.
     *
     * **What must fit is the trunk; what must not collide is the canopy, and only with things a
     * canopy genuinely cannot pass through.** See `legalFootprint`. A canopy over a terrace, a path
     * or a border is what a garden with trees in it looks like; a canopy through a shed is not, and
     * neither is one through another canopy — so structures and trees are tested against the crown
     * while the ground it overhangs is tested against the trunk.
     *
     * **A tree is not an obstacle to everything.** Only its trunk goes on `obstacles`, so a bed or
     * a path laid afterwards may run under the branches. That is the whole point.
     */
    /**
     * The buildings a crown may not grow through, tessellated once per change rather than per try.
     *
     * A backdrop walk offers a couple of hundred candidate points and every one of them used to
     * re-outline every element in the plan. Keyed on how many elements there are, which is the only
     * way this list grows: nothing here is ever removed or reshaped after it is pushed.
     */
    let solidCount = -1;
    let solidRings: Point[][] = [];
    const solids = (): Point[][] => {
      const count = elements.length + featureLayer.length;
      if (count !== solidCount) {
        solidCount = count;
        solidRings = [...elements, ...featureLayer]
          .filter((element) => element.category === 'structure')
          .map((element) => elementOutline(element));
      }
      return solidRings;
    };

    const plantTree = (at: Point, zoneId?: ZoneId, purpose = 'backdrop-tree'): boolean => {
      if (trees.length >= treeCap) return false;

      const symbol = treeSpeciesFor(brief.style, trees.length);
      const spec = SYMBOLS[symbol].footprint;
      const radius = spec.kind === 'point' ? spec.radius : TREE_RADIUS;
      const canopy: PlanGeometry = { kind: 'point', at, radius };
      const crown = geometryOutline(canopy);
      const trunk = trunkFootprint(canopy);
      const stem = geometryOutline(trunk);
      /*
       * What a crown may not pass through: a building. A canopy over paving, a path or a border is
       * the ordinary case and the thing this change exists to allow; a canopy through a shed or a
       * garden room is not, and neither is one through another crown.
       */
      if (!placeable(trunk, houseRing, boundary, scopePolygon)) return false;
      /* The crown may hang over the ground, but not over the building it would be growing into. */
      if (!geometryClearsHouse(canopy, houseRing)) return false;
      if (obstacles.some((obstacle) => polygonsIntersect(stem, obstacle))) return false;
      if (solids().some((obstacle) => polygonsIntersect(crown, obstacle))) return false;
      if (trees.some((tree) => polygonsIntersect(crown, geometryOutline(tree.shape)))) return false;

      trees.push({
        id: nextId(),
        category: 'planting-bed',
        role: 'feature',
        name: 'Tree',
        symbol,
        shape: canopy,
        purpose,
        zone: zoneId ?? zoneOf(crown, allZones.length > 0 ? allZones : zones),
        material: materialFor('planting-bed', constraints, index),
        /* Its species, chosen after the symbol so the radius — and every placement — is unchanged. */
        ...treeStamp(brief.style, symbol, trees.filter((tree) => tree.symbol === symbol).length),
      });
      obstacles.push(stem);
      return true;
    };

    /*
     * What was kept keeps its nature — a tree its species, height and crown, a fence its line — see
     * `keptElement`. The obstacle is still the whole outline it was drawn as: a kept tree's crown is
     * not something the generator plants under until the user has said how big it really is.
     */
    for (const feature of document.features.features.filter((f) => f.status === 'keep')) {
      const outline = featureOutline(feature);
      obstacles.push(outline);
      featureLayer.push(keptElement(feature, `${conceptId}-keep-${feature.id}`, zoneOf(outline, zones)));
    }

    /*
     * ---- access: nothing may stand in a doorway or inside a gate ----
     *
     * The thresholds are obstacles to everything except the terrace, which is *meant* to sit in
     * front of the doors; `fit.ts` is told to ignore them for it.
     */
    const thresholds: Point[][] = [];
    if (house) {
      for (const door of gardenDoors(house)) {
        const rect = thresholdRect(house, door, THRESHOLD_DEPTH);
        if (!rect) continue;
        const outline = geometryOutline(rect);
        thresholds.push(outline);
        obstacles.push(outline);
      }
    }
    /*
     * Every opening in the boundary is kept clear, at the depth its own kind needs: a metre to
     * open a gate and step through, five for a car to stand inside a driveway. An `open` gap gets
     * a pedestrian's metre rather than nothing — there is no leaf to swing, but it is still the
     * way through, and a bed planted across it is a gap that is not a gap.
     */
    for (const entry of resolvedGates(site)) {
      const rect = gateThresholdRect(site, entry.gate, gateThresholdDepth(entry.gate));
      if (!rect) continue;
      const outline = geometryOutline(rect);
      thresholds.push(outline);
      obstacles.push(outline);
    }

    /* ---- stage 1: the features the brief asked for ---- */

    const requested = brief.desiredFeatures;
    /**
     * The requested features that stage 1 actually has to find room for.
     *
     * `attempts` is a budget of *placements*, and the composed three consume none — the lawn and
     * the borders are drawn by passes that would run anyway. Counting them would have a brief
     * that ticked "lawn" and "planting beds" quietly starve two real features out of the plan.
     */
    const toPlace = requested.filter((feature) => !isComposed(feature));
    const attempts = featureAttempts(toPlace.length, archetype, constraints);

    /**
     * The order the grammar tries features in — the agent's ranking, not the tick list's.
     *
     * **This closes a divergence rather than adding a preference.** The candidate loop previews and
     * scores a layout with the features taken in priority order, and the plan that was then built
     * took them in the order the user happened to tick the cards in. So the arrangement that won
     * was not always the arrangement that got drawn: a slot the preview gave to the dining area
     * could go to a fire pit at realisation, and the score the concept carried belonged to a garden
     * nobody saw.
     *
     * It is also the answer to a fault recorded against the old generator in its own right. The
     * placement budget cuts whatever falls past it, and cutting in tick order means a fire pit
     * ticked first can displace the dining space the garden is *for*. `withinCapacity` ranks by
     * tier and never cuts an essential; anything it already excluded is appended here so that it is
     * still reported rather than silently absent.
     */
    const rank = (feature: DesiredFeature) => {
      const at = design.placing.indexOf(feature);
      return at === -1 ? Number.MAX_SAFE_INTEGER : at;
    };
    const ordered = [...toPlace].sort((a, b) => rank(a) - rank(b));
    const checks: RequestedFeatureCheck[] = [];
    /** Features the grammar has answered, one way or the other. */
    const settled = new Set<DesiredFeature>();

    /*
     * The three answers that are *composed* rather than placed, held out of stage 1 entirely.
     *
     * A lawn, a border and a lighting scheme are not things the placer drops into a slot — the
     * composition reserves the lawn and draws the planting round it, and `lightingScheme` composes
     * from whatever ended up in the garden. Sending them through slot assignment and the sampler
     * as well would draw a second lawn on top of the first and a stray bed in the middle of it.
     *
     * So they are settled here with **no check pushed**: `settleComposed` below reports them once
     * the passes that actually draw them have run, from what landed rather than from what was
     * attempted. They are also left out of `attempts`, which counts placements, not preferences.
     */
    for (const feature of COMPOSED_FEATURES) settled.add(feature);
    /** What the grammar placed, by the slot it filled — where the sketch's paths go. */
    const placedBySlot = new Map<string, DesignElement>();
    /** Sampler-placed destinations: the first gathering place, then everything far from the house. */
    const destinations: { outline: Point[]; name: string; primary: boolean }[] = [];
    let sqlStep = 0;

    /**
     * The sampler: one footprint, tried in its preferred zones first and then anywhere else in
     * scope. The grammar's fallback, and the whole placer when there is no room to sketch in.
     */
    const place = async (spec: FeatureSpec) => {
      const preferred = zones.filter((zone) => spec.prefer.includes(zone.id));
      const searchOrder = [...preferred, ...zones.filter((zone) => !preferred.includes(zone))];

      for (const zone of searchOrder) {
        sqlStep += 1;

        const candidates = await this.placement.candidates({
          zone: zone.polygon,
          obstacles,
          inradius: inradius(spec),
          houseCentre: house?.centre ?? null,
          affinity: spec.affinity,
          seed: sqlSeed(conceptSeed(seed, index), sqlStep),
        });

        const geometry = this.pick(
          spec,
          candidates,
          zone,
          obstacles,
          boundary,
          houseRing,
          scopePolygon,
          rotation,
          rng,
        );
        if (geometry) return { geometry, zone: zone.id };
      }

      return null;
    };

    /*
     * A placed host, and — when it is a structure the 3D editor opens — a finished one: turned so its
     * open front faces `towards` (the terrace it serves, else the garden door), given a preset's
     * whole look, its fence-facing sides screened where the brief wants privacy, and an explicit
     * height. Nobody should have to open the 3D editor to make a generated pergola usable.
     */
    const hostFor = (
      feature: DesiredFeature,
      spec: FeatureSpec,
      geometry: PlanGeometry,
      name: string,
      materialIndex: number,
      purpose?: string,
      choice: HostChoice & { towards?: Point | null } = {},
    ): DesignElement => {
      const symbol = choice.symbol ?? hostSymbol(feature);
      const host: DesignElement = {
        id: nextId(),
        category: spec.category,
        role: 'feature',
        name,
        shape: geometry,
        ...(purpose ? { purpose } : {}),
        zone: zoneOf(geometryOutline(geometry), allZones.length > 0 ? allZones : zones),
        material: spec.material ?? materialFor(spec.category, constraints, materialIndex),
        ...(spec.edging ? { edging: spec.edging } : {}),
        ...(symbol ? { symbol } : {}),
      };
      return configureStructure(
        host,
        {
          style: constraints.style,
          budget: constraints.budget,
          lit: gardenIsLit(constraints),
          privacy: (slotChoice?.brief ?? design.brief).privacy,
          keepFrame: true,
          floor: coveredRoomFloor(terrace),
        },
        {
          elements: featureLayer,
          boundary,
          house: houseRing,
          towards:
            choice.towards ?? frame?.origin ?? (houseRing ? polygonCentroid(houseRing) : null),
        },
      );
    };

    /*
     * ---- the grammar: a frame off the door, a room behind it, a sketch in it ----
     */
    const garden = gardenDirection(site);
    const frame = house && garden ? backFrame(house, garden) : null;
    const room = await this.scopedRoom(
      frame && house ? gardenRoom(boundary, house, frame, scope) : [],
      scopePolygon,
    );
    // The grammar needs the room to be somewhere the user asked to have designed.
    const roomZone = room.length >= 3 ? zoneAt(polygonCentroid(room), allZones) : null;
    const grammar =
      frame && house && room.length >= 3 && roomZone && scope.includes(roomZone.id)
        ? { frame, room, box: localBox(room, frame) }
        : null;

    /*
     * The front, resolved here rather than at the front-garden pass, because the zone roles below
     * need to know which zone is the arrival — and the side rooms, the base fills and the borders
     * all read the roles.
     */
    const street = streetDirection(site);
    const front = house && street ? frontFrame(house, street) : null;
    const frontRoom = await this.scopedRoom(
      front && house ? gardenRoom(boundary, house, front, scope) : [],
      scopePolygon,
    );
    const frontZone = frontRoom.length >= 3 ? zoneAt(polygonCentroid(frontRoom), allZones) : null;

    /*
     * What each zone is *for*: the garden, the way in, the way past, or a garden of its own.
     * Derived every generation like the zones and the frame, never stored. Read by the side rooms,
     * the base fills and the borders. See `layout/zone-roles.ts`.
     */
    const roles = zoneRoles(allZones, {
      house,
      roomZoneId: roomZone?.id ?? null,
      frontZoneId: frontZone?.id ?? null,
    });

    /*
     * Which composition this slot draws, and how it is parameterised.
     *
     * Chosen from the plot rather than from `index % 3`: every archetype scores itself against this
     * site and this brief, a zero is a refusal that is honoured, and the slots take the best three
     * distinct answers. See `design/archetype-selector.ts`.
     */
    let sketch: LayoutSketch | null = null;
    let zonePlan: ZonePlan | null = null;
    let terrace: DesignElement | null = null;
    let lawn: DesignElement | null = null;
    /** The sketch wanted a terrace and nothing legal could be fitted: the card has to say so. */
    let terraceRefused = false;
    /*
     * The opening the side path starts at — not simply the first stored gate, which is what this
     * used to take. `sidePathGate` skips the street frontage (the front path already goes there)
     * and prefers a pedestrian gate over a driveway, because a side path carries the bins and the
     * mower rather than a car.
     */
    const gate = sidePathGate(site);

    /*
     * ---- the candidate loop ----
     *
     * Every composition that suits the plot, against every variation each of them offers, previewed
     * and scored — then the best that is not too like what the other slots have already taken. The
     * whole field costs a few milliseconds because a preview issues no query, which is the entire
     * reason the design layer was built pure. See `design/choose.ts`.
     *
     * `chooseLayouts` answers for all three slots at once, because being *different* is a property
     * of the set rather than of any one concept; this slot takes its own answer and builds it. With
     * no room to compose in there is nothing to preview, and the fall-back is the archetype the
     * selector ranked first — which is also the path a plot with no house takes.
     */
    /*
     * Rooms beyond the brief the plot can carry: a lounge where the brief and budget want one, and
     * a second helping where the placement budget exceeds what was asked for. A composed sketch
     * reserves a bay for each, so the surplus lands in the composition rather than wherever a
     * sampler found room — and the preview is told the same number, or it would compose a
     * different garden from the one realised.
     */
    const extraRooms =
      (wantsLoungeRoom(requested, constraints) ? 1 : 0) +
      (attempts > toPlace.length && toPlace.some((feature) => REPEATABLE_FEATURES.includes(feature))
        ? 1
        : 0);

    const chosen = grammar
      ? chooseLayouts({
          analysis: design.analysis,
          briefs: design.briefs,
          context: {
            constraints,
            room: grammar.room,
            box: grammar.box,
            frame: grammar.frame,
            boundary,
            houseRing,
            scope: scopePolygon,
            obstacles,
            thresholds,
            placing: design.placing,
            zoneAt: (ring) => zoneOf(ring, allZones.length > 0 ? allZones : zones),
            gateSide: gate ? (grammar.frame.toLocal(gate.centre).v >= 0 ? 'right' : 'left') : null,
            gateCentre: gate?.centre ?? null,
            lawnAllowed: !constraints.forbiddenFill.includes('lawn'),
            extraRooms,
            view: localView(design.analysis),
          },
        })
      : [];

    const slotChoice = chosen[index % SLOTS.length] ?? null;
    const composition = slotChoice?.candidate.fit.archetype ?? design.composition.archetype;
    const params = slotChoice?.candidate.params ?? defaultParams(composition.id);

    /*
     * What the repair stage changed about this layout, honoured here as well as in the preview.
     *
     * **This is the rule that keeps a repair honest.** The loop accepts a change only on a measured
     * improvement to the preview's score — so if the pipeline that actually draws the plan ignored
     * the change, the concept would carry a score claiming an improvement the garden does not have.
     * Every field of `LayoutAdjustments` is read below; adding one means plumbing it here in the
     * same change. An unrepaired candidate carries the empty set and draws exactly what it always
     * drew.
     */
    const adjustments = slotChoice?.adjustments ?? NO_ADJUSTMENTS;
    /** What the candidate loop composed from: the capacity cut, less anything a repair left out. */
    const placingNow = design.placing.filter((feature) => !adjustments.dropped.includes(feature));
    /*
     * Whether a feature is inside the placement budget. **Anything the chosen layout placed is.**
     * There were two budgets and they disagreed: the candidate loop previews with `withinCapacity`,
     * a ranked cut that never drops an essential, and this loop then cut again at `featureAttempts`
     * — so on a shallow plot the preview scored a water feature the built plan never drew. The
     * parity test in `parity.test.ts` is what found it. `attempts` still bounds everything the loop
     * did not place, and the surplus that comes after.
     */
    const withinBudget = (order: number, feature: DesiredFeature) =>
      order < attempts || placingNow.includes(feature);

    /*
     * A feature the repair left out is reported as left out, with the reason it was. Settling it
     * here keeps it out of the grammar *and* out of the sampler, which would otherwise cheerfully
     * put back the thing that was removed for spoiling something else.
     */
    for (const feature of adjustments.dropped) {
      if (settled.has(feature)) continue;
      settled.add(feature);
      checks.push({
        feature,
        label: featureLabel(feature, brief),
        included: false,
        reason: 'Left out to keep the rest of the garden working.',
      });
    }

    /**
     * What this concept decided, recorded by the pass that decided it.
     *
     * The rule that keeps the explanation honest: a decision names the elements it produced, so the
     * concept cannot claim the terrace went at the doors unless a terrace element exists to point
     * at. Until now the only prose a concept carried was one of three fixed sentences about the
     * template, identical whether the plan had a shed in the corner or no shed at all.
     */
    const decisions: Decision[] = [
      decide(
        'composition',
        `${composition.name}. ${slotChoice?.candidate.fit.reasons[0] ?? design.composition.reasons[0] ?? composition.summary}`,
      ),
      ...(slotChoice && slotChoice.considered > 1
        ? [
            decide(
              'chosen-from',
              `Chosen from ${slotChoice.considered} arrangements of this garden, on circulation, grouping and how the space is proportioned.`,
            ),
          ]
        : []),
    ];

    if (grammar && house) {
      const request: SketchRequest = {
        /*
         * The list the preview composed from, not the tick list: a composed sketch reserves a bay
         * for every feature it is given, so realising from a different list would build a
         * different garden from the one the candidate loop chose.
         */
        features: placingNow,
        scale: constraints.scale.sizeFactor,
        style: constraints.style,
        lawnAllowed: !constraints.forbiddenFill.includes('lawn'),
        maintenance: constraints.maintenance,
        // Which side of the door the gate is, in the frame's own terms: `v` runs right looking out.
        gateSide: gate ? (grammar.frame.toLocal(gate.centre).v >= 0 ? 'right' : 'left') : null,
        houseWallLength: grammar.frame.wallLength,
        doorWidth: grammar.frame.doorWidth,
        extraRooms,
        view: localView(design.analysis),
        gate: gate ? grammar.frame.toLocal(gate.centre) : null,
        essential: (slotChoice?.brief ?? design.brief).featurePriorities
          .filter((priority) => priority.tier === 'essential')
          .map((priority) => priority.feature),
        privacy: (slotChoice?.brief ?? design.brief).privacy,
        lowSides: lowSides(design.analysis),
        primaryZone: (slotChoice?.brief ?? design.brief).primaryZone,
        shade: localShade(design.analysis),
        sunSeat: sunSeatAffordable(constraints),
      };
      const sketchRoom = {
        uMin: Math.max(0, grammar.box.uMin),
        uMax: grammar.box.uMax,
        vMin: grammar.box.vMin,
        vMax: grammar.box.vMax,
        polygon: grammar.box.polygon,
      };

      /*
       * The rooms first, then the composition that arranges them. `params` is the composition's own
       * first choice — the plan as its author intended it — which is what keeps this phase's output
       * identical for the three original compositions. Phase 3 enumerates the rest of the list.
       */
      zonePlan = planZones({
        brief: design.brief,
        site: design.analysis,
        archetype: composition,
        params,
        room: sketchRoom,
        request,
        placing: placingNow,
      });
      sketch = composition.sketch(request, sketchRoom, zonePlan, params);
      /*
       * The candidate loop never chooses a composition that declined, and the repair stage never
       * changes one into it — so this is a divergence between the preview and the realisation, and
       * it is said on the card rather than drawn under a name it does not deserve. The harness
       * counts these; it should read nought.
       */
      if (sketch.composed.lastResort && composition.id !== 'courtyard') {
        decisions.push(
          decide(
            'last-resort',
            `The ${composition.name.toLowerCase()} could not hold this brief once it was built, so the garden is drawn as a courtyard instead.`,
          ),
        );
      }
      /* What the composition decided, recorded as the realisation's own decisions. */
      for (const decision of sketch.composed.decisions)
        decisions.push(decide(decision.kind, decision.text));

      const fitContext: FitContext = {
        frame: grammar.frame,
        room: grammar.room,
        houseRing,
        boundary,
        obstacles,
      };

      /*
       * The terrace first. It exists in every plan — a garden with nowhere to step out onto is not
       * a garden design — and asking for somewhere to sit or eat is what furnishes it.
       *
       * Which of the two claims it matters, because they are furnished differently: seating gets
       * the sofas, dining gets the table. Seating wins when both were asked for, and the dining
       * area then takes `terrace-end` or `beside-terrace` from the slot pass below — which is how
       * a garden with both is actually laid out, rather than one patio doing two jobs badly.
       */
      const terraceSlot = sketch.slots.find((slot) => slot.kind === 'terrace');
      if (sketch.terrace && terraceSlot) {
        const size = rectSize(sketch.terrace);
        const geometry = fitInSlot({ kind: 'rect', ...size }, terraceSlot, {
          ...fitContext,
          ignore: thresholds,
        });

        if (geometry) {
          /*
           * From the list the composition was given, so the feature the terrace is furnished for is
           * the one the composition did not reserve a bay for.
           */
          const terraceFeature = terraceClaim(request.features, request.primaryZone);
          terrace = hostFor(
            terraceFeature ?? 'seating',
            FEATURE_SPECS.seating,
            geometry,
            terraceFeature ? FEATURE_SPECS[terraceFeature].planName! : 'Terrace',
            index,
            'terrace',
          );
          obstacles.push(geometryOutline(geometry));
          featureLayer.push(terrace);
          placedBySlot.set(terraceSlot.id, terrace);
          decisions.push(
            decide(
              'terrace-at-doors',
              `Put the ${(terrace.name ?? 'terrace').toLowerCase()} directly outside the garden doors, ${describeGeometry(geometry, document.unit)}.`,
              [terrace.id],
            ),
          );

          /*
           * ---- the level change, if this concept makes one ----
           *
           * Lifted before the flight is cut, because the flight climbs what the terrace is raised
           * by: one number, read twice. A refused flight leaves the terrace on grade rather than
           * raised with no way down off it — a raised terrace you cannot step off is worse than a
           * flat one, and this is the only place that can tell.
           */
          const rise = terraceRise(constraints);
          if (rise > 0 && frame) {
            const flight = stepsFromTerrace(terrace, {
              frame,
              rise,
              boundary,
              houseRing,
              obstacles,
              nextId,
            });

            /*
             * The flight is the one thing here measured *outwards* from a placed feature — it runs
             * past the terrace's outer edge by its own going — so a terrace hard against the
             * redesign area's edge throws its steps outside it. Guarded at the call site rather
             * than inside `levels.ts`, which knows nothing about scope and should not start to.
             */
            if (flight && (!scopePolygon || geometryFitsInside(flight.shape, scopePolygon))) {
              terrace.elevation = rise;
              flight.purpose = 'transition';
              const walling = retainingFor(constraints);
              if (walling) terrace.retaining = walling;
              obstacles.push(geometryOutline(flight.shape));
              featureLayer.push(flight);
            }
          }

          if (terraceFeature) {
            this.furnishHost(terrace, terraceFeature, featureLayer, obstacles, {
              index,
              rng,
              constraints,
              houseRing,
              boundary,
              nextId,
              bearing: frame?.wallBearing,
            });
            settled.add(terraceFeature);
            checks.push({
              feature: terraceFeature,
              label: featureLabel(terraceFeature, brief),
              included: true,
            });
          }
        } else {
          /*
           * Refused: obstacles block every nudge down to the floor. Seating is left unsettled so
           * it falls through to the other slots and the sampler like any feature, but the
           * terrace itself, its furniture and every path that starts from it are gone — so the
           * concept says so rather than quietly drawing a garden with no way out of the house.
           */
          terraceRefused = true;
        }
      }

      /*
       * `assignByPriority`, the same function the preview uses: a feature's own room first, then
       * its slot-kind ladder. Two assignment functions over one sketch is two opinions about where
       * the dining area goes, and the loop chose on the other one's.
       */
      const assigned = assignByPriority(
        {
          ...sketch,
          slots: sketch.slots.filter(
            (slot) => slot.kind !== 'terrace' && !RESERVED_SEATS.includes(slot.purpose ?? ''),
          ),
        },
        ordered.filter((feature) => !settled.has(feature)),
      );

      // `ordered`, not `requested`: `order` is a position in the placement budget, and the
      // composed three take none of it.
      for (const [order, feature] of ordered.entries()) {
        if (settled.has(feature)) continue;
        const label = featureLabel(feature, brief);

        if (!withinBudget(order, feature)) {
          checks.push({ feature, label, included: false });
          settled.add(feature);
          continue;
        }

        const entry = assigned.find((candidate) => candidate.feature === feature);
        const spec = scaledSpec(
          roomSpec(
            feature,
            sketch?.composed.language,
            (slotChoice?.brief ?? design.brief).primaryZone,
          ),
          constraints,
        );
        const candidates = [
          ...sketch.slots.filter((candidate) => candidate.id === entry?.slotId),
          ...placementLadder(feature).flatMap((kind) =>
            sketch!.slots.filter(
              (candidate) =>
                candidate.kind === kind && !RESERVED_SEATS.includes(candidate.purpose ?? ''),
            ),
          ),
        ].filter(
          (candidate) =>
            !placedBySlot.has(candidate.id) && !slotBarred(adjustments, feature, candidate.id),
        );
        const fitted = candidates
          .map((slot) => ({ slot, geometry: fitInSlot(footprintOf(spec), slot, fitContext) }))
          .find((candidate) => candidate.geometry !== null);
        if (!fitted?.geometry) continue;
        const { slot, geometry } = fitted;

        // A pergola out at the far end of a traditional or natural garden is a gazebo.
        const choice = hostChoice(feature, slot.kind, constraints.style);
        const planName = choice.planName ?? spec.planName ?? label;
        // A room beside the terrace opens onto it; anything else opens towards the house.
        const servesTerrace = terrace !== null && TERRACE_SLOTS.includes(slot.kind);
        const host = hostFor(
          feature,
          spec,
          geometry,
          planName,
          index,
          slot.purpose ?? PURPOSE_BY_KIND[slot.kind],
          {
            ...choice,
            towards: servesTerrace ? polygonCentroid(geometryOutline(terrace!.shape)) : null,
          },
        );
        obstacles.push(geometryOutline(host.shape));
        featureLayer.push(host);
        placedBySlot.set(slot.id, host);
        this.furnishHost(host, feature, featureLayer, obstacles, {
          index,
          rng,
          constraints,
          houseRing,
          boundary,
          nextId,
          bearing: frame?.wallBearing,
          // Dining asked for means a table by the house, whichever room it took.
          diningElsewhere: ordered.includes('dining'),
        });

        settled.add(feature);
        checks.push({ feature, label, included: true });
        decisions.push(
          decide(
            'feature-in-zone',
            placedSentence(planName, FEATURE_LIBRARY[feature].zone, slot.kind, gate !== null),
            [host.id],
          ),
        );
        if (choice.symbol === 'gazebo') {
          decisions.push(
            decide(
              'structure',
              'Made the covered room at the far end a gazebo: somewhere to sit that is worth the walk, where a pergola by the house would be for eating.',
              [host.id],
            ),
          );
        }
      }
    }

    /* ---- the sampler, for whatever the grammar could not place ---- */

    for (const [order, feature] of ordered.entries()) {
      if (settled.has(feature)) continue;
      const label = featureLabel(feature, brief);

      if (!withinBudget(order, feature) || zones.length === 0) {
        checks.push({ feature, label, included: false });
        continue;
      }

      /*
       * **No sampler inside a composed garden.** The sampler is what put a fire pit in the middle of
       * the lawn: it finds room wherever room is, and on a composed plan the only room left is the
       * open ground the composition reserved and the corridors it kept. A feature the composition
       * found no bay for is reported as not included, with the reason, which is the honest answer
       * and the one the card can say. The sampler remains the whole placer where there is nothing
       * to compose round — a plot with no house or no garden door.
       */
      if (sketch) {
        checks.push({
          feature,
          label,
          included: false,
          reason: 'No room for it in this composition without standing it on the lawn.',
        });
        continue;
      }

      const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
      const placed = await place(spec);

      if (!placed) {
        checks.push({ feature, label, included: false });
        continue;
      }

      const host = hostFor(feature, spec, placed.geometry, spec.planName ?? label, index);
      const outline = geometryOutline(host.shape);
      obstacles.push(outline);
      featureLayer.push(host);
      this.furnishHost(host, feature, featureLayer, obstacles, {
        index,
        rng,
        constraints,
        houseRing,
        boundary,
        nextId,
        bearing: frame?.wallBearing,
      });

      if (
        !terrace &&
        !destinations.some((d) => d.primary) &&
        (feature === 'seating' || feature === 'pergola')
      ) {
        destinations.push({ outline, name: host.name ?? label, primary: true });
      } else if (spec.affinity === 'far-from-house' && spec.footprint.kind === 'rect') {
        destinations.push({ outline, name: host.name ?? label, primary: false });
      }

      checks.push({ feature, label, included: true });
    }

    await layExtraRooms({
      sketch,
      grammar,
      house,
      houseRing,
      boundary,
      scopePolygon,
      terrace,
      featureLayer,
      obstacles,
      placedBySlot,
      destinations,
      zones,
      roles,
      brief,
      requested,
      toPlace,
      attempts,
      primaryZone: (slotChoice?.brief ?? design.brief).primaryZone,
      constraints,
      index,
      hostFor,
      furnish: (host, feature, furnishIndex) =>
        this.furnishHost(host, feature, featureLayer, obstacles, {
          index: furnishIndex,
          rng,
          constraints,
          houseRing,
          boundary,
          nextId,
          bearing: frame?.wallBearing,
        }),
      place,
      zoneOf: (ring) => zoneOf(ring, allZones.length > 0 ? allZones : zones),
    });

    /* ---- paths: from the terrace to the rooms, from the gate to the terrace ---- */

    const pathElement = (
      geometry: PlanGeometry,
      name: string,
      material: MaterialId,
      category: DesignElement['category'] = 'paved-area',
      purpose?: string,
    ): DesignElement => ({
      id: nextId(),
      category,
      role: 'feature',
      name,
      shape: geometry,
      ...(purpose ? { purpose } : {}),
      zone: zoneOf(geometryOutline(geometry), allZones.length > 0 ? allZones : zones),
      material,
    });

    layPaths({
      houseRing,
      sketch,
      frame: grammar?.frame ?? null,
      terrace,
      featureLayer,
      placedBySlot,
      gate: gate ? { centre: gate.centre, inward: gate.inward } : null,
      obstacles,
      thresholds,
      boundary,
      scopePolygon,
      adjustments,
      constraints,
      index,
      destinations,
      pathElement,
    });

    /* ---- the front garden: a path to the street, beds by the wall, a hedge along the fence ---- */

    const frontFills =
      house && houseRing && front && frontZone && scope.includes(frontZone.id)
        ? frontGardenElements({
            frame: front,
            room: frontRoom,
            zone: frontZone.id,
            street: streetEdge(site),
            houseRing,
            thresholds,
            boundary,
            scopePolygon,
            obstacles,
            constraints,
            index,
            nextId,
            featureLayer,
            pathElement,
            plantTree,
          })
        : [];

    /*
     * ---- trees ----
     *
     * Framing trees at the sketch's points first — the far corners, the mid-sides — then the
     * sampler if the plot has room for more. Appended to `featureLayer`, so they land after
     * every fill. Trees do not go on `checks`: nobody asked for these.
     */
    if (sketch && grammar) {
      /*
       * The same candidates, in the same order, the preview plants from — each one a tree the
       * composition placed for a reason (focal, framing, screening, backdrop). See
       * `treeCandidates`: two lists that had to agree by hand are now one.
       */
      for (const candidate of treeCandidates(sketch, grammar.frame, adjustments.treeNudge)) {
        if (trees.length >= treeCap) break;
        for (const at of candidate.points) {
          const stem = geometryOutline(trunkFootprint({ kind: 'point', at, radius: 1 }));
          if (!withinRing(stem, grammar.room)) continue;
          if (plantTree(at, undefined, candidate.purpose)) break;
        }
      }
    }

    /*
     * The top-up: a sampler, so only where nothing was composed. On a composed plan a garden with
     * fewer trees than the budget allows is one whose beds had no more room for one with a reason,
     * and a tree dropped wherever there is ground is the specimen marooned in the lawn the
     * composition exists to prevent.
     */
    if (trees.length < MIN_TREES && !sketch) {
      for (const zone of zones) {
        if (trees.length >= treeCap) break;

        sqlStep += 1;

        const candidates = await this.placement.candidates({
          zone: zone.polygon,
          obstacles,
          inradius: TREE_RADIUS,
          houseCentre: house?.centre ?? null,
          affinity: 'far-from-house',
          seed: sqlSeed(conceptSeed(seed, index), sqlStep),
        });

        for (const at of candidates) {
          if (trees.length >= treeCap) break;
          plantTree(at, zone.id);
        }
      }
    }

    featureLayer.push(...trees);

    /* ---- stage 2: fill, so no chosen zone is left as bare graph paper ---- */

    const palette = fillPalette(constraints, index);

    elements.push(
      ...groundCover({
        zones,
        roles,
        house,
        palette,
        constraints,
        index,
        nextId,
        frontExtent: {
          depth: front && frontRoom.length >= 3 ? localBox(frontRoom, front).uMax : null,
          area: frontRoom.length >= 3 ? polygonArea(frontRoom) : 0,
        },
      }),
    );

    /* ---- the lawn panel, and the beds composed with it ---- */

    const ground =
      sketch && grammar
        ? await lawnAndBeds({
            sketch,
            frame: grammar.frame,
            room: grammar.room,
            fill: this.fill,
            featureLayer,
            constraints,
            index,
            nextId,
            houseRing,
            boundary,
            scopePolygon,
            zoneId: roomZone?.id ?? 'back',
          })
        : null;
    lawn = ground?.lawn ?? null;
    const designed = ground?.designed ?? [];
    if (ground?.openGround) {
      decisions.push(decide('open-ground', ground.openGround.text, [ground.openGround.lawnId]));
    }

    /* ---- the borders: everything round the rooms, in runs, laid under the lawn ---- */

    elements.push(
      ...(await fenceBorders({
        fill: this.fill,
        grammarRoom: grammar?.room ?? null,
        composed: sketch !== null,
        designed,
        lawn,
        featureLayer,
        frontFills,
        zones,
        zoneById,
        roles,
        skip: [frontZone?.id, roomZone?.id],
        house,
        boundary,
        houseRing,
        scopePolygon,
        obstacles,
        constraints,
        index,
        nextId,
        accentCount: archetype.accentCount,
        accents: palette.accents,
      })),
    );

    elements.push(...designed);
    if (lawn) elements.push(lawn);
    elements.push(...frontFills);

    /*
     * ---- specimen shrubs ----
     *
     * A few larger plants standing in the beds, so a border reads as planted with intent rather
     * than filled. They are points inside an accent bed, and `candidates` with no obstacles and the
     * shrub's own radius is exactly "somewhere fully inside this bed".
     */
    /*
     * The structural planting, placed as real elements on top of the beds.
     *
     * This used to be two to four "specimen shrubs" sampled by PostGIS — a random point in a random
     * bed, which is placement rather than design. It is now the scheme's own `backdrop` and
     * `specimen` layers, drawn from `samplePlanting`: the same function, the same seed and the same
     * drift and edge-grading the painter uses for the infill. So a shrub stands exactly where the
     * texture would have drawn one, and the bed's remaining layers are told to leave a gap for it.
     *
     * Placed rather than painted because a border's structure is what a designer positions and a
     * user needs to move. The infill stays a texture — see `STRUCTURAL_ROLES`.
     */
    const specimens = await plantStructure(elements, {
      constraints,
      obstacles,
      houseRing,
      boundary,
      scopePolygon,
      nextId,
      placement: this.placement,
      houseCentre: house?.centre ?? null,
      nextSeed: () => sqlSeed(conceptSeed(seed, index), ++sqlStep),
    });
    featureLayer.push(...specimens);

    /* ---- features last, so they sit on top of their own ground cover ---- */

    elements.push(...featureLayer);

    /*
     * ---- lighting, after the stamp ----
     *
     * Genuinely last, and it has to be *after* `stampPlanting` rather than merely after the
     * features: a tree is a bare `planting-bed` point until the stamp gives it its species symbol,
     * so a lighting pass that ran before it saw no trees at all and quietly specified bollards and
     * nothing else. The stamp is therefore resolved to a value here rather than applied inline in
     * the return, which is what lets the scheme read the finished concept.
     *
     * Nothing is pushed onto `obstacles`: a spike light standing among the planting it lights is
     * the point of one, and treating a 120 mm fitting as an obstacle would push a whole bed away
     * from it.
     */
    /*
     * Every bed stamped with the concept's planting style and every tree with its species, in one
     * pass rather than at each of the eight places a bed is created.
     *
     * Total by construction, which is the point: a ninth site that forgot would silently produce
     * beds that fall back to the default scheme, and a bed planted differently from its neighbours
     * for no reason is exactly the kind of fault nobody reports because it just looks like the
     * generator being arbitrary.
     */
    const stamped = stampEdging(
      this.stampPlanting(elements, constraints, brief.style, document.site),
      constraints,
    );
    const lights = lightingScheme(stamped, {
      constraints,
      index,
      boundary,
      scope: scopePolygon,
      nextId,
    });

    /*
     * ---- the composed three, reported from what was actually drawn ----
     *
     * Last, because this is the first point at which the lawn panel, the borders and the lighting
     * scheme all exist. Each is answered by looking at the finished element list rather than by
     * anything upstream claiming to have placed it — so a courtyard with no room for a lawn says
     * the lawn is not included, and a plan whose planting was all refused as slivers says so too,
     * instead of both quietly reading as a success.
     */
    for (const feature of COMPOSED_FEATURES) {
      if (!requested.includes(feature)) continue;
      checks.push({
        feature,
        label: featureLabel(feature, brief),
        included: [...stamped, ...lights].some(
          (element) => element.category === COMPOSED_CATEGORIES[feature],
        ),
      });
    }

    /*
     * The card's words come from the composition that drew the plan, which is the first time they
     * have described *this* garden rather than the template family. `styleLabel` still supplies the
     * user's own half of the line.
     */
    const name = composition.name;
    const summary = composition.summary;
    const style = `${styleLabel(brief)} / ${composition.tone}`;
    const finished = [...stamped, ...lights];

    /*
     * ---- what the design agent makes of the finished plan ----
     *
     * Scored *after* the elements exist rather than consulted while they are being made. Nothing
     * here can move a coordinate: `elements` is already final, and the score only decides what the
     * concept says about itself.
     */
    return {
      id: conceptId,
      name,
      recommended: index === recommended,
      summary: terraceRefused
        ? `${summary} There was no clear room for a terrace at the doors, so none is drawn.`
        : summary,
      style,
      budget: shiftBudget(constraints.budget, archetype.budgetShift),
      /*
       * The badge reads the same value the palette did. This line and `fillPalette` used to be the
       * two sources that disagreed — the badge came from the archetype, the ground cover from the
       * brief — which is how a concept could say "Low" over a lawn.
       */
      maintenance: constraints.maintenance,
      /** What the materials actually came to, as opposed to the position above. */
      estimatedBudget: estimateBudgetBand(finished),
      requestedFeaturesIncluded: this.explainChecks(checks, design.brief),
      elements: finished,
      strategy: {
        briefId: design.brief.id,
        archetype: composition.id,
        candidateId: conceptId,
      },
      score: scoreConcept(finished, design.analysis, design.brief),
      explanation: buildExplanation(
        design.brief,
        composition.id,
        decisions,
        slotChoice?.repairs ?? [],
      ),
    };
  }

  /**
   * The design agent's reading of this document for one concept slot.
   *
   * Pure and query-free, so it costs a fraction of a millisecond beside the dozen PostGIS round
   * trips `build` has already made. `constraints` is passed in rather than resolved again: it is
   * the generator's own per-concept reading of the brief, and there goes on being exactly one.
   */
  private read(
    document: PlanDocument,
    constraints: DesignConstraints,
    index: number,
    /**
     * The strategic briefs a model wrote, where one did.
     *
     * `null` is the ordinary case and means the deterministic builder answers, which is what every
     * generation did before this existed and what every generation still does with the flag off.
     * Supplied rather than fetched because the call is made **once per set** in `generate`, and a
     * read that could reach for a model would be a read that makes three calls.
     */
    strategic: DesignBrief[] | null,
  ) {
    const analysis = analyseSite(document);
    const requirements = interpretRequirements(document.brief, analysis, constraints);
    const briefs = strategic ?? buildBriefs(document.brief, requirements, analysis);
    const slot = SLOTS[index % SLOTS.length]!;
    const brief = briefs.find((entry) => entry.id === slot) ?? briefs[0]!;

    /*
     * The compositions for all three slots, chosen together. Together rather than one at a time
     * because the three have to be *distinct* — which is a property of the set, not of any one
     * concept, and the reason `index % 3` produced three different plans by accident.
     */
    /*
     * The composition the selector would pick for this slot with no candidate loop to hand.
     *
     * Kept as the fall-back for a plot with no room to compose in — no house, or a drawn area that
     * misses the doors — where there is nothing to preview and the sampler does the work. With a
     * room, `chooseLayouts` supersedes it.
     */
    const composition = archetypesForSlots(analysis, briefs)[index % SLOTS.length]!.fit;

    return {
      analysis,
      requirements,
      brief,
      briefs,
      composition,
      /* What survived the capacity cut, in priority order: the rooms are built from these. */
      placing: withinCapacity(requirements).keep,
    };
  }

  /**
   * The feature checks, with a reason on each one the concept left out.
   *
   * "The pond is missing" and "there was no room for the pond without losing the lawn" are
   * different answers and only the second is a design decision. The reason comes from the brief's
   * own exclusion list where the agent decided one, and falls back to the plain fact otherwise —
   * never invented, because a reason nothing measured is worse than no reason.
   */
  private explainChecks(
    checks: RequestedFeatureCheck[],
    brief: ReturnType<ConceptsService['read']>['brief'],
  ): RequestedFeatureCheck[] {
    return checks.map((check) => {
      if (check.included) return check;
      const excluded = brief.excludedFeatures.find((entry) => entry.feature === check.feature);
      return excluded ? { ...check, reason: excluded.reason } : check;
    });
  }

  /**
   * The two things every bed and every tree gets, applied once rather than at each of the eleven
   * places one is created.
   *
   * Total by construction, which is the point: a twelfth site that forgot would produce a bed
   * planted differently from its neighbours, or a tree with no species, for no reason a user could
   * see — and nobody reports that, because it just looks like the generator being arbitrary.
   *
   * A tree is a point in the planting-bed category with no symbol of its own. Specimens are points
   * too and are excluded by already carrying `symbol: 'specimen'`, which is what makes this safe to
   * apply broadly rather than having to enumerate the tree sites.
   */
  private stampPlanting(
    elements: DesignElement[],
    constraints: DesignConstraints,
    style: GardenBrief['style'],
    site: PlanDocument['site'],
  ): DesignElement[] {
    let tree = 0;
    const perSymbol = new Map<string, number>();

    return elements.map((element) => {
      if (element.category !== 'planting-bed') return element;

      const isTree = element.shape.kind === 'point' && element.symbol === undefined;
      const symbol = isTree ? treeSpeciesFor(style, tree++) : element.symbol;
      const nth = isTree && symbol ? (perSymbol.get(symbol) ?? 0) : 0;
      if (isTree && symbol) perSymbol.set(symbol, nth + 1);

      /*
       * A bed is planted from a mix: by its planting style, and by the light where the plan knows it,
       * so a border in the shade of the house gets the woodland mix. On `planting`, not `material` —
       * the material is what the scorer reads for upkeep and style, and it is kept.
       */
      const mix =
        element.shape.kind !== 'point' && !element.planting && element.fillKind !== 'base'
          ? mixForBed(
              constraints.plantingStyle,
              element.material,
              site.location ? (bedExposure(site, element, elements)?.light ?? null) : null,
            )
          : null;

      return {
        ...element,
        plantingStyle: constraints.plantingStyle,
        symbol,
        ...(isTree && symbol ? treeStamp(style, symbol, nth) : {}),
        ...(mix ? { planting: { mix: PLANTING_MIXES[mix]!.mix } } : {}),
      };
    });
  }

  /**
   * Puts the thing that belongs inside a placed feature after it in the layer — array order is
   * stacking order, so the table lands on the pergola's boards — and onto the obstacles, so the
   * next feature keeps clear of it.
   */
  private furnishHost(
    host: DesignElement,
    feature: DesiredFeature,
    featureLayer: DesignElement[],
    obstacles: Point[][],
    options: FurnishOptions,
  ): void {
    for (const item of furnishRoom(host, feature, options)) {
      featureLayer.push(item);
      obstacles.push(geometryOutline(item.shape));
    }
  }

  /**
   * The garden room, clipped to the drawn redesign area, or nothing left worth sketching in.
   *
   * `gardenRoom` stays pure and synchronous — the whole layout grammar reads its result and
   * nothing there should have to await — so the clip happens here, at the one call site, and only
   * the largest surviving piece is kept: `localBox`, `roomBehind` and the templates all assume one
   * polygon to measure.
   *
   * `MIN_ROOM_AREA` is re-applied *after* the clip because `clipTo`'s own floor is `MIN_FILL_AREA`,
   * well under it. Returning `[]` is not a failure: it is how the caller already says "there is no
   * room to sketch in", and it falls through to the sampler exactly as a plan with no house does.
   */
  private async scopedRoom(room: Point[], scope: Point[] | null): Promise<Point[]> {
    if (!scope || room.length < 3) return room;

    const clipped = await this.fill.clipTo(room, scope, SCOPE_INSET);
    return clipped && polygonArea(clipped) >= MIN_ROOM_AREA ? clipped : [];
  }

  private pick(
    spec: (typeof FEATURE_SPECS)[keyof typeof FEATURE_SPECS],
    candidates: Point[],
    zone: GardenZone,
    obstacles: Point[][],
    boundary: Point[],
    houseRing: Point[] | null,
    scope: Point[] | null,
    rotation: number,
    rng: () => number,
  ): PlanGeometry | null {
    const legal: PlanGeometry[] = [];

    for (const at of candidates) {
      const geometry = geometryAt(spec, at, rotation);
      const outline = geometryOutline(geometry);

      // Inside the zone it was sampled from, and inside the property as a whole.
      if (!placeable(geometry, houseRing, boundary, scope)) continue;
      if (!withinRing(outline, zone.polygon)) continue;
      if (obstacles.some((obstacle) => polygonsIntersect(outline, obstacle))) continue;

      legal.push(geometry);
      // A couple of dozen is plenty to choose from; the rest is wasted arithmetic.
      if (legal.length >= 12) break;
    }

    if (legal.length === 0) return null;

    /*
     * Candidates arrive in affinity order, so the front of the list is the well-sited half. A
     * seeded pick inside it is what makes the three concepts put the same feature in genuinely
     * different places while none of them puts the barbecue at the bottom of the garden.
     */
    const pool =
      spec.affinity === 'any' ? legal : legal.slice(0, Math.max(1, Math.ceil(legal.length / 2)));

    return pool[Math.floor(rng() * pool.length)] ?? null;
  }
}

/**
 * One piece of a clipped zone, as a zone in its own right.
 *
 * `area` and `centroid` are recomputed rather than carried over, and that matters twice: `area`
 * sums into `designedArea`, which drives `sizeFactor`, so a small redesign area correctly gets
 * smaller features instead of a full-size shed wedged into a corner; and `centroid` is what the
 * placer's affinity measures against.
 *
 * The `id` is kept. Two pieces of the back garden are both the back garden — nothing in `build`
 * keys on the id from this array, so duplicates are safe, and giving one of them a different id
 * would put half a zone's elements in a zone the plan does not have.
 */
function rezone(zone: GardenZone, polygon: Point[]): GardenZone {
  return { ...zone, polygon, area: polygonArea(polygon), centroid: polygonCentroid(polygon) };
}

/** Which zone a ring sits in, by its centroid. Falls back to the first in scope. */
function zoneOf(ring: Point[], zones: GardenZone[]): ZoneId {
  if (zones.length === 0) return 'back';
  return zoneAt(polygonCentroid(ring), zones)?.id ?? zones[0]!.id;
}

/**
 * Gives the concept's beds their edging, where the style asks for one.
 *
 * **Accents and features only, never a base fill**, and that restriction is the whole of the care
 * needed here. A base fill is the *whole zone polygon* — `concepts.ts` is explicit that it stays so
 * even though the booleans are exact — and its outline is therefore the zone's own cross-fences as
 * well as its perimeter. `edgingRuns` drops the sides against the boundary and the house, but not
 * an internal seam between two zones, so edging a base fill would draw a brick course straight
 * across the middle of the garden where the side return meets the back.
 *
 * Beds and aggregate panels only, for the reason each is edged in life: a bed wants a defined edge,
 * and gravel has to be held in by something.
 */
function stampEdging(elements: DesignElement[], constraints: DesignConstraints): DesignElement[] {
  const edging = edgingFor(constraints);
  if (!edging) return elements;

  return elements.map((element) => {
    /* An edging the feature itself asked for is a decision already taken. See `FeatureSpec.edging`. */
    if (element.edging) return element;
    if (element.role === 'fill' && element.fillKind === 'base') return element;
    if (element.category !== 'planting-bed' && element.category !== 'gravel-mulch') return element;
    // A point is a shrub or a tree, not a bed with a perimeter.
    if (element.shape.kind === 'point') return element;

    return { ...element, edging };
  });
}

/** What a generated covered room is floored in: the terrace's own paving, else stone. */
function coveredRoomFloor(terrace: DesignElement | null): MaterialId {
  const paving = terrace?.material as MaterialId | undefined;
  return paving && STRUCTURE_DEFINITIONS.pergola!.floors!.includes(paving) ? paving : 'stone-pavers';
}
