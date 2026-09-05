import { Injectable } from '@nestjs/common';
import {
  computeZones,
  effectiveZoneIds,
  featureOutline,
  gardenDirection,
  gardenDoors,
  GATE_THRESHOLD_DEPTH,
  gateThresholdRect,
  geometryIsLegal,
  geometryOutline,
  housePolygon,
  polygonCentroid,
  polygonContainsPolygon,
  polygonsIntersect,
  resolvedGates,
  streetDirection,
  streetEdge,
  SYMBOLS,
  THRESHOLD_DEPTH,
  thresholdRect,
  zoneAt,
  type DesignElement,
  type DesiredFeature,
  type ElementCategory,
  type GardenZone,
  type GeneratedConcept,
  type MaterialId,
  type PlanDocument,
  type PlanGeometry,
  type Point,
  type RequestedFeatureCheck,
  type ZoneId,
  estimateBudgetBand,
  type GardenBrief,
} from '@garden-studio/schema';
import {
  archetypeFor,
  CONCEPTS_PER_SET,
  FEATURE_SPECS,
  REPEATABLE_FEATURES,
  describeConcept,
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
import { furnish, hostSymbol, type FurnishOptions } from './furnish.js';
import { assignSlots } from './layout/assign.js';
import { fitInSlot, type FitContext, type Footprint } from './layout/fit.js';
import { backFrame, frontFrame, gardenRoom, localBox } from './layout/frame.js';
import { FRONT_PATH_WIDTH, frontGarden } from './layout/front.js';
import { rectSize, type LayoutSketch, type SketchRequest } from './layout/sketch.js';
import { recommendedIndex, templateFor, TEMPLATES } from './layout/templates/index.js';
import { PlacementService } from './placement.service.js';
import { conceptSeed, makeRng, sqlSeed } from './rng.js';

/**
 * Design generation.
 *
 * Two stages landing in one `elements` array: the features the brief asked for, then a fill pass
 * so a concept reads as a finished garden rather than a few shapes floating on graph paper.
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
 * How many trees a concept will try to place, and how big their canopies are.
 *
 * A radius, not a diameter, because that is what `inradius` wants: for a disc the placer's erosion
 * is exact, so a tree can be pushed as close to the fence as its own canopy allows and no closer.
 */
const TREE_RADIUS = 1.6;

/** A specimen shrub's drawn radius. Between a border plant and a small tree. */
const SPECIMEN_RADIUS = 0.75;
const MAX_TREES = 5;

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
    const zones = allZones.filter((zone) => scope.includes(zone.id));

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
    const gates = resolvedGates(site);
    for (const entry of gates) {
      const rect = gateThresholdRect(site, entry.gate, GATE_THRESHOLD_DEPTH);
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
    const room = frame && house ? gardenRoom(boundary, house, frame, scope) : [];
    // The grammar needs the room to be somewhere the user asked to have designed.
    const roomZone = room.length >= 3 ? zoneAt(polygonCentroid(room), allZones) : null;
    const grammar =
      frame && house && room.length >= 3 && roomZone && scope.includes(roomZone.id)
        ? { frame, room, box: localBox(room, frame) }
        : null;

    let sketch: LayoutSketch | null = null;
    let terrace: DesignElement | null = null;
    let lawn: DesignElement | null = null;
    const gate = gates[0] ?? null;

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
        const slot = entry
          ? sketch.slots.find((candidate) => candidate.id === entry.slotId)
          : undefined;
        if (!slot) continue;

        const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
        const geometry = fitInSlot(footprintOf(spec), slot, fitContext);
        if (!geometry) continue;

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

    /* ---- paths: from the terrace to the rooms, from the gate to the terrace ---- */

    const pathElement = (
      geometry: PlanGeometry,
      name: string,
      material: MaterialId,
    ): DesignElement => ({
      id: nextId(),
      category: 'paved-area',
      role: 'feature',
      name,
      shape: geometry,
      zone: zoneOf(geometryOutline(geometry), allZones.length > 0 ? allZones : zones),
      material,
    });

    if (houseRing && sketch && grammar && terrace) {
      const terraceOutline = geometryOutline(terrace.shape);

      for (const sketched of sketch.paths) {
        let start: Point;
        let destination: Point[];
        const ignore: Point[][] = [houseRing, terraceOutline, ...thresholds];

        if ('gate' in sketched.to) {
          if (!gate) continue;
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
          destination = geometryOutline(target.shape);
          ignore.push(destination);
          start =
            'terrace' in sketched.from
              ? closestPointOnRing(terraceOutline, polygonCentroid(destination), 0)
              : grammar.frame.toWorld(sketched.from.u, sketched.from.v);
        }

        const via = (sketched.via ?? []).map((point) => grammar.frame.toWorld(point.u, point.v));
        const path = this.routeBetween(start, destination, via, obstacles, boundary, ignore);
        if (!path) continue;

        obstacles.push(geometryOutline(path));
        /*
         * Stepping stones rather than the terrace's own paving: a path across a lawn reads as a
         * route where a slab ribbon reads as a second patio, and the pattern renderer draws the
         * grass between the stones for free.
         */
        featureLayer.push(pathElement(path, sketched.name, 'stepping-stones'));
      }

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
    }

    if (houseRing) {
      for (const destination of destinations) {
        const path = await this.routeTo(houseRing, destination.outline, obstacles, boundary);
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
    const street = streetDirection(site);
    const front = house && street ? frontFrame(house, street) : null;
    const frontRoom = front && house ? gardenRoom(boundary, house, front, scope) : [];
    const frontZone = frontRoom.length >= 3 ? zoneAt(polygonCentroid(frontRoom), allZones) : null;
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
          !obstacles.some(
            (obstacle) => !isIgnored(obstacle, ignore) && polygonsIntersect(strip, obstacle),
          )
        ) {
          obstacles.push(strip);
          // Paved, not stepping stones: the front path is walked with shopping and in the rain.
          featureLayer.push(
            pathElement(geometry, 'Front path', materialFor('paved-area', constraints, index)),
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
          if (!geometryIsLegal(shape, houseRing, boundary)) continue;
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
          if (!geometryIsLegal(shape, houseRing, boundary)) continue;
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
            geometryIsLegal(shape, houseRing, boundary) &&
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
          if (!geometryIsLegal(shape, houseRing, boundary)) continue;
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

          if (!geometryIsLegal(shape, houseRing, boundary)) continue;
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

    for (const zone of zones) {
      /*
       * The base layer: exactly the zone polygon. Coverage is guaranteed by the z-order rather
       * than by the accuracy of any subtraction, which is why true booleans do not let us drop it.
       *
       * Where the grammar has laid the garden out, the base is *planting*: the lawn is a shaped
       * panel on top of it and everything round the panel is border, so the matrix underneath is
       * soil and plants. Elsewhere it is the palette's ground cover as before.
       */
      const category: ElementCategory =
        grammar && zone.id !== frontZone?.id ? 'planting-bed' : palette.base;
      elements.push({
        id: nextId(),
        category,
        role: 'fill',
        fillKind: 'base',
        shape: { kind: 'polygon', points: zone.polygon, cornerRadius: 0 },
        zone: zone.id,
        material: materialFor(category, constraints, index),
      });
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
        !geometryIsLegal(proposed, houseRing, boundary) ||
        !withinRing(geometryOutline(proposed), grammar.room)
      ) {
        // An L-plot or an odd room: the lawn follows the room instead of the sketch.
        points = await this.fill.clipToRoom(geometryOutline(proposed), grammar.room, 0.1);
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

    /* ---- the borders: everything round the rooms, in runs, laid under the lawn ---- */

    if (grammar) {
      const rooms: Point[][] = [];
      if (lawn) rooms.push(geometryOutline(lawn.shape));
      for (const element of featureLayer) {
        if (element.category === 'furniture' || element.category === 'existing-feature') continue;
        rooms.push(geometryOutline(element.shape));
      }
      for (const element of frontFills) rooms.push(geometryOutline(element.shape));

      /*
       * Two cut lines, through the lawn's centre along and across the axis. Four runs of border
       * — one per side of the lawn — is what gives the planting its drifts, and two lines keep
       * the query fast: every extra line multiplies the pieces `ST_Split` has to make. A feature
       * standing wholly inside a run leaves a hole in it, which `exteriorRing` flattens; that is
       * harmless here because the pieces go into the layer *under* the lawn and the features.
       */
      const cuts: [Point, Point][] = [];
      const centre = polygonCentroid(
        lawn ? geometryOutline(lawn.shape) : terrace ? geometryOutline(terrace.shape) : boundary,
      );
      cuts.push([
        centre,
        { x: centre.x + grammar.frame.axis.x, y: centre.y + grammar.frame.axis.y },
      ]);
      cuts.push([
        centre,
        { x: centre.x + grammar.frame.cross.x, y: centre.y + grammar.frame.cross.y },
      ]);

      for (const zone of zones) {
        if (zone.id === frontZone?.id) continue;

        const pieces = await this.fill.remainderPieces({
          zone: zone.polygon,
          rooms,
          cuts,
          limit: 6 + archetype.accentCount * 4,
        });

        pieces.forEach((ring, order) => {
          const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
          if (!geometryIsLegal(shape, houseRing, boundary)) return;

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
          if (!geometryIsLegal(shape, houseRing, boundary)) return;

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

    if (lawn) elements.push(lawn);
    elements.push(...frontFills);

    /*
     * ---- specimen shrubs ----
     *
     * A few larger plants standing in the beds, so a border reads as planted with intent rather
     * than filled. They are points inside an accent bed, and `candidates` with no obstacles and the
     * shrub's own radius is exactly "somewhere fully inside this bed".
     */
    const specimens: DesignElement[] = [];
    const specimenBeds = elements.filter(
      (element) =>
        element.role === 'fill' &&
        element.fillKind === 'accent' &&
        element.category === 'planting-bed' &&
        element.shape.kind === 'polygon' &&
        element.material !== 'hedging',
    );
    const specimenTarget = specimenBeds.length === 0 ? 0 : 2 + Math.floor(rng() * 3);

    for (const bed of specimenBeds) {
      if (specimens.length >= specimenTarget) break;
      if (bed.shape.kind !== 'polygon') continue;

      sqlStep += 1;
      /*
       * Obstacles are passed, unlike before: a border run is laid *under* the features standing
       * in it, so "inside this bed" no longer means "clear of everything" and a shrub could
       * otherwise be planted through the shed.
       */
      const candidates = await this.placement.candidates({
        zone: geometryOutline(bed.shape),
        obstacles,
        inradius: SPECIMEN_RADIUS,
        houseCentre: house?.centre ?? null,
        affinity: 'any',
        seed: sqlSeed(conceptSeed(seed, index), sqlStep),
        sampleCount: 8,
      });

      const at = candidates.find((point) => {
        const shape: PlanGeometry = { kind: 'point', at: point, radius: SPECIMEN_RADIUS };
        const outline = geometryOutline(shape);
        return (
          geometryIsLegal(shape, houseRing, boundary) &&
          !obstacles.some((obstacle) => polygonsIntersect(outline, obstacle))
        );
      });
      if (!at) continue;

      const shape: PlanGeometry = { kind: 'point', at, radius: SPECIMEN_RADIUS };
      obstacles.push(geometryOutline(shape));

      specimens.push({
        id: nextId(),
        category: 'planting-bed',
        role: 'feature',
        name: 'Specimen shrub',
        shape,
        zone: bed.zone,
        material: 'shrubs',
        symbol: 'specimen',
        height: SYMBOLS.specimen.height,
      });
    }

    featureLayer.push(...specimens);

    /* ---- features last, so they sit on top of their own ground cover ---- */

    elements.push(...featureLayer);

    const { name, summary, style } = describeConcept(template, brief);

    return {
      id: conceptId,
      name,
      recommended: index === recommended,
      summary,
      style,
      budget: shiftBudget(constraints.budget, archetype.budgetShift),
      /*
       * The badge reads the same value the palette did. This line and `fillPalette` used to be the
       * two sources that disagreed — the badge came from the archetype, the ground cover from the
       * brief — which is how a concept could say "Low" over a lawn.
       */
      maintenance: constraints.maintenance,
      /** What the materials actually came to, as opposed to the position above. */
      estimatedBudget: estimateBudgetBand(elements),
      requestedFeaturesIncluded: checks,
      /*
       * Every bed stamped with the concept's planting style, in one pass rather than at each of the
       * eight places a bed is created.
       *
       * Total by construction, which is the point: a ninth site that forgot would silently produce
       * beds that fall back to the default scheme, and a bed planted differently from its
       * neighbours for no reason is exactly the kind of fault nobody reports because it just looks
       * like the generator being arbitrary.
       */
      elements: this.stampPlanting(elements, constraints, brief.style),
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

      return { ...element, plantingStyle: constraints.plantingStyle, symbol };
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
   */
  private routeBetween(
    start: Point,
    destination: Point[],
    via: Point[],
    obstacles: Point[][],
    boundary: Point[],
    ignore: Point[][],
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
      const geometry: PlanGeometry = { kind: 'polyline', points, width: PATH_WIDTH };
      const strip = geometryOutline(geometry);
      if (strip.length < 3) continue;
      if (!withinRing(strip, boundary)) continue;
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
    const item = furnish(host, feature, options);
    if (!item) return;

    featureLayer.push(item);
    obstacles.push(geometryOutline(item.shape));
  }

  private pick(
    spec: (typeof FEATURE_SPECS)[keyof typeof FEATURE_SPECS],
    candidates: Point[],
    zone: GardenZone,
    obstacles: Point[][],
    boundary: Point[],
    houseRing: Point[] | null,
    rotation: number,
    rng: () => number,
  ): PlanGeometry | null {
    const legal: PlanGeometry[] = [];

    for (const at of candidates) {
      const geometry = geometryAt(spec, at, rotation);
      const outline = geometryOutline(geometry);

      // Inside the zone it was sampled from, and inside the property as a whole.
      if (!geometryIsLegal(geometry, houseRing, boundary)) continue;
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
  ): Promise<PlanGeometry | null> {
    const aim = polygonCentroid(destination);
    const start = await this.placement.closestOnHouse(houseRing, aim);
    if (!start) return null;

    return this.routeBetween(start, destination, [], obstacles, boundary, [houseRing, destination]);
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
