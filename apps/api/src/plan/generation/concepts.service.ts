import { Injectable } from '@nestjs/common';
import {
  computeZones,
  effectiveZoneIds,
  featureOutline,
  geometryIsLegal,
  geometryOutline,
  housePolygon,
  polygonCentroid,
  polygonContainsPolygon,
  polygonsIntersect,
  zoneAt,
  type DesignElement,
  type GardenZone,
  type GeneratedConcept,
  type PlanDocument,
  type PlanGeometry,
  type Point,
  type RequestedFeatureCheck,
  type ZoneId,
} from '@garden-studio/schema';
import {
  ARCHETYPES,
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
import { estimateBudgetBand, featureAttempts, resolveConstraints } from './constraints.js';
import { FillService } from './fill.service.js';
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
    const house = document.site.house;
    const archetype = ARCHETYPES[index % ARCHETYPES.length]!;
    const rng = makeRng(conceptSeed(seed, index));
    const conceptId = `c${seed}-${index}`;

    let counter = 0;
    const nextId = () => {
      counter += 1;
      return `${conceptId}-e${counter}`;
    };

    const boundary = document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    const houseRing = house ? housePolygon(house) : null;
    const rotation = house?.rotation ?? 0;

    /*
     * Zones are recomputed here rather than taken from the client. They are derived state, and
     * `effectiveZoneIds` is applied for the same reason it is on screen: moving the house can
     * dissolve a zone whose tick is still in the document, and designing into one that no longer
     * exists would put a patio in the middle of the house.
     */
    const allZones = computeZones(boundary, house);
    const inScope = effectiveZoneIds(document.site.selectedZoneIds, allZones);
    const zones = rotateZones(
      allZones.filter((zone) => inScope.includes(zone.id)),
      allZones,
      index,
    );

    /*
     * Everything the brief forbids and everything the plot's size implies, resolved once.
     *
     * From here on nothing reads `brief` for a design decision — that is the whole point. The card
     * and the ground cover used to be computed from two different sources, which is how a concept
     * badged "Maintenance: Low" ended up with a lawn in it.
     *
     * The area is the zones actually in scope rather than the whole plot: a user who ticked only
     * the back garden of a large property is designing a suburban-sized space, and scaling the
     * footprints to the acreage they excluded would be answering the wrong question.
     */
    const designedArea = zones.reduce((total, zone) => total + zone.area, 0);
    const constraints = resolveConstraints(brief, archetype, designedArea);

    /*
     * What a new element has to avoid. Kept features are real obstacles; removed and replaced ones
     * are not — freeing that ground is the whole point of having said "remove", and the footprint
     * then goes through remainder-and-fill like any other part of the zone.
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

    /* ---- stage 1: the features the brief asked for ---- */

    const requested = brief.desiredFeatures;
    const attempts = featureAttempts(requested.length, archetype, constraints);
    const checks: RequestedFeatureCheck[] = [];
    let gatheringAnchor: Point | null = null;
    let sqlStep = 0;

    /**
     * One footprint, tried in its preferred zones first and then anywhere else in scope — better a
     * compromise position than an unticked box.
     *
     * Extracted so the repeat pass below places its second helping by exactly the same rules,
     * including the seeded SQL step, rather than by a parallel copy that could drift.
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

    for (const [order, feature] of requested.entries()) {
      const label = featureLabel(feature, brief);

      if (order >= attempts || zones.length === 0) {
        checks.push({ feature, label, included: false });
        continue;
      }

      // Sized for this plot: the manifest quotes a suburban garden, and a courtyard and an estate
      // want the same thing at different sizes rather than the same drawing at different zooms.
      const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
      const placed = await place(spec);

      if (!placed) {
        checks.push({ feature, label, included: false });
        continue;
      }

      const outline = geometryOutline(placed.geometry);
      obstacles.push(outline);
      featureLayer.push({
        id: nextId(),
        category: spec.category,
        role: 'feature',
        name: spec.planName ?? label,
        shape: placed.geometry,
        zone: placed.zone,
        material: materialFor(spec.category, constraints, index),
      });

      if (!gatheringAnchor && (feature === 'seating' || feature === 'pergola')) {
        gatheringAnchor = polygonCentroid(outline);
      }

      checks.push({ feature, label, included: true });
    }

    /*
     * ---- a second helping, where the plot has room for one ----
     *
     * `featureAttempts` can exceed the requested list on a large plot, and that surplus has to
     * become *more garden* rather than nothing. Scaling footprints alone does not fix the observed
     * defect: an estate given the same six things, each a bit bigger, still reads as a suburban
     * design marooned in a field.
     *
     * Only some features repeat sensibly — a second seating area on a big plot is ordinary, a
     * second shed is a mistake — so `REPEATABLE_FEATURES` is a list rather than a rule. Repeats do
     * not go on `checks`, for the same reason trees do not: that list answers "did the brief get
     * what it asked for", and it was asked for once.
     */
    let surplus = attempts - requested.length;

    for (const feature of requested) {
      if (surplus <= 0 || zones.length === 0) break;
      if (!REPEATABLE_FEATURES.includes(feature)) continue;

      const spec = scaledSpec(FEATURE_SPECS[feature], constraints);
      const placed = await place(spec);
      if (!placed) continue;

      obstacles.push(geometryOutline(placed.geometry));
      featureLayer.push({
        id: nextId(),
        category: spec.category,
        role: 'feature',
        name: `Second ${(spec.planName ?? featureLabel(feature, brief)).toLowerCase()}`,
        shape: placed.geometry,
        zone: placed.zone,
        material: materialFor(spec.category, constraints, index + 1),
      });

      surplus -= 1;
    }

    if (gatheringAnchor && houseRing) {
      const path = await this.servicePath(houseRing, gatheringAnchor, obstacles, boundary);
      if (path) {
        const outline = geometryOutline(path);
        obstacles.push(outline);
        featureLayer.push({
          id: nextId(),
          category: 'paved-area',
          role: 'feature',
          name: 'Service path',
          shape: path,
          zone: zoneOf(outline, zones),
          /*
           * Stepping stones rather than the terrace's own paving: a path across a lawn reads as a
           * route where a slab ribbon reads as a second patio, and the pattern renderer draws the
           * grass between the stones for free.
           */
          material: 'stepping-stones',
        });
      }
    }

    /*
     * ---- trees ----
     *
     * Placed here, after the requested features, so they take what is left rather than crowding out
     * something the brief actually asked for. Appended to `featureLayer`, so they land after every
     * fill — the ordering the concept tests assert.
     *
     * Trees do not go on `checks`: that list is length-checked against the brief, and nobody asked
     * for these.
     */
    for (const zone of zones) {
      if (trees.length >= MAX_TREES) break;

      sqlStep += 1;

      const candidates = await this.placement.candidates({
        zone: zone.polygon,
        obstacles,
        /*
         * The canopy's own radius. For a disc this erosion is exact rather than the permissive
         * approximation it is for a long rectangle, so a tree sits as close to the fence as its
         * canopy allows and never overhangs it.
         */
        inradius: TREE_RADIUS,
        houseCentre: house?.centre ?? null,
        affinity: 'far-from-house',
        seed: sqlSeed(conceptSeed(seed, index), sqlStep),
      });

      for (const at of candidates) {
        if (trees.length >= MAX_TREES) break;

        const shape: PlanGeometry = { kind: 'point', at, radius: TREE_RADIUS };
        const outline = geometryOutline(shape);

        // The same three checks `pick` makes, for the same reason: permissive, then verified.
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

        // So the next tree, and every later feature, keeps clear of this one.
        obstacles.push(outline);
      }
    }

    featureLayer.push(...trees);

    /* ---- stage 2: fill, so no chosen zone is left as bare graph paper ---- */

    const palette = fillPalette(constraints, index);

    for (const zone of zones) {
      /*
       * The base layer: exactly the zone polygon. Coverage is therefore guaranteed by the
       * z-order rather than by the accuracy of the subtraction below — which is why true
       * booleans do not let us drop it. The editor moves things, and an exact-remainder base
       * would open a hole the moment it did.
       */
      elements.push({
        id: nextId(),
        category: palette.base,
        role: 'fill',
        fillKind: 'base',
        shape: { kind: 'polygon', points: zone.polygon, cornerRadius: 0 },
        zone: zone.id,
        material: materialFor(palette.base, constraints, index),
      });
    }

    /*
     * ---- the border, between the bases and the accents ----
     *
     * A planted band against the fence. It goes here for two reasons: after the bases so it draws
     * on top of them, and *before* the accents so it can be pushed onto `obstacles` and the accents
     * inset away from it rather than through it. This is the first thing the fill pass has ever
     * added to that array — until now it only read it.
     */
    for (const zone of zones) {
      const bands = await this.fill.borderRegions(boundary, zone.polygon, obstacles, BORDER_WIDTH);

      for (const ring of bands) {
        const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };

        /*
         * Guarded explicitly, unlike every other fill element. Accents are legal by construction —
         * negative buffers of a subset of the zone — but a band grown from the boundary has no such
         * guarantee, and nothing downstream would catch it: `geometryIsLegal` is never applied to
         * fills, so an escaped vertex would generate cleanly and then be refused by the validator
         * that guards its own save.
         */
        if (!geometryIsLegal(shape, houseRing, boundary)) continue;

        elements.push({
          id: nextId(),
          category: 'planting-bed',
          role: 'fill',
          fillKind: 'accent',
          shape,
          zone: zone.id,
          material: materialFor('planting-bed', constraints, index),
        });

        obstacles.push(geometryOutline(shape));
      }
    }

    for (const zone of zones) {
      const regions = await this.fill.accentRegions(zone.polygon, obstacles, archetype.accentCount);

      regions.forEach((ring, order) => {
        const category = palette.accents[order % palette.accents.length]!;

        elements.push({
          id: nextId(),
          category,
          role: 'fill',
          fillKind: 'accent',
          shape: { kind: 'polygon', points: ring, cornerRadius: 0.5 },
          zone: zone.id,
          /*
           * Offset by the accent's own order, so two beds in the same zone are not the same
           * planting. One border and one bed of grasses reads as a design; two identical beds
           * reads as a copy-paste.
           */
          material: materialFor(category, constraints, index + order),
        });
      });
    }

    /* ---- features last, so they sit on top of their own ground cover ---- */

    elements.push(...featureLayer);

    const { name, summary, style } = describeConcept(index, brief);

    return {
      id: conceptId,
      name,
      recommended: archetype.recommended,
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
      elements,
    };
  }

  /**
   * The first candidate that actually holds up, chosen with a seeded roll from the better half.
   *
   * The candidates already come back ordered by affinity and sampled from a region eroded by the
   * footprint's inradius, so most of them fit. They are still checked here with the shared
   * `geometryIsLegal` — the same predicate the canvas and the PostGIS validator use — because a
   * rectangle is not a disc: eroding by the *shortest* half-extent is permissive for a long thin
   * shed, and "permissive, then verified" is the only ordering that cannot generate a concept
   * which fails its own save.
   */
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
  private async servicePath(
    houseRing: Point[],
    target: Point,
    obstacles: Point[][],
    boundary: Point[],
  ): Promise<PlanGeometry | null> {
    const start = await this.placement.closestOnHouse(houseRing, target);
    if (!start) return null;

    // Too short to read as a path.
    if (Math.hypot(start.x - target.x, start.y - target.y) < 1.5) return null;

    const geometry: PlanGeometry = { kind: 'polyline', points: [start, target], width: 1.2 };
    const strip = geometryOutline(geometry);

    /*
     * The strip starts *on* the house wall, so it touches the house by design — which
     * `polygonsIntersect` allows and `geometryClearsHouse` therefore also allows. It still has to
     * stay on the property and clear of everything else.
     */
    if (!withinRing(strip, boundary)) return null;
    if (
      obstacles.some((obstacle) => obstacle !== houseRing && polygonsIntersect(strip, obstacle))
    ) {
      return null;
    }

    return geometry;
  }
}

/**
 * Contained in `outer` — every vertex inside and no edge crossing out, which is the same
 * predicate the house and the PostGIS validator use. Not re-implemented here.
 */
function withinRing(inner: Point[], outer: Point[]): boolean {
  if (outer.length < 3) return true;
  return polygonContainsPolygon(outer, inner);
}

/** Zones in scope, rotated so the three concepts spread things differently. */
function rotateZones(chosen: GardenZone[], all: GardenZone[], index: number): GardenZone[] {
  // No ticks at all is treated as "the whole garden" rather than as "nothing to design".
  const usable = chosen.length > 0 ? chosen : all;
  if (usable.length === 0) return [];

  const offset = index % usable.length;

  return [...usable.slice(offset), ...usable.slice(0, offset)];
}

/** Which zone a ring sits in, by its centroid. Falls back to the first in scope. */
function zoneOf(ring: Point[], zones: GardenZone[]): ZoneId {
  if (zones.length === 0) return 'back';
  return zoneAt(polygonCentroid(ring), zones)?.id ?? zones[0]!.id;
}
