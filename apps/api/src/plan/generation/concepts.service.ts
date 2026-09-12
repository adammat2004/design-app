import { Injectable } from '@nestjs/common';
import {
  computeZones,
  effectiveZoneIds,
  featureOutline,
  gardenDirection,
  gardenDoors,
  gateThresholdDepth,
  gateThresholdRect,
  geometryClearsHouse,
  geometryFitsInside,
  scopeRing,
  geometryIsLegal,
  geometryOutline,
  housePolygon,
  polygonCentroid,
  polygonArea,
  polygonContainsPolygon,
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
  type DesiredFeature,
  type GardenZone,
  type GeneratedConcept,
  type MaterialId,
  type PlanDocument,
  type PlanGeometry,
  type Point,
  type RequestedFeatureCheck,
  type ZoneId,
  estimateBudgetBand,
  distanceToEdge,
  isStructuralRole,
  samplePlanting,
  schemeFor,
  symbolForLayer,
  type GardenBrief,
  type SymbolId,
} from '@garden-studio/schema';
import {
  archetypeFor,
  CONCEPTS_PER_SET,
  FEATURE_SPECS,
  REPEATABLE_FEATURES,
  describeConcept,
  edgingFor,
  featureLabel,
  fillPalette,
  geometryAt,
  inradius,
  materialFor,
  scaledSpec,
  shiftBudget,
  type FeatureSpec,
} from './archetypes.js';
import {
  featureAttempts,
  resolveConstraints,
  styleCornerRadius,
  treeSpeciesFor,
  type DesignConstraints,
} from './constraints.js';
import { FillService } from './fill.service.js';
import { furnishRoom, hostSymbol, type FurnishOptions } from './furnish.js';
import { lightingScheme } from './lighting.js';
import { retainingFor, stepsFromTerrace, terraceRise } from './levels.js';
import { circulationFor, roomSurface, wantsLoungeRoom, type RoutePurpose } from './room-policy.js';
import { assignSlots, slotPreferences } from './layout/assign.js';
import { fitInSlot, type FitContext, type Footprint } from './layout/fit.js';
import {
  backFrame,
  frontFrame,
  gardenRoom,
  localBox,
  sideReturn,
  MIN_ROOM_AREA,
} from './layout/frame.js';
import { FRONT_PATH_WIDTH, frontGarden } from './layout/front.js';
import { rectSize, type LayoutSketch, type SketchRequest } from './layout/sketch.js';
import { recommendedIndex, templateFor, TEMPLATES } from './layout/templates/index.js';
import {
  baseFillFor,
  passageBorderWidth,
  passageStrip,
  passageSurface,
  sideRoomRect,
  usableWidth,
  zoneRoles,
} from './layout/zone-roles.js';
import { PlacementService } from './placement.service.js';
import { conceptSeed, makeRng, sqlSeed } from './rng.js';

/**
 * Design generation.
 *
 * Two stages landing in one `elements` array: the features the brief asked for, then a fill pass
 * so a concept reads as a finished garden rather than a few shapes floating on graph paper.
 *
 * ```
 * PlanDocument + seed + index
 *   ├─ template = index % 3            rectilinear | curved | formal   layout/templates
 *   ├─ archetype                       balanced | entertaining | retreat
 *   ▼
 * [A] zones = computeZones             four half-plane bands round the house
 *     roles = zoneRoles                main | arrival | passage | secondary | remote
 *     constraints = resolveConstraints  the only thing downstream reads the brief through
 *   ▼
 * [B] obstacles: house, kept features, door thresholds 1.8 m, gate thresholds 1.0 m
 *   ▼
 * [C] frame + room                     origin at the garden door, u out, v along the wall
 *   ▼
 * [D] sketch = TEMPLATES[template]     terrace ≥ floor, lawn | courtyard, beds ≥ 1.2 m, slots
 *   ▼
 * [E] terrace  → fitInSlot             refuses below TERRACE_FLOOR rather than shrinking
 * [F] features → assignSlots → fitInSlot
 * [G] whatever is left → PostGIS sampler
 * [H] side rooms, paths, front garden, trees
 *   ▼                                   ── everything below is ground, in z-order ──
 * [I] base fill      one whole-zone polygon per zone, category by role
 * [J] passage strips beside the house and round to the front corner
 * [K] lawn panel     one, over the base
 * [L] designed beds  rear border, side beds, terrace flanks
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
 * How deep the planted band against the fence runs, in metres.
 *
 * Wide enough to clear `MIN_FILL_SIDE` — a narrower band is rejected piece by piece as a sliver and
 * the border never appears at all — and about what a real mixed border is: deep enough to plant in
 * layers, shallow enough to reach the back of.
 */
const BORDER_WIDTH = 1.5;

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

/** A specimen shrub's drawn radius. Between a border plant and a small tree. */
/**
 * A ceiling on the structural plants one concept places.
 *
 * The sampler is a *drawn density* — it will happily return forty backdrop shrubs for a large
 * border, which is the right answer for a texture and the wrong one for a list of objects the user
 * has to scroll. Thirty is roughly where the placed-elements panel stops being readable, and it is
 * far more structure than a garden this size would specify anyway.
 */
const MAX_STRUCTURAL_PLANTS = 30;
const MAX_TREES = 5;

/**
 * The least a room beside the house may be. A pair of chairs and a small table, which is what a
 * side lounge is for — smaller than the terrace's floor, because this is a second sitting place
 * rather than the one the house opens onto.
 */
const SIDE_ROOM_FLOOR = { width: 2.4, depth: 2.4 };

@Injectable()
export class ConceptsService {
  constructor(
    private readonly placement: PlacementService,
    private readonly fill: FillService,
  ) {}

  /** A fresh set of three. */
  generate(document: PlanDocument, seed: number): Promise<GeneratedConcept[]> {
    return Promise.all(
      Array.from({ length: CONCEPTS_PER_SET }, (_, index) => this.build(document, seed, index)),
    );
  }

  /** One slot, rerolled in place. */
  regenerate(document: PlanDocument, seed: number, index: number): Promise<GeneratedConcept> {
    return this.build(document, seed, index);
  }

  private async build(
    document: PlanDocument,
    seed: number,
    index: number,
  ): Promise<GeneratedConcept> {
    const { brief } = document;
    const site = document.site;
    const house = site.house;

    /*
     * Three concepts are three *shapes of plan*, not three rolls of one. The slot decides the
     * template; the brief's style decides which slot is the recommendation; the archetype — the
     * budget and upkeep position — follows the slot so the recommendation always answers the
     * brief as written. See `layout/templates`.
     */
    const recommended = recommendedIndex(brief.style);
    const template = templateFor(index);
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

    for (const feature of document.features.features.filter((f) => f.status === 'keep')) {
      const outline = featureOutline(feature);
      obstacles.push(outline);
      featureLayer.push({
        id: `${conceptId}-keep-${feature.id}`,
        category: 'existing-feature',
        role: 'feature',
        name: feature.name,
        shape: feature.geometry,
        zone: zoneOf(outline, zones),
      });
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
    const attempts = featureAttempts(requested.length, archetype, constraints);
    const checks: RequestedFeatureCheck[] = [];
    /** Features the grammar has answered, one way or the other. */
    const settled = new Set<DesiredFeature>();
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

    const hostFor = (
      feature: DesiredFeature,
      spec: FeatureSpec,
      geometry: PlanGeometry,
      name: string,
      materialIndex: number,
    ): DesignElement => {
      const symbol = hostSymbol(feature);
      return {
        id: nextId(),
        category: spec.category,
        role: 'feature',
        name,
        shape: geometry,
        zone: zoneOf(geometryOutline(geometry), allZones.length > 0 ? allZones : zones),
        material: spec.material ?? materialFor(spec.category, constraints, materialIndex),
        ...(symbol ? { symbol } : {}),
      };
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

    let sketch: LayoutSketch | null = null;
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

    if (grammar && house) {
      const request: SketchRequest = {
        features: requested,
        scale: constraints.scale.sizeFactor,
        style: constraints.style,
        lawnAllowed: !constraints.forbiddenFill.includes('lawn'),
        // Which side of the door the gate is, in the frame's own terms: `v` runs right looking out.
        gateSide: gate ? (grammar.frame.toLocal(gate.centre).v >= 0 ? 'right' : 'left') : null,
        houseWallLength: grammar.frame.wallLength,
        doorWidth: grammar.frame.doorWidth,
      };
      sketch = TEMPLATES[template](request, {
        uMin: Math.max(0, grammar.box.uMin),
        uMax: grammar.box.uMax,
        vMin: grammar.box.vMin,
        vMax: grammar.box.vMax,
        polygon: grammar.box.polygon,
      });

      const fitContext: FitContext = {
        frame: grammar.frame,
        room: grammar.room,
        houseRing,
        boundary,
        obstacles,
      };

      /*
       * The terrace first. It exists in every plan — a garden with nowhere to step out onto is not
       * a garden design — and asking for seating is what furnishes it.
       */
      const terraceSlot = sketch.slots.find((slot) => slot.kind === 'terrace');
      if (sketch.terrace && terraceSlot) {
        const size = rectSize(sketch.terrace);
        const geometry = fitInSlot({ kind: 'rect', ...size }, terraceSlot, {
          ...fitContext,
          ignore: thresholds,
        });

        if (geometry) {
          const wantsSeating = requested.includes('seating');
          terrace = hostFor(
            'seating',
            FEATURE_SPECS.seating,
            geometry,
            wantsSeating ? 'Seating patio' : 'Terrace',
            index,
          );
          obstacles.push(geometryOutline(geometry));
          featureLayer.push(terrace);
          placedBySlot.set(terraceSlot.id, terrace);

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
              const walling = retainingFor(constraints);
              if (walling) terrace.retaining = walling;
              obstacles.push(geometryOutline(flight.shape));
              featureLayer.push(flight);
            }
          }

          if (wantsSeating) {
            this.furnishHost(terrace, 'seating', featureLayer, obstacles, {
              index,
              rng,
              constraints,
              houseRing,
              boundary,
              nextId,
            });
            settled.add('seating');
            checks.push({
              feature: 'seating',
              label: featureLabel('seating', brief),
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

      const { assigned } = assignSlots(
        { ...sketch, slots: sketch.slots.filter((slot) => slot.kind !== 'terrace') },
        requested.filter((feature) => !settled.has(feature)),
      );

      for (const [order, feature] of requested.entries()) {
        if (settled.has(feature)) continue;
        const label = featureLabel(feature, brief);

        if (order >= attempts) {
          checks.push({ feature, label, included: false });
          settled.add(feature);
          continue;
        }

        const entry = assigned.find((candidate) => candidate.feature === feature);
        const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
        const candidates = [
          ...sketch.slots.filter((candidate) => candidate.id === entry?.slotId),
          ...slotPreferences(feature).flatMap((kind) =>
            sketch!.slots.filter((candidate) => candidate.kind === kind),
          ),
        ].filter((candidate) => !placedBySlot.has(candidate.id));
        const fitted = candidates
          .map((slot) => ({ slot, geometry: fitInSlot(footprintOf(spec), slot, fitContext) }))
          .find((candidate) => candidate.geometry !== null);
        if (!fitted?.geometry) continue;
        const { slot, geometry } = fitted;

        const host = hostFor(feature, spec, geometry, spec.planName ?? label, index);
        obstacles.push(geometryOutline(geometry));
        featureLayer.push(host);
        placedBySlot.set(slot.id, host);
        this.furnishHost(host, feature, featureLayer, obstacles, {
          index,
          rng,
          constraints,
          houseRing,
          boundary,
          nextId,
        });

        settled.add(feature);
        checks.push({ feature, label, included: true });
      }
    }

    /* ---- the sampler, for whatever the grammar could not place ---- */

    for (const [order, feature] of requested.entries()) {
      if (settled.has(feature)) continue;
      const label = featureLabel(feature, brief);

      if (order >= attempts || zones.length === 0) {
        checks.push({ feature, label, included: false });
        continue;
      }

      const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
      const placed = await place(spec);

      if (!placed) {
        checks.push({ feature, label, included: false });
        continue;
      }

      const outline = geometryOutline(placed.geometry);
      obstacles.push(outline);
      const host = hostFor(feature, spec, placed.geometry, spec.planName ?? label, index);
      featureLayer.push(host);
      this.furnishHost(host, feature, featureLayer, obstacles, {
        index,
        rng,
        constraints,
        houseRing,
        boundary,
        nextId,
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

    /*
     * ---- a second helping, where the plot has room for one ----
     *
     * `featureAttempts` can exceed the requested list on a large plot, and that surplus has to
     * become *more garden* rather than nothing. Only some features repeat sensibly — a second
     * seating area on a big plot is ordinary, a second shed is a mistake — so `REPEATABLE_FEATURES`
     * is a list rather than a rule. Repeats do not go on `checks`: that list answers "did the brief
     * get what it asked for", and it was asked for once.
     */
    let surplus = attempts - requested.length;

    for (const feature of requested) {
      if (surplus <= 0 || zones.length === 0) break;
      if (!REPEATABLE_FEATURES.includes(feature)) continue;

      const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
      const placed = await place(spec);
      if (!placed) continue;

      obstacles.push(geometryOutline(placed.geometry));
      const host = hostFor(
        feature,
        spec,
        placed.geometry,
        `Second ${(spec.planName ?? featureLabel(feature, brief)).toLowerCase()}`,
        index + 1,
      );
      featureLayer.push(host);
      // The second helping gets the *next* choice, so two patios do not carry the same set.
      this.furnishHost(host, feature, featureLayer, obstacles, {
        index: index + 1,
        rng,
        constraints,
        houseRing,
        boundary,
        nextId,
      });

      surplus -= 1;
    }

    /*
     * ---- the sides: a room where a side is wide enough to be one ----
     *
     * A side return that is only ever base ground and a fence bed is the other half of "grass all
     * round the house". Where there is genuinely room beside the house — after the way past it is
     * taken out — the side gets a room of its own: a lounge deck on a passage's paved strip, a
     * seating room in a secondary side. `sideRoomRect` decides whether there is room; the usual
     * `geometryIsLegal` and obstacle checks decide whether it may go there.
     *
     * Gated on the brief asking for seating and on the budget, because a second sitting room is a
     * thing a garden can want rather than a thing every garden needs — and one per plan, so a plot
     * with two wide sides gets a room and a way past rather than two rooms.
     */
    if (
      house &&
      requested.includes('seating') &&
      constraints.budget !== 'low' &&
      !featureLayer.some((element) => element.name === 'Side lounge')
    ) {
      for (const zone of zones) {
        const role = roles.get(zone.id);
        if (role !== 'passage' && role !== 'secondary') continue;

        const strip =
          role === 'passage'
            ? passageStrip(zone, house)
            : sideReturn(boundary, house, zone.id === 'right' ? 'right' : 'left');
        if (!strip || strip.length < 3 || polygonArea(strip) < 12) continue;

        const rect = sideRoomRect(strip, house, SIDE_ROOM_FLOOR);
        if (!rect) continue;
        const shape: PlanGeometry = { kind: 'rect', ...rect };
        const outline = geometryOutline(shape);
        if (
          !withinRing(outline, strip) ||
          !placeable(shape, houseRing, boundary, scopePolygon) ||
          obstacles.some((obstacle) => polygonsIntersect(outline, obstacle))
        )
          continue;

        const host = hostFor('seating', FEATURE_SPECS.seating, shape, 'Side lounge', index + 1);
        Object.assign(host, roomSurface('lounge', constraints, index));
        featureLayer.push(host);
        obstacles.push(outline);
        this.furnishHost(host, 'seating', featureLayer, obstacles, {
          index: index + 1,
          rng,
          constraints,
          houseRing,
          boundary,
          nextId,
        });
        destinations.push({ outline, name: host.name!, primary: false });
        break;
      }
    }

    /* ---- paths: from the terrace to the rooms, from the gate to the terrace ---- */

    if (
      sketch &&
      grammar &&
      terrace &&
      wantsLoungeRoom(requested, constraints) &&
      !featureLayer.some((element) => element.name === 'Side garden retreat')
    ) {
      const slot = sketch.slots.find(
        (candidate) => candidate.kind === 'far-room' && !placedBySlot.has(candidate.id),
      );
      if (slot) {
        const shape = fitInSlot({ kind: 'rect', width: 3.8, depth: 3.4 }, slot, {
          frame: grammar.frame,
          room: grammar.room,
          houseRing,
          boundary,
          obstacles,
        });
        if (shape?.kind === 'rect' && shape.width >= 3 && shape.depth >= 2.8) {
          const host = {
            ...hostFor('seating', FEATURE_SPECS.seating, shape, 'Garden lounge', index),
            ...roomSurface('lounge', constraints, index),
          };
          featureLayer.push(host);
          obstacles.push(geometryOutline(shape));
          placedBySlot.set(slot.id, host);
          this.furnishHost(host, 'seating', featureLayer, obstacles, {
            index: 0,
            rng,
            constraints,
            houseRing,
            boundary,
            nextId,
          });
        }
      }
    }

    const pathElement = (
      geometry: PlanGeometry,
      name: string,
      material: MaterialId,
      category: DesignElement['category'] = 'paved-area',
    ): DesignElement => ({
      id: nextId(),
      category,
      role: 'feature',
      name,
      shape: geometry,
      zone: zoneOf(geometryOutline(geometry), allZones.length > 0 ? allZones : zones),
      material,
    });

    if (houseRing && sketch && grammar && terrace) {
      const terraceOutline = geometryOutline(terrace.shape);
      // The formal plan's paved line down the middle, over the lawn it divides.
      if (sketch.axisPath) {
        const axis = sketch.axisPath;
        const geometry: PlanGeometry = {
          kind: 'polyline',
          points: [grammar.frame.toWorld(axis.u0, 0), grammar.frame.toWorld(axis.u1, 0)],
          width: axis.v1 - axis.v0,
        };
        const strip = geometryOutline(geometry);
        const ignore = [houseRing, terraceOutline, ...thresholds];
        if (
          withinRing(strip, boundary) &&
          (!scopePolygon || withinRing(strip, scopePolygon)) &&
          !obstacles.some(
            (obstacle) => !isIgnored(obstacle, ignore) && polygonsIntersect(strip, obstacle),
          )
        ) {
          obstacles.push(strip);
          featureLayer.push(
            pathElement(geometry, 'Axis path', materialFor('paved-area', constraints, index)),
          );
        }
      }

      const connected = new Set<string>();

      for (const sketched of sketch.paths) {
        let start: Point;
        let destination: Point[];
        const ignore: Point[][] = [houseRing, terraceOutline, ...thresholds];
        let purpose: RoutePurpose = 'secondary';
        let targetId: string | null = null;

        if ('gate' in sketched.to) {
          if (!gate) continue;
          purpose = 'access';
          start = {
            x: gate.centre.x + gate.inward.x * PATH_STANDOFF,
            y: gate.centre.y + gate.inward.y * PATH_STANDOFF,
          };
          destination = terraceOutline;
        } else {
          const target = [sketched.to.slot, ...(sketched.to.or ?? [])]
            .map((slot) => placedBySlot.get(slot))
            .find((placed) => placed !== undefined);
          if (!target) continue;
          targetId = target.id;
          purpose =
            target.symbol === 'shed' || target.symbol === 'raised-bed' ? 'utility' : 'secondary';
          destination = geometryOutline(target.shape);
          ignore.push(destination);
          start =
            'terrace' in sketched.from
              ? closestPointOnRing(terraceOutline, polygonCentroid(destination), 0)
              : grammar.frame.toWorld(sketched.from.u, sketched.from.v);
        }

        const via = (sketched.via ?? []).map((point) => grammar.frame.toWorld(point.u, point.v));
        const route = circulationFor(purpose, constraints);
        const path = this.routeBetween(
          start,
          destination,
          via,
          obstacles,
          boundary,
          ignore,
          scopePolygon,
          route.width,
        );
        if (!path) continue;

        obstacles.push(geometryOutline(path));
        /*
         * Stepping stones rather than the terrace's own paving: a path across a lawn reads as a
         * route where a slab ribbon reads as a second patio, and the pattern renderer draws the
         * grass between the stones for free.
         */
        featureLayer.push(pathElement(path, sketched.name, route.material, route.category));
        if (targetId) connected.add(targetId);
      }

      // Every fitted room gets an access attempt, including destinations placed by the fallback.
      // Starting on several terrace edges avoids a table or an intervening room blocking all access.
      const rooms = featureLayer.filter(
        (element) =>
          element.role === 'feature' &&
          element.id !== terrace.id &&
          element.category !== 'furniture' &&
          element.category !== 'existing-feature' &&
          element.shape.kind !== 'polyline',
      );
      for (const target of rooms) {
        if (connected.has(target.id)) continue;
        const destination = geometryOutline(target.shape);
        const purpose =
          target.symbol === 'shed' || target.symbol === 'raised-bed' ? 'utility' : 'secondary';
        const route = circulationFor(purpose, constraints);
        const starts = [
          closestPointOnRing(terraceOutline, polygonCentroid(destination), 0),
          ...terraceOutline.flatMap((a, i) => {
            const b = terraceOutline[(i + 1) % terraceOutline.length]!;
            return [0.25, 0.5, 0.75].map((t) => ({
              x: a.x + (b.x - a.x) * t,
              y: a.y + (b.y - a.y) * t,
            }));
          }),
        ];
        const ignore = [terraceOutline, destination, ...thresholds];
        const path = starts
          .map((start) =>
            this.routeBetween(
              start,
              destination,
              [],
              obstacles,
              boundary,
              ignore,
              scopePolygon,
              route.width,
            ),
          )
          .find((candidate) => candidate !== null);
        if (!path) continue;
        obstacles.push(geometryOutline(path));
        featureLayer.push(
          pathElement(
            path,
            `Path to ${(target.name ?? 'garden room').toLowerCase()}`,
            route.material,
            route.category,
          ),
        );
      }
    }

    if (houseRing) {
      for (const destination of destinations) {
        const path = await this.routeTo(
          houseRing,
          destination.outline,
          obstacles,
          boundary,
          scopePolygon,
        );
        if (!path) continue;

        obstacles.push(geometryOutline(path));
        featureLayer.push(
          pathElement(
            path,
            destination.primary ? 'Service path' : `Path to ${destination.name.toLowerCase()}`,
            'stepping-stones',
          ),
        );
      }
    }

    /* ---- the front garden: a path to the street, beds by the wall, a hedge along the fence ---- */

    const frontFills: DesignElement[] = [];
    if (house && houseRing && front && frontZone && scope.includes(frontZone.id)) {
      const frontSketch = frontGarden(
        front,
        localBox(frontRoom, front),
        streetEdge(site),
        front.doorWidth,
      );

      if (front && frontSketch) {
        const points = frontSketch.path.map((point) => front.toWorld(point.u, point.v));
        const geometry: PlanGeometry = { kind: 'polyline', points, width: FRONT_PATH_WIDTH };
        const strip = geometryOutline(geometry);
        const ignore = [houseRing, ...thresholds];
        if (
          strip.length >= 3 &&
          withinRing(strip, boundary) &&
          (!scopePolygon || withinRing(strip, scopePolygon)) &&
          !obstacles.some(
            (obstacle) => !isIgnored(obstacle, ignore) && polygonsIntersect(strip, obstacle),
          )
        ) {
          obstacles.push(strip);
          // Paved, not stepping stones: the front path is walked with shopping and in the rain.
          featureLayer.push(
            // Setts, like every other route: a front path walked with shopping, not a small patio.
            pathElement(geometry, 'Front path', 'stone-setts'),
          );
        }

        const localRect = (rect: {
          u0: number;
          u1: number;
          v0: number;
          v1: number;
        }): PlanGeometry => ({
          kind: 'rect',
          centre: front.toWorld((rect.u0 + rect.u1) / 2, (rect.v0 + rect.v1) / 2),
          width: rect.v1 - rect.v0,
          depth: rect.u1 - rect.u0,
          rotation: front.wallBearing,
        });

        for (const bed of frontSketch.beds) {
          const shape = localRect(bed);
          if (!placeable(shape, houseRing, boundary, scopePolygon)) continue;
          if (
            obstacles.some(
              (obstacle) =>
                obstacle !== houseRing && polygonsIntersect(geometryOutline(shape), obstacle),
            )
          )
            continue;
          frontFills.push({
            id: nextId(),
            category: 'planting-bed',
            role: 'fill',
            fillKind: 'accent',
            shape,
            zone: frontZone.id,
            material: materialFor('planting-bed', constraints, index),
          });
        }

        for (const hedge of frontSketch.hedges) {
          const shape = localRect(hedge);
          if (!placeable(shape, houseRing, boundary, scopePolygon)) continue;
          if (
            obstacles.some(
              (obstacle) =>
                obstacle !== houseRing && polygonsIntersect(geometryOutline(shape), obstacle),
            )
          )
            continue;
          frontFills.push({
            id: nextId(),
            category: 'planting-bed',
            role: 'fill',
            fillKind: 'accent',
            shape,
            zone: frontZone.id,
            material: 'hedging',
          });
        }

        if (frontSketch.tree && trees.length < MAX_TREES) {
          const at = front.toWorld(frontSketch.tree.u, frontSketch.tree.v);
          const shape: PlanGeometry = { kind: 'point', at, radius: TREE_RADIUS };
          const outline = geometryOutline(shape);
          if (
            placeable(shape, houseRing, boundary, scopePolygon) &&
            !obstacles.some((obstacle) => polygonsIntersect(outline, obstacle))
          ) {
            trees.push({
              id: nextId(),
              category: 'planting-bed',
              role: 'feature',
              name: 'Tree',
              shape,
              zone: frontZone.id,
              material: materialFor('planting-bed', constraints, index),
            });
            obstacles.push(outline);
          }
        }
      }
    }

    /*
     * ---- trees ----
     *
     * Framing trees at the sketch's points first — the far corners, the mid-sides — then the
     * sampler if the plot has room for more. Appended to `featureLayer`, so they land after
     * every fill. Trees do not go on `checks`: nobody asked for these.
     */
    if (sketch && grammar) {
      for (const point of sketch.trees) {
        if (trees.length >= MAX_TREES) break;
        // The sketched point, then a little way along each axis of the frame: a tree a metre
        // from where it was drawn is the same design, where a tree the sampler put in the side
        // return is not.
        let placed: { shape: PlanGeometry; outline: Point[] } | null = null;
        for (const [du, dv] of TREE_NUDGES) {
          const at = grammar.frame.toWorld(point.u + du, point.v + dv);
          const shape: PlanGeometry = { kind: 'point', at, radius: TREE_RADIUS };
          const outline = geometryOutline(shape);
          if (!placeable(shape, houseRing, boundary, scopePolygon)) continue;
          if (!withinRing(outline, grammar.room)) continue;
          if (obstacles.some((obstacle) => polygonsIntersect(outline, obstacle))) continue;
          placed = { shape, outline };
          break;
        }
        if (!placed) continue;
        const { shape, outline } = placed;

        trees.push({
          id: nextId(),
          category: 'planting-bed',
          role: 'feature',
          name: 'Tree',
          shape,
          zone: zoneOf(outline, allZones),
          material: materialFor('planting-bed', constraints, index),
        });
        obstacles.push(outline);
      }
    }

    if (trees.length < 2) {
      for (const zone of zones) {
        if (trees.length >= MAX_TREES) break;

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
          if (trees.length >= MAX_TREES) break;

          const shape: PlanGeometry = { kind: 'point', at, radius: TREE_RADIUS };
          const outline = geometryOutline(shape);

          if (!placeable(shape, houseRing, boundary, scopePolygon)) continue;
          if (obstacles.some((obstacle) => polygonsIntersect(outline, obstacle))) continue;

          trees.push({
            id: nextId(),
            category: 'planting-bed',
            role: 'feature',
            name: 'Tree',
            shape,
            zone: zone.id,
            material: materialFor('planting-bed', constraints, index),
          });
          obstacles.push(outline);
        }
      }
    }

    featureLayer.push(...trees);

    /* ---- stage 2: fill, so no chosen zone is left as bare graph paper ---- */

    const palette = fillPalette(constraints, index);

    const frontExtent = {
      depth: front && frontRoom.length >= 3 ? localBox(frontRoom, front).uMax : null,
      area: frontRoom.length >= 3 ? polygonArea(frontRoom) : 0,
    };

    for (const zone of zones) {
      /*
       * The base layer: exactly the zone polygon. Coverage is guaranteed by the z-order rather
       * than by the accuracy of any subtraction, which is why true booleans do not let us drop it.
       * It is the palette's ground cover, never planting — `baseFillFor` says why — and the only
       * zone whose base the role may change is the front, whose polygon is exactly the front garden.
       */
      const { category, material } = baseFillFor(
        roles.get(zone.id) ?? 'remote',
        palette,
        constraints,
        index,
        frontExtent,
      );
      elements.push({
        id: nextId(),
        category,
        role: 'fill',
        fillKind: 'base',
        shape: { kind: 'polygon', points: zone.polygon, cornerRadius: 0 },
        zone: zone.id,
        material,
      });
    }

    /*
     * ---- the passages: a hard strip beside the house and round to the front corner ----
     *
     * Laid before the borders, so a passage's fence bed sits on the strip and the side path runs
     * over it. The corners behind the house are not in the strip; they are the room's, and the
     * lawn and the beds design them.
     */
    if (house) {
      for (const zone of zones) {
        if (roles.get(zone.id) !== 'passage') continue;
        const strip = passageStrip(zone, house);
        if (!strip) continue;
        /*
         * Not checked against the house, for the same reason the base fill under it is not: this
         * is ground derived from the zone, and a zone's inner edge *is* the house's wall plane.
         * `computeZones` clips there in floating point, so a strip can overlap the wall by a
         * fraction of a nanometre — which had `geometryClearsHouse` reject one side return and
         * accept the other on the same symmetrical plot. The house is painted opaquely and last
         * in every renderer, so ground beneath its wall line is never seen.
         */
        const shape: PlanGeometry = { kind: 'polygon', points: strip, cornerRadius: 0 };
        elements.push({
          id: nextId(),
          ...passageSurface(constraints),
          role: 'fill',
          fillKind: 'accent',
          name: 'Side return',
          shape,
          zone: zone.id,
        });
      }
    }

    /* ---- the lawn panel ---- */

    if (sketch?.lawn && grammar) {
      let points: Point[] | null =
        sketch.lawn.kind === 'rect'
          ? [
              grammar.frame.toWorld(sketch.lawn.rect.u0, sketch.lawn.rect.v0),
              grammar.frame.toWorld(sketch.lawn.rect.u1, sketch.lawn.rect.v0),
              grammar.frame.toWorld(sketch.lawn.rect.u1, sketch.lawn.rect.v1),
              grammar.frame.toWorld(sketch.lawn.rect.u0, sketch.lawn.rect.v1),
            ]
          : sketch.lawn.points.map((point) => grammar.frame.toWorld(point.u, point.v));
      let cornerRadius =
        sketch.lawn.kind === 'rect'
          ? Math.max(sketch.lawn.cornerRadius, styleCornerRadius(constraints.style))
          : sketch.lawn.styleCorners
            ? styleCornerRadius(constraints.style)
            : 0;

      const proposed: PlanGeometry = { kind: 'polygon', points, cornerRadius };
      if (
        !placeable(proposed, houseRing, boundary, scopePolygon) ||
        !withinRing(geometryOutline(proposed), grammar.room)
      ) {
        // An L-plot or an odd room: the lawn follows the room instead of the sketch.
        points = await this.fill.clipTo(geometryOutline(proposed), grammar.room, 0.1);
        cornerRadius = 0;
      }

      if (points && points.length >= 3) {
        lawn = {
          id: nextId(),
          category: sketch.lawnCategory,
          role: 'fill',
          fillKind: 'accent',
          shape: { kind: 'polygon', points, cornerRadius },
          zone: roomZone?.id ?? 'back',
          material: materialFor(sketch.lawnCategory, constraints, index),
        };
      }
    }

    // Fit each designed bed into the garden and clear the places people use.
    const designed: DesignElement[] = [];
    if (sketch && grammar) {
      for (const bed of sketch.beds) {
        const local = bed.shape;
        const points =
          local.kind === 'polygon'
            ? local.points
            : [
                { u: local.rect.u0, v: local.rect.v0 },
                { u: local.rect.u1, v: local.rect.v0 },
                { u: local.rect.u1, v: local.rect.v1 },
                { u: local.rect.u0, v: local.rect.v1 },
              ];
        const world = points.map((p) => grammar.frame.toWorld(p.u, p.v));
        const clipped = await this.fill.clipTo(world, grammar.room, 0);
        if (!clipped) continue;
        const pieces = await this.fill.remainderPieces({
          zone: clipped,
          rooms: [
            ...designed.map((bed) => geometryOutline(bed.shape)),
            ...featureLayer
              .filter((e) => e.category !== 'planting-bed' && e.category !== 'furniture')
              .map((e) => geometryOutline(e.shape)),
          ],
          cuts: [],
          limit: 6,
        });
        for (const ring of pieces) {
          const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
          if (!placeable(shape, houseRing, boundary, scopePolygon)) continue;
          designed.push({
            id: nextId(),
            name: bed.name,
            category: 'planting-bed',
            role: 'fill',
            fillKind: 'accent',
            shape,
            zone: roomZone?.id ?? 'back',
            material: materialFor('planting-bed', constraints, index),
            plantingStyle: constraints.plantingStyle,
          });
        }
      }
      // A bay changes the actual lawn outline, so the drawing and its measured area agree.
      if (
        lawn &&
        designed.some((bed) =>
          polygonsIntersect(geometryOutline(lawn!.shape), geometryOutline(bed.shape)),
        )
      ) {
        const patches = await this.fill.remainderPieces({
          zone: geometryOutline(lawn.shape),
          rooms: designed.map((e) => geometryOutline(e.shape)),
          cuts: [],
          limit: 12,
        });
        const original = lawn;
        lawn = null;
        for (const ring of patches) {
          const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
          if (!placeable(shape, houseRing, boundary, scopePolygon)) continue;
          const patch: DesignElement = { ...original, id: lawn ? nextId() : original.id, shape };
          if (lawn) elements.push(patch);
          else lawn = patch;
        }
      }
    }

    /* ---- the borders: everything round the rooms, in runs, laid under the lawn ---- */

    if (grammar) {
      const rooms: Point[][] = designed.map((e) => geometryOutline(e.shape));
      if (lawn) rooms.push(geometryOutline(lawn.shape));
      for (const element of featureLayer) {
        if (element.category === 'furniture' || element.category === 'existing-feature') continue;
        rooms.push(geometryOutline(element.shape));
      }
      for (const element of frontFills) rooms.push(geometryOutline(element.shape));

      /*
       * Fence borders in every zone but two, by role — see `layout/zone-roles.ts`.
       *
       * The *main* zone gets none here: its planting is `designedBeds` — the rear border, the
       * side beds and the flanks, composed with the lawn rather than left over from it. (This
       * loop used to ask `borderRegions` for a 0.45 m band there, which the sliver guard rejected
       * on every plan; the call was dead and is gone.) The *front* gets none either: `front.ts`
       * lays its own beds and hedge.
       *
       * A *passage* gets a bed along its fence only as deep as leaves a way past the house, and
       * none at all when even the thinnest survivable bed would block it — a side return is a way
       * past first. A *secondary* side or a *remote* zone gets the full border, as before.
       */
      for (const zone of zones) {
        if (zone.id === frontZone?.id || zone.id === roomZone?.id) continue;

        const role = roles.get(zone.id) ?? 'remote';
        /*
         * Measured on the *unclipped* zone. How much room there is to walk past the house is a
         * physical fact about the plot, not about what the user ticked — a 4 m side return whose
         * redesign area covers 2 m of it still has to reserve the access lane, and measuring the
         * clipped piece would conclude the side was too narrow to plant at all.
         */
        const full = zoneById.get(zone.id) ?? zone;
        const usable = role === 'passage' && house ? usableWidth(full, house) : null;
        const width =
          role === 'passage' && usable !== null
            ? passageBorderWidth(usable, BORDER_WIDTH)
            : BORDER_WIDTH;
        if (width <= 0) continue;

        const pieces = await this.fill.borderRegions(boundary, zone.polygon, rooms, width);

        pieces.forEach((ring, order) => {
          const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
          if (!placeable(shape, houseRing, boundary, scopePolygon)) return;

          elements.push({
            id: nextId(),
            category: 'planting-bed',
            role: 'fill',
            fillKind: 'accent',
            shape,
            zone: zone.id,
            /*
             * A different planting per piece: the drifts. A border of one species round the whole
             * garden reads as a hedge; shrubs, then grasses, then a mixed border reads as planted.
             */
            material: materialFor('planting-bed', constraints, index + order),
          });
        });
      }
    } else {
      /*
       * No room to sketch in — no house, or the back garden out of scope — so the fill is the
       * old pass: a border band against the fence, then the largest remainders as accent beds.
       */
      for (const zone of zones) {
        const bands = await this.fill.borderRegions(
          boundary,
          zone.polygon,
          obstacles,
          BORDER_WIDTH,
        );

        bands.forEach((ring, order) => {
          const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
          if (!placeable(shape, houseRing, boundary, scopePolygon)) return;

          elements.push({
            id: nextId(),
            category: 'planting-bed',
            role: 'fill',
            fillKind: 'accent',
            shape,
            zone: zone.id,
            material: materialFor('planting-bed', constraints, index + order),
          });

          obstacles.push(geometryOutline(shape));
        });
      }

      for (const zone of zones) {
        const regions = await this.fill.accentRegions(
          zone.polygon,
          obstacles,
          archetype.accentCount,
        );

        regions.forEach((ring, order) => {
          const category = palette.accents[order % palette.accents.length]!;

          elements.push({
            id: nextId(),
            category,
            role: 'fill',
            fillKind: 'accent',
            shape: {
              kind: 'polygon',
              points: ring,
              cornerRadius: styleCornerRadius(constraints.style),
            },
            zone: zone.id,
            material: materialFor(category, constraints, index + order),
          });
        });
      }
    }

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
    const specimens: DesignElement[] = [];
    const plantedBeds = elements.filter(
      (element) =>
        element.role === 'fill' &&
        element.fillKind === 'accent' &&
        element.category === 'planting-bed' &&
        element.shape.kind === 'polygon' &&
        element.material !== 'hedging',
    );

    for (const bed of plantedBeds) {
      if (bed.shape.kind !== 'polygon') continue;

      const outline = geometryOutline(bed.shape);
      const scheme = schemeFor(constraints.plantingStyle, bed.material);

      for (const layer of scheme.layers) {
        if (!isStructuralRole(layer.role)) continue;

        for (const placement of samplePlanting(outline, layer, bed.id)) {
          if (specimens.length >= MAX_STRUCTURAL_PLANTS) break;

          // The plant's own variant picks its species, so a backdrop is a few kinds and not one.
          const symbol = symbolForLayer(layer, placement.variant) as SymbolId;
          const spec = SYMBOLS[symbol];
          const radius = spec.footprint.kind === 'point' ? spec.footprint.radius : 0.6;

          /*
           * Eroded by the plant's own radius, which the sampler does not do: it places a *point*
           * inside the outline, and a 0.6 m shrub centred a hand's breadth from the edge hangs over
           * onto the lawn. The old PostGIS path got this free by buffering the zone inward before
           * sampling; here it is an explicit test, and it has to be — the bed is what owns the
           * plant, and a shrub half on the grass belongs to neither.
           */
          if (distanceToEdge(placement.at, outline) < radius) continue;

          const shape: PlanGeometry = { kind: 'point', at: placement.at, radius };
          const ring = geometryOutline(shape);

          /*
           * The same legality every placed thing goes through, and the same obstacle set — a bed is
           * laid *under* the features standing in it, so "inside this bed" does not mean "clear of
           * everything" and a shrub could otherwise be planted through the shed.
           */
          if (!placeable(shape, houseRing, boundary, scopePolygon)) continue;
          if (obstacles.some((obstacle) => polygonsIntersect(ring, obstacle))) continue;

          obstacles.push(ring);

          specimens.push({
            id: nextId(),
            category: 'planting-bed',
            role: 'feature',
            name: spec.label,
            shape,
            zone: bed.zone,
            material: 'shrubs',
            bedId: bed.id,
            symbol,
            height: spec.height,
          });
        }
      }
    }

    // Sparse structural layers can miss a narrow border. Give each empty bed one deliberate
    // evergreen anchor, choosing the greatest clearance from its edge rather than a random point.
    for (const bed of plantedBeds) {
      if (specimens.length >= MAX_STRUCTURAL_PLANTS) break;
      if (specimens.some((plant) => plant.bedId === bed.id)) continue;
      const outline = geometryOutline(bed.shape);
      const symbol: SymbolId = 'shrub-evergreen';
      const spec = SYMBOLS[symbol];
      const radius = spec.footprint.kind === 'point' ? spec.footprint.radius : 0.6;
      const candidates = await this.placement.candidates({
        zone: outline,
        obstacles,
        inradius: radius,
        houseCentre: house?.centre ?? null,
        affinity: 'any',
        seed: sqlSeed(conceptSeed(seed, index), ++sqlStep),
      });
      const anchors = [...candidates].sort(
        (a, b) => distanceToEdge(b, outline) - distanceToEdge(a, outline),
      );
      for (const at of anchors) {
        const shape: PlanGeometry = { kind: 'point', at, radius };
        const ring = geometryOutline(shape);
        if (
          !polygonContainsPolygon(outline, ring) ||
          !placeable(shape, houseRing, boundary, scopePolygon) ||
          obstacles.some((obstacle) => polygonsIntersect(ring, obstacle))
        )
          continue;
        specimens.push({
          id: nextId(),
          category: 'planting-bed',
          role: 'feature',
          name: spec.label,
          shape,
          zone: bed.zone,
          material: 'shrubs',
          bedId: bed.id,
          symbol,
          height: spec.height,
        });
        obstacles.push(ring);
        break;
      }
    }

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
      this.stampPlanting(elements, constraints, brief.style),
      constraints,
    );
    const lights = lightingScheme(stamped, {
      constraints,
      index,
      boundary,
      scope: scopePolygon,
      nextId,
    });

    const { name, summary, style } = describeConcept(template, brief);

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
      estimatedBudget: estimateBudgetBand([...stamped, ...lights]),
      requestedFeaturesIncluded: checks,
      elements: [...stamped, ...lights],
    };
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
  ): DesignElement[] {
    let tree = 0;

    return elements.map((element) => {
      if (element.category !== 'planting-bed') return element;

      const isTree = element.shape.kind === 'point' && element.symbol === undefined;
      const symbol = isTree ? treeSpeciesFor(style, tree++) : element.symbol;

      return {
        ...element,
        plantingStyle: constraints.plantingStyle,
        symbol,
        ...(isTree && symbol === 'tree-ornamental'
          ? { plantId: 'acer-palmatum-red', name: 'Japanese maple', height: 3 }
          : {}),
      };
    });
  }

  /**
   * A path from `start` to the edge of `destination`, straight or by way of `via`, else dog-legged.
   *
   * Ends at the point on the destination's outline nearest the last waypoint, pulled back a
   * standoff so the strip touches the feature rather than entering it — the reason paths exist
   * at all (see CLAUDE.md). Refuses anything under a stride and a half, which is too short to
   * read as a path. Ignores the rings in `ignore`: the house it leaves, the terrace it starts on,
   * the feature it arrives at, and the doorways it is allowed to cross.
   *
   * The redesign area is checked on the *strip*, not on the endpoints, and that is the whole point
   * of doing it here: both ends can sit comfortably inside the drawn area while the dog-leg between
   * them swings out through a corner that is not. Because the routes are tried in order, refusing
   * one L lets the other be found — this improves the routing rather than only refusing it.
   */
  private routeBetween(
    start: Point,
    destination: Point[],
    via: Point[],
    obstacles: Point[][],
    boundary: Point[],
    ignore: Point[][],
    scope: Point[] | null,
    width = PATH_WIDTH,
  ): PlanGeometry | null {
    const aimFrom = via[via.length - 1] ?? start;
    const end = closestPointOnRing(destination, aimFrom, PATH_STANDOFF);

    if (Math.hypot(start.x - end.x, start.y - end.y) < 1.5) return null;

    const routes: Point[][] = [];
    if (via.length > 0) routes.push([start, ...via, end]);
    routes.push(
      [start, end],
      [start, { x: start.x, y: end.y }, end],
      [start, { x: end.x, y: start.y }, end],
    );

    for (const points of routes) {
      const distinct = points.filter(
        (point, i) =>
          i === 0 || Math.hypot(point.x - points[i - 1]!.x, point.y - points[i - 1]!.y) > 0.01,
      );
      const geometry: PlanGeometry = { kind: 'polyline', points: distinct, width };
      const strip = geometryOutline(geometry);
      if (strip.length < 3) continue;
      if (!withinRing(strip, boundary)) continue;
      if (scope && !withinRing(strip, scope)) continue;
      if (
        obstacles.some(
          (obstacle) => !isIgnored(obstacle, ignore) && polygonsIntersect(strip, obstacle),
        )
      ) {
        continue;
      }
      return geometry;
    }

    return null;
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

  /**
   * A path from the house out to the main gathering element, the way the mockup's "Service path"
   * runs. Skipped rather than forced when it would cut through something — a generator that draws
   * a path over the pergola looks like a fault, not like a draft.
   */
  /**
   * A path from the house to a feature: straight if it can be, else one of the two L-shaped
   * routes round whatever is in the way.
   *
   * It ends at the feature's *edge* — the point on its outline nearest the house, pulled back a
   * hair — rather than at its centroid. The first version ran to the centroid, so the strip
   * always entered the patio it was going to, the patio was always in `obstacles`, and the path
   * was refused on every plan that ever asked for one. A route is checked against everything on
   * the plan except the house it starts on and the feature it arrives at.
   */
  private async routeTo(
    houseRing: Point[],
    destination: Point[],
    obstacles: Point[][],
    boundary: Point[],
    scope: Point[] | null,
  ): Promise<PlanGeometry | null> {
    const aim = polygonCentroid(destination);
    const start = await this.placement.closestOnHouse(houseRing, aim);
    if (!start) return null;

    return this.routeBetween(
      start,
      destination,
      [],
      obstacles,
      boundary,
      [houseRing, destination],
      scope,
    );
  }
}

const PATH_WIDTH = 1.2;

/** Offsets tried for a sketched tree, in frame metres: where it was drawn, then nearby. */
const TREE_NUDGES: [number, number][] = [
  [0, 0],
  [-0.6, 0],
  [0.6, 0],
  [0, -0.6],
  [0, 0.6],
  [-1.2, 0],
  [1.2, 0],
  [0, -1.2],
  [0, 1.2],
  [-1.2, -1.2],
  [1.2, 1.2],
];

/**
 * Ignored rings are matched by value, not by reference. `geometryOutline` tessellates afresh on
 * every call, so the terrace outline a path is told to ignore is never the same array as the one
 * pushed onto `obstacles` — and matched by reference, every path was refused for crossing the
 * terrace it started on. That was the whole of "no plan ever has a path".
 */
function isIgnored(ring: Point[], ignore: Point[][]): boolean {
  return ignore.some((candidate) => sameRing(candidate, ring));
}

/**
 * The generator's own placement rule: legal to save, clear of the house, **and** inside the
 * redesign area the user drew.
 *
 * `geometryIsLegal` is containment alone, because a user may attach a patio to the back wall.
 * The generator may not: it composes a whole garden at once, and a terrace or a border laid
 * across the footprint would be drawn over by the house and read as ground the design lost. So
 * the house rule lives here, at the generator's edge, rather than in the shared predicate.
 *
 * The redesign area is here for exactly the same reason. It is a rule about what the *generator*
 * may compose, not about what is legal — a user may drag a bed outside their own drawn area
 * afterwards and the editor has to let them. `scope` is `null` when no area was drawn, and the
 * check is then skipped rather than widened to the plot: widening it would re-tessellate the
 * boundary and move coordinates on every plan that never asked for a scope.
 */
function placeable(
  geometry: PlanGeometry,
  houseRing: Point[] | null,
  boundary: Point[],
  scope: Point[] | null,
): boolean {
  return (
    geometryIsLegal(geometry, boundary) &&
    geometryClearsHouse(geometry, houseRing) &&
    (scope === null || geometryFitsInside(geometry, scope))
  );
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

function sameRing(a: Point[], b: Point[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (point, i) => Math.abs(point.x - b[i]!.x) < 1e-9 && Math.abs(point.y - b[i]!.y) < 1e-9,
  );
}

/** How far short of a feature's edge a path stops, so the strip touches rather than enters it. */
const PATH_STANDOFF = 0.05;

/** The point on `ring`'s outline nearest `from`, pulled `standoff` back towards `from`. */
function closestPointOnRing(ring: Point[], from: Point, standoff: number): Point {
  let best: Point = ring[0]!;
  let bestDistance = Infinity;

  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((from.x - a.x) * dx + (from.y - a.y) * dy) / length2));
    const candidate = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(candidate.x - from.x, candidate.y - from.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (bestDistance === 0) return best;
  const back = standoff / bestDistance;
  return { x: best.x + (from.x - best.x) * back, y: best.y + (from.y - best.y) * back };
}

/**
 * Contained in `outer` — every vertex inside and no edge crossing out, which is the same
 * predicate the house and the PostGIS validator use. Not re-implemented here.
 */
function withinRing(inner: Point[], outer: Point[]): boolean {
  if (outer.length < 3) return true;
  return polygonContainsPolygon(outer, inner);
}

/** A spec's footprint, as the fitter wants it. */
function footprintOf(spec: FeatureSpec): Footprint {
  return spec.footprint.kind === 'point'
    ? { kind: 'point', radius: spec.footprint.radius }
    : { kind: 'rect', width: spec.footprint.width, depth: spec.footprint.depth };
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
    if (element.role === 'fill' && element.fillKind === 'base') return element;
    if (element.category !== 'planting-bed' && element.category !== 'gravel-mulch') return element;
    // A point is a shrub or a tree, not a bed with a perimeter.
    if (element.shape.kind === 'point') return element;

    return { ...element, edging };
  });
}
