import { Injectable } from '@nestjs/common';
import {
  canTake,
  cheaperAlternative,
  computeZones,
  defaultMaterial,
  describeElement,
  effectiveZoneIds,
  elementAnchor,
  elementArea,
  findMaterial,
  formatArea,
  geometryIsLegal,
  geometryOutline,
  housePolygon,
  isLocked,
  materialLabel,
  polygonsIntersect,
  translateGeometry,
  type DesignElement,
  type DesignIntent,
  type GardenZone,
  type PlanDocument,
  type PlanGeometry,
  type Point,
  type ProposedChange,
  type Unit,
} from '@garden-studio/schema';
import { PlacementService } from '../generation/placement.service.js';

/**
 * Intent to geometry.
 *
 * Everything here is deterministic. That is the point of the split: because `DesignIntent` is plain
 * data, the half of the assistant that actually decides where things go can be tested exhaustively
 * with no model involved — feed it intents, assert the changes.
 *
 * Two rules run through all of it:
 *
 *  - **Nothing illegal is proposed.** Every produced element goes through the shared
 *    `geometryIsLegal`, the same predicate the canvas and the PostGIS validator use. The editor
 *    store re-checks on apply, so there are now two courtesies and one guarantee.
 *  - **The planner writes the facts, the model writes the prose.** Every `before`/`after` string is
 *    measured off geometry, and every "could not" reason is written here. The model is never in a
 *    position to claim an outcome.
 */

/** Fractions of the remaining distance a move will try, largest first. */
const MOVE_LADDER = [1 / 3, 1 / 4, 1 / 6, 1 / 10];

/** Smallest side a resize will produce, matching the editor's own handles. */
const MIN_SIDE = 0.3;

export interface PlannedChanges {
  changes: ProposedChange[];
  unplaceable: { description: string; reason: string }[];
}

interface Context {
  document: PlanDocument;
  unit: Unit;
  boundary: Point[];
  house: Point[] | null;
  houseCentre: Point | null;
  zones: GardenZone[];
  inScope: GardenZone[];
}

@Injectable()
export class PlannerService {
  constructor(private readonly placement: PlacementService) {}

  async plan(document: PlanDocument, intents: DesignIntent[]): Promise<PlannedChanges> {
    const context = buildContext(document);
    const changes: ProposedChange[] = [];
    const unplaceable: PlannedChanges['unplaceable'] = [];

    let counter = 0;
    const nextId = () => {
      counter += 1;
      return `ch${counter}`;
    };

    for (const intent of intents) {
      const produced = await this.one(intent, context, nextId);

      changes.push(...produced.changes);
      unplaceable.push(...produced.unplaceable);
    }

    return { changes, unplaceable };
  }

  private async one(
    intent: DesignIntent,
    context: Context,
    nextId: () => string,
  ): Promise<PlannedChanges> {
    switch (intent.kind) {
      case 'resize':
        return this.resize(intent, context, nextId);
      case 'move':
        return this.move(intent, context, nextId);
      case 'material':
        return this.material(intent, context, nextId);
      case 'recategorise':
        return this.recategorise(intent, context, nextId);
      case 'remove':
        return this.remove(intent, context, nextId);
      case 'reduce-cost':
        return this.reduceCost(intent, context, nextId);
      case 'add':
        return this.add(intent, context, nextId);
    }
  }

  /* ---------------------------------------------------------------- resize */

  private resize(
    intent: Extract<DesignIntent, { kind: 'resize' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      if (isLocked(element)) {
        result.unplaceable.push({
          description: `Resize ${label(element)}`,
          reason: 'It is the ground cover for a whole area, so its outline is fixed.',
        });
        continue;
      }

      /*
       * Binary-search the factor back towards 1 when the full one does not fit, and report the size
       * actually achieved. "As big as it will go" is what the user meant; refusing outright because
       * their number was ambitious is not.
       */
      const achieved = largestLegalFactor(element, intent.factor, context);

      if (achieved === null) {
        result.unplaceable.push({
          description: `Resize ${label(element)}`,
          reason:
            intent.factor > 1
              ? 'There is no room around it to grow into.'
              : 'It cannot get any smaller without disappearing.',
        });
        continue;
      }

      const next = scaled(element, achieved);
      result.changes.push(change(nextId(), 'resize', element, next, context));
    }

    return result;
  }

  /* ---------------------------------------------------------------- move */

  private async move(
    intent: Extract<DesignIntent, { kind: 'move' }>,
    context: Context,
    nextId: () => string,
  ): Promise<PlannedChanges> {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      if (isLocked(element)) {
        result.unplaceable.push({
          description: `Move ${label(element)}`,
          reason: 'It is the ground cover for a whole area, so it stays where it is.',
        });
        continue;
      }

      const anchor = elementAnchor(element);
      const towards = await this.moveTargetPoint(intent, element, anchor, context);

      if (!towards) {
        result.unplaceable.push({
          description: `Move ${label(element)}`,
          reason: 'There is nothing to move it towards.',
        });
        continue;
      }

      const direction = intent.away
        ? { x: anchor.x - towards.x, y: anchor.y - towards.y }
        : { x: towards.x - anchor.x, y: towards.y - anchor.y };

      const moved = firstLegalStep(element, direction, context);

      if (!moved) {
        result.unplaceable.push({
          description: `Move ${label(element)}`,
          reason: 'It is already as far that way as it will go.',
        });
        continue;
      }

      result.changes.push(change(nextId(), 'move', element, moved, context));
    }

    return result;
  }

  /** What "towards" means, resolved to a point. */
  private async moveTargetPoint(
    intent: Extract<DesignIntent, { kind: 'move' }>,
    element: DesignElement,
    anchor: Point,
    context: Context,
  ): Promise<Point | null> {
    if (intent.towards === 'house') return context.houseCentre;

    if (intent.towards === 'zone') {
      const zone = context.zones.find((candidate) => candidate.id === intent.zone);
      return zone?.centroid ?? null;
    }

    // 'boundary' — the nearest point on the fence, which is a one-call PostGIS question rather
    // than a walk over every edge.
    void element;
    return this.placement.closestOnHouse(context.boundary, anchor);
  }

  /* ---------------------------------------------------------------- material and category */

  private material(
    intent: Extract<DesignIntent, { kind: 'material' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      if (!canTake(element.category, intent.materialId)) {
        result.unplaceable.push({
          description: `Use ${materialLabel(intent.materialId)} for ${label(element)}`,
          reason: `That is not a ${categoryWord(element)} material.`,
        });
        continue;
      }

      if (element.material === intent.materialId) continue;

      const next: DesignElement = { ...element, material: intent.materialId };

      /*
       * No legality check, and deliberately so: changing what a surface is made of cannot move it.
       * This matches the editor, whose own material setter skips the geometry check.
       */
      result.changes.push({
        id: nextId(),
        kind: 'material',
        elementId: element.id,
        label: label(element),
        before: materialLabel(element.material ?? defaultMaterial(element.category)),
        after: materialLabel(intent.materialId),
        next,
        previous: element,
      });
    }

    return result;
  }

  private recategorise(
    intent: Extract<DesignIntent, { kind: 'recategorise' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      if (element.category === intent.category) continue;

      // The old material almost certainly does not belong to the new category, so it resets.
      const next: DesignElement = {
        ...element,
        category: intent.category,
        material: defaultMaterial(intent.category),
      };

      result.changes.push({
        id: nextId(),
        kind: 'material',
        elementId: element.id,
        label: label(element),
        before: categoryWord(element),
        after: intent.category.replace('-', ' '),
        next,
        previous: element,
      });
    }

    return result;
  }

  /* ---------------------------------------------------------------- remove */

  private remove(
    intent: Extract<DesignIntent, { kind: 'remove' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      if (isLocked(element)) {
        result.unplaceable.push({
          description: `Remove ${label(element)}`,
          reason:
            'It is the ground cover for a whole area — removing it would leave bare ground. Change what it is made of instead.',
        });
        continue;
      }

      result.changes.push({
        id: nextId(),
        kind: 'remove',
        elementId: element.id,
        label: label(element),
        before:
          describeElement(element, context.unit) ?? formatArea(elementArea(element), context.unit),
        after: 'Removed',
        // `next` is the element unchanged: the store reads `kind` to know it is a deletion, and
        // carrying the element means an undo has something to put back.
        next: element,
        previous: element,
      });
    }

    return result;
  }

  /* ---------------------------------------------------------------- reduce cost */

  private reduceCost(
    intent: Extract<DesignIntent, { kind: 'reduce-cost' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    /*
     * Biggest saving first: area times how far the price drops. Swapping the material on a 40 m²
     * terrace is worth more than swapping it on a stepping stone, and the user asked for a cheaper
     * garden rather than a cheaper list of things.
     */
    const candidates = context.document.layout.elements
      .filter((element) => !element.hidden)
      .map((element) => {
        const current =
          findMaterial(element.material) ?? findMaterial(defaultMaterial(element.category));
        const cheaper = cheaperAlternative(element);
        const saving =
          current && cheaper ? elementArea(element) * (current.cost - cheaper.cost) : 0;

        return { element, cheaper, saving };
      })
      .filter((candidate) => candidate.cheaper !== null && candidate.saving > 0)
      .sort((a, b) => b.saving - a.saving)
      .slice(0, intent.maxChanges);

    if (candidates.length === 0) {
      result.unplaceable.push({
        description: 'Reduce the cost',
        reason: 'Everything on the plan is already the cheapest option in its category.',
      });
      return result;
    }

    for (const { element, cheaper } of candidates) {
      result.changes.push({
        id: nextId(),
        kind: 'material',
        elementId: element.id,
        label: label(element),
        before: materialLabel(element.material ?? defaultMaterial(element.category)),
        after: materialLabel(cheaper!.id),
        next: { ...element, material: cheaper!.id },
        previous: element,
      });
    }

    return result;
  }

  /* ---------------------------------------------------------------- add */

  private async add(
    intent: Extract<DesignIntent, { kind: 'add' }>,
    context: Context,
    nextId: () => string,
  ): Promise<PlannedChanges> {
    const result: PlannedChanges = { changes: [], unplaceable: [] };
    const size = footprintSize(intent.footprint);

    const zones = intent.zone
      ? context.inScope.filter((zone) => zone.id === intent.zone)
      : context.inScope;

    if (zones.length === 0) {
      result.unplaceable.push({
        description: `Add ${intent.name}`,
        reason: intent.zone
          ? `The ${intent.zone} garden is not one of the areas being designed.`
          : 'No garden areas have been chosen to design yet.',
      });
      return result;
    }

    // Everything already on the plan is an obstacle, plus the house.
    const obstacles = context.document.layout.elements
      .filter((element) => !element.hidden && !isLocked(element))
      .map((element) => geometryOutline(element.shape));
    if (context.house) obstacles.push(context.house);

    for (const zone of zones) {
      const candidates = await this.placement.candidates({
        zone: zone.polygon,
        obstacles,
        inradius: size.inradius,
        houseCentre: context.houseCentre,
        affinity: intent.affinity === 'along-boundary' ? 'any' : intent.affinity,
        // Fixed rather than rolled: the same request twice should propose the same thing, or a user
        // who asks again because they misread the diff gets a different garden.
        seed: 7,
      });

      const at = candidates.find((point) =>
        geometryIsLegal(geometryFor(intent.footprint, point), context.house, context.boundary),
      );

      if (!at) continue;

      const shape = geometryFor(intent.footprint, at);
      const next: DesignElement = {
        id: `ai-${nextId()}`,
        category: intent.category,
        role: 'feature',
        name: intent.name,
        shape,
        zone: zone.id,
        material: defaultMaterial(intent.category),
      };

      result.changes.push({
        id: nextId(),
        kind: 'add',
        elementId: null,
        label: intent.name,
        before: 'Not on the plan',
        after: describeElement(next, context.unit) ?? formatArea(elementArea(next), context.unit),
        next,
        previous: null,
      });

      return result;
    }

    result.unplaceable.push({
      description: `Add ${intent.name}`,
      reason: `There is no clear ${describeFootprint(intent.footprint, context.unit)} space left${
        intent.zone ? ` in the ${intent.zone} garden` : ''
      }.`,
    });

    return result;
  }
}

/* ---------------------------------------------------------------- helpers */

function buildContext(document: PlanDocument): Context {
  const boundary = document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  const zones = computeZones(boundary, document.site.house);
  const inScopeIds = effectiveZoneIds(document.site.selectedZoneIds, zones);

  return {
    document,
    unit: document.unit,
    boundary,
    house: document.site.house ? housePolygon(document.site.house) : null,
    houseCentre: document.site.house?.centre ?? null,
    zones,
    inScope: zones.filter((zone) => inScopeIds.includes(zone.id)),
  };
}

/** Ids the model named, kept only where they name something real. */
function resolve(ids: string[], context: Context): DesignElement[] {
  const byId = new Map(context.document.layout.elements.map((element) => [element.id, element]));

  return ids.map((id) => byId.get(id)).filter((element): element is DesignElement => !!element);
}

function label(element: DesignElement): string {
  return element.name ?? categoryWord(element);
}

function categoryWord(element: DesignElement): string {
  return element.category.replace('-', ' ');
}

function change(
  id: string,
  kind: 'resize' | 'move',
  element: DesignElement,
  next: DesignElement,
  context: Context,
): ProposedChange {
  return {
    id,
    kind,
    elementId: element.id,
    label: label(element),
    before:
      describeElement(element, context.unit) ?? formatArea(elementArea(element), context.unit),
    after: describeElement(next, context.unit) ?? formatArea(elementArea(next), context.unit),
    next,
    previous: element,
  };
}

/** Scales a shape about its own anchor. Polygons and lines scale point by point. */
function scaled(element: DesignElement, factor: number): DesignElement {
  const shape = element.shape;
  const anchor = elementAnchor(element);

  const grow = (point: Point): Point => ({
    x: anchor.x + (point.x - anchor.x) * factor,
    y: anchor.y + (point.y - anchor.y) * factor,
  });

  let next: PlanGeometry;
  switch (shape.kind) {
    case 'point':
      next = { ...shape, radius: Math.max(MIN_SIDE, shape.radius * factor) };
      break;
    case 'rect':
      next = {
        ...shape,
        width: Math.max(MIN_SIDE, shape.width * factor),
        depth: Math.max(MIN_SIDE, shape.depth * factor),
      };
      break;
    case 'polygon':
      next = { ...shape, points: shape.points.map(grow) };
      break;
    case 'polyline':
      next = { ...shape, width: Math.max(MIN_SIDE, shape.width * factor) };
      break;
  }

  return { ...element, shape: next };
}

/**
 * The largest factor between 1 and the requested one that still fits, or null when even 1 does not.
 *
 * Binary search, the same trick `clampHouseInside` uses for a dragged house: it needs no
 * special-casing for the shape of the boundary or of what is in the way.
 */
function largestLegalFactor(
  element: DesignElement,
  requested: number,
  context: Context,
): number | null {
  const legal = (factor: number) =>
    geometryIsLegal(scaled(element, factor).shape, context.house, context.boundary) &&
    clearOfOthers(scaled(element, factor), element, context);

  if (legal(requested)) return requested;
  if (!legal(1)) return null;

  let low = 1;
  let high = requested;

  for (let i = 0; i < 12; i += 1) {
    const mid = (low + high) / 2;
    if (legal(mid)) low = mid;
    else high = mid;
  }

  // A change of less than a percent is not worth showing the user as a line in a diff.
  return Math.abs(low - 1) < 0.01 ? null : low;
}

/** The furthest step along `direction` that still fits, trying the ladder largest first. */
function firstLegalStep(
  element: DesignElement,
  direction: Point,
  context: Context,
): DesignElement | null {
  const length = Math.hypot(direction.x, direction.y);
  if (length < 1e-6) return null;

  for (const fraction of MOVE_LADDER) {
    const dx = direction.x * fraction;
    const dy = direction.y * fraction;
    const moved: DesignElement = { ...element, shape: translateGeometry(element.shape, dx, dy) };

    if (
      geometryIsLegal(moved.shape, context.house, context.boundary) &&
      clearOfOthers(moved, element, context)
    ) {
      return moved;
    }
  }

  return null;
}

/** Nothing else on the plan is in the way. Base fills are ground, so they do not count. */
function clearOfOthers(
  candidate: DesignElement,
  original: DesignElement,
  context: Context,
): boolean {
  const outline = geometryOutline(candidate.shape);

  return context.document.layout.elements.every((other) => {
    if (other.id === original.id || other.hidden || isLocked(other)) return true;
    if (other.role === 'fill') return true;

    return !polygonsIntersect(outline, geometryOutline(other.shape));
  });
}

function footprintSize(footprint: Extract<DesignIntent, { kind: 'add' }>['footprint']): {
  inradius: number;
} {
  switch (footprint.kind) {
    case 'point':
      return { inradius: footprint.radius };
    case 'rect':
      return { inradius: Math.min(footprint.width, footprint.depth) / 2 };
    case 'strip':
      return { inradius: footprint.width / 2 };
  }
}

function geometryFor(
  footprint: Extract<DesignIntent, { kind: 'add' }>['footprint'],
  at: Point,
): PlanGeometry {
  switch (footprint.kind) {
    case 'point':
      return { kind: 'point', at, radius: footprint.radius };
    case 'rect':
      return {
        kind: 'rect',
        centre: at,
        width: footprint.width,
        depth: footprint.depth,
        rotation: 0,
      };
    case 'strip':
      return {
        kind: 'polyline',
        width: footprint.width,
        points: [
          { x: at.x - 1.5, y: at.y },
          { x: at.x + 1.5, y: at.y },
        ],
      };
  }
}

function describeFootprint(
  footprint: Extract<DesignIntent, { kind: 'add' }>['footprint'],
  unit: Unit,
): string {
  const round = (value: number) => value.toFixed(1);

  switch (footprint.kind) {
    case 'rect':
      return `${round(footprint.width)} × ${round(footprint.depth)} ${unit}`;
    case 'point':
      return `${round(footprint.radius * 2)} ${unit} wide`;
    case 'strip':
      return `${round(footprint.width)} ${unit} wide`;
  }
}
