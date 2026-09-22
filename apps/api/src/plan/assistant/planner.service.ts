import { Injectable } from '@nestjs/common';
import {
  canTake,
  cheaperAlternative,
  computeZones,
  defaultMaterial,
  describeElement,
  distanceToSegment,
  effectiveZoneIds,
  elementAnchor,
  elementArea,
  findMaterial,
  formatArea,
  geometryClearsHouse,
  elementIsLegal,
  geometryIsLegal,
  geometryOutline,
  housePolygon,
  isLocked,
  materialLabel,
  pointInPolygon,
  polygonArea,
  polygonContainsPolygon,
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
import {
  bearingOfElement,
  nearestEdgeBearing,
  offBearing,
  squareTo,
} from '../generation/design/bearing.js';
import {
  PATH_STANDOFF,
  routeCandidates,
  terraceStarts,
  type RouteCandidate,
} from '../generation/design/circulation.js';
import { FillService } from '../generation/fill.service.js';
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
 *    `elementIsLegal`, the same predicate the canvas and the PostGIS validator use — and it is
 *    asked about the element rather than its shape, so a tree is judged on the ground its trunk
 *    occupies and not on how far its branches reach. The editor
 *    store re-checks on apply, so there are now two courtesies and one guarantee. The house is
 *    not part of that rule — a patio may be attached to the wall — but a newly *added* element
 *    is still sampled clear of the building; see the `add` branch.
 *  - **The planner writes the facts, the model writes the prose.** Every `before`/`after` string is
 *    measured off geometry, and every "could not" reason is written here. The model is never in a
 *    position to claim an outcome.
 */

/** Fractions of the remaining distance a move will try, largest first. */
const MOVE_LADDER = [1 / 3, 1 / 4, 1 / 6, 1 / 10];

/** Smallest side a resize will produce, matching the editor's own handles. */
const MIN_SIDE = 0.3;

/**
 * Area under which a reshape is taken to have cost a neighbour nothing.
 *
 * A hundredth of a square metre, which is the same threshold the generator's own containment test
 * uses. It absorbs what `ST_SimplifyPreserveTopology` shaves off a ring it did not otherwise touch,
 * so a bed that merely came *near* the lawn does not produce a line of the diff saying the lawn
 * changed by a millimetre.
 */
const TOOK_NOTHING = 0.01;

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
  /**
   * Elements as the intents so far in this request will leave them.
   *
   * Every other branch reads the stored document, which is right: they each decide one thing and
   * the editor applies the lot. `attach` is the exception and cannot be anything else — "take the
   * furniture with it" is a statement about a move that has already been decided in the same
   * sentence, so it has to see where the host went. Keyed by id, and empty for a request whose
   * intents do not touch each other.
   */
  pending: Map<string, DesignElement>;
}

@Injectable()
export class PlannerService {
  constructor(
    private readonly placement: PlacementService,
    /** For `reshape`: the strip a deepened bed takes has to come off whatever it took it from. */
    private readonly fill: FillService,
  ) {}

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

      /* So a later `attach` can see where the move it belongs to actually put things. */
      for (const produce of produced.changes) {
        if (produce.elementId) context.pending.set(produce.elementId, produce.next);
      }
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
      case 'reshape':
        return this.reshape(intent, context, nextId);
      case 'attach':
        return this.attach(intent, context, nextId);
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
      case 'reroute':
        return this.reroute(intent, context, nextId);
      case 'rotate':
        return this.rotate(intent, context, nextId);
    }
  }

  /* ---------------------------------------------------------------- reroute */

  /**
   * Redraw a path so that it does something better than it does now.
   *
   * **The router is the generator's own.** `routeCandidates` enumerates every legal line between the
   * path's ends — straight, then the two L-shapes, from each of thirteen starting points along the
   * host it leaves — and this picks among them by the stated objective. That is the whole reason a
   * rerouted path is a path the generator could have drawn: it comes out of the same enumeration, is
   * checked against the same boundary and the same obstacles, and no coordinate in it was written
   * by anything that read the user's sentence.
   *
   * The ends are recovered from the polyline rather than restated. A path's own endpoints are its
   * own geometry, not a position anybody supplied — and where an end sits on something, that thing
   * becomes the ring the route starts from or stops short of, so a redrawn path still leaves the
   * terrace and still arrives at the shed.
   */
  private reroute(
    intent: Extract<DesignIntent, { kind: 'reroute' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      const shape = element.shape;
      if (shape.kind !== 'polyline' || shape.points.length < 2) {
        result.unplaceable.push({
          description: `Redraw ${label(element)}`,
          reason: 'It is not a path, so there is no route to redraw.',
        });
        continue;
      }

      const ends = [shape.points[0]!, shape.points[shape.points.length - 1]!];
      const startHost = hostAt(ends[0]!, element, context);
      const destination = this.rerouteDestination(intent, element, ends[1]!, context);

      if (!destination) {
        result.unplaceable.push({
          description: `Redraw ${label(element)}`,
          reason: 'There is nothing at the far end of it to route to.',
        });
        continue;
      }

      const obstacles = context.document.layout.elements
        .filter(
          (other) =>
            other.id !== element.id &&
            !other.hidden &&
            other.role !== 'fill' &&
            other.shape.kind !== 'polyline',
        )
        .map((other) => geometryOutline(other.shape));

      const ignore = [destination.ring, ...(startHost ? [geometryOutline(startHost.shape)] : [])];
      const starts = startHost
        ? terraceStarts(geometryOutline(startHost.shape), destination.ring)
        : [ends[0]!];

      const candidates = routeCandidates({
        start: ends[0]!,
        starts,
        destination: destination.ring,
        obstacles,
        boundary: context.boundary,
        ignore,
        width: shape.width,
      });

      const chosen = pickRoute(intent, candidates, context);
      if (!chosen) {
        result.unplaceable.push({
          description: `Redraw ${label(element)}`,
          reason: 'There is no clear line between its ends that does better than the one it takes.',
        });
        continue;
      }

      if (samePoints(chosen.geometry, shape)) {
        result.unplaceable.push({
          description: `Redraw ${label(element)}`,
          reason: 'It already takes the most direct legal line between its ends.',
        });
        continue;
      }

      const next: DesignElement = { ...element, shape: chosen.geometry };
      result.changes.push(change(nextId(), 'reroute', element, next, context));
    }

    return result;
  }

  /** What the far end of a rerouted path should reach: the named element, or what it reaches now. */
  private rerouteDestination(
    intent: Extract<DesignIntent, { kind: 'reroute' }>,
    element: DesignElement,
    end: Point,
    context: Context,
  ): { ring: Point[] } | null {
    if (intent.objective === 'connect' && intent.connectElementId) {
      const target = context.document.layout.elements.find(
        (candidate) => candidate.id === intent.connectElementId,
      );
      return target && target.id !== element.id ? { ring: geometryOutline(target.shape) } : null;
    }

    /*
     * A path that ends in open ground cannot be rerouted, and refusing is the honest answer rather
     * than a limitation. There is nothing to route *to*: stepping stones across a lawn end where
     * they end. The first version invented a small ring round the last point so the router had a
     * destination, and it shrank the path by the standoff every time — a change the user watches
     * happen and cannot see, and one that would eat the path if asked twice.
     */
    const host = hostAt(end, element, context);
    return host ? { ring: geometryOutline(host.shape) } : null;
  }

  /* ---------------------------------------------------------------- rotate */

  /**
   * Turn something to line up with something else.
   *
   * Quarter turns only, nearest first, and the first that is legal and clear wins — so "square it to
   * the house" moves a terrace as little as it can rather than spinning it to whichever of the four
   * the arithmetic happened to produce. Rectangles only, which is what `resolveOperation` and the
   * editor's own rotate handle both already accept: a polygon has no rotation to set, and turning
   * its points would be a reshape wearing the wrong name.
   */
  private rotate(
    intent: Extract<DesignIntent, { kind: 'rotate' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      if (isLocked(element)) {
        result.unplaceable.push({
          description: `Turn ${label(element)}`,
          reason: 'It is the ground cover for a whole area, so it stays where it is.',
        });
        continue;
      }

      if (element.shape.kind !== 'rect') {
        result.unplaceable.push({
          description: `Turn ${label(element)}`,
          reason: 'Only a rectangle has an angle to set; this one is drawn as an outline.',
        });
        continue;
      }

      const bearing = this.alignmentBearing(intent, element, context);
      if (bearing === null) {
        result.unplaceable.push({
          description: `Turn ${label(element)}`,
          reason: 'There is nothing there to line it up with.',
        });
        continue;
      }

      const current = element.shape.rotation;
      if (offBearing(current, bearing) < ALIGNED_ENOUGH) {
        result.unplaceable.push({
          description: `Turn ${label(element)}`,
          reason: 'It is already square to that.',
        });
        continue;
      }

      const turned = squareTo(bearing, current)
        .map((rotation) => ({
          ...element,
          shape: { ...element.shape, rotation },
        }))
        .find(
          (candidate) =>
            elementIsLegal(candidate, context.boundary) &&
            clearOfOthers(candidate, element, context),
        );

      if (!turned) {
        result.unplaceable.push({
          description: `Turn ${label(element)}`,
          reason: 'There is not room around it to turn it without hitting something.',
        });
        continue;
      }

      result.changes.push(change(nextId(), 'rotate', element, turned, context));
    }

    return result;
  }

  /** What "square to that" resolves to, in degrees clockwise. */
  private alignmentBearing(
    intent: Extract<DesignIntent, { kind: 'rotate' }>,
    element: DesignElement,
    context: Context,
  ): number | null {
    const anchor = elementAnchor(element);

    if (intent.to === 'house') {
      return context.house ? nearestEdgeBearing(context.house, anchor) : null;
    }
    if (intent.to === 'boundary') return nearestEdgeBearing(context.boundary, anchor);

    if (!intent.elementId || intent.elementId === element.id) return null;
    const other = context.document.layout.elements.find(
      (candidate) => candidate.id === intent.elementId,
    );
    return other ? bearingOfElement(other) : null;
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

  /* ---------------------------------------------------------------- reshape */

  /**
   * Pushes one side of an outline out, and takes the ground it gains off whatever it took it from.
   *
   * **Both halves or neither**, and that is the rule this branch exists to keep. A border deepened
   * into the lawn beside it, with the lawn left as it was, is two elements claiming one piece of
   * ground — and because the bed is drawn over the lawn it *looks* right, so nothing on screen
   * would say the plan had stopped being true. If the neighbour cannot give the strip up cleanly,
   * the bed is not deepened either.
   */
  private async reshape(
    intent: Extract<DesignIntent, { kind: 'reshape' }>,
    context: Context,
    nextId: () => string,
  ): Promise<PlannedChanges> {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      if (isLocked(element)) {
        result.unplaceable.push({
          description: `Reshape ${label(element)}`,
          reason: 'It is the ground cover for a whole area, so its outline is fixed.',
        });
        continue;
      }

      if (element.shape.kind !== 'polygon') {
        result.unplaceable.push({
          description: `Reshape ${label(element)}`,
          reason: 'Only a bed or a panel with a drawn outline can have one side moved.',
        });
        continue;
      }

      const direction = houseDirection(element, context, intent.edge);
      if (!direction) {
        result.unplaceable.push({
          description: `Reshape ${label(element)}`,
          reason: 'There is no house on the plan to say which side of it that is.',
        });
        continue;
      }

      const next = pushEdge(element, direction, intent.metres);
      if (!next) {
        result.unplaceable.push({
          description: `Reshape ${label(element)}`,
          reason: 'Pulling that side back that far would leave nothing of it.',
        });
        continue;
      }

      if (!elementIsLegal(next, context.boundary)) {
        result.unplaceable.push({
          description: `Reshape ${label(element)}`,
          reason: 'That side would end up outside the boundary.',
        });
        continue;
      }

      /*
       * Who gives up the ground.
       *
       * Filtered by bounding box and then asked properly, rather than by `polygonsIntersect`. That
       * predicate is right about what it measures and wrong for this: it excludes touching, and a
       * border and the lawn in front of it habitually share their left and right edges exactly —
       * every corner lands *on* the other's outline, nothing strictly crosses, and it answers "no
       * overlap" about two shapes that plainly meet. The box test is conservative (it can only
       * over-include) and the subtraction below is what actually decides.
       *
       * Base fills are excluded for the reason `clearOfOthers` excludes them: they are the ground
       * everything is drawn on, and a hole cut in one is the defect `isLocked` exists to prevent.
       */
      const grown = geometryOutline(next.shape);
      const neighbours = context.document.layout.elements.filter(
        (other) =>
          other.id !== element.id &&
          !other.hidden &&
          !isLocked(other) &&
          other.shape.kind === 'polygon' &&
          boxesOverlap(grown, geometryOutline(other.shape)),
      );

      const yielded: ProposedChange[] = [];
      let blocked: string | null = null;

      for (const neighbour of neighbours) {
        const before = geometryOutline(neighbour.shape);
        const remaining = await this.fill.subtract(before, grown);

        if (!remaining) {
          blocked = `${label(neighbour)} beside it cannot give up that strip.`;
          break;
        }

        /* It was near enough to ask about but the reshape took nothing off it. Leave it alone. */
        if (Math.abs(polygonArea(remaining) - polygonArea(before)) < TOOK_NOTHING) continue;

        const trimmed: DesignElement = {
          ...neighbour,
          shape: { kind: 'polygon', cornerRadius: 0, points: remaining },
        };
        yielded.push(change(nextId(), 'reshape', neighbour, trimmed, context));
      }

      if (blocked) {
        result.unplaceable.push({ description: `Reshape ${label(element)}`, reason: blocked });
        continue;
      }

      result.changes.push(change(nextId(), 'reshape', element, next, context), ...yielded);
    }

    return result;
  }

  /* ---------------------------------------------------------------- attach */

  /**
   * "And take the furniture with it."
   *
   * On its own this produces nothing: it is meaningful only beside a move or a resize in the same
   * request, where the host has already been changed and whatever stands on it would otherwise be
   * left behind on bare ground. So the planner reads the host as the *request* will leave it, which
   * is why the changes already produced are passed in.
   */
  private attach(
    intent: Extract<DesignIntent, { kind: 'attach' }>,
    context: Context,
    nextId: () => string,
  ): PlannedChanges {
    const result: PlannedChanges = { changes: [], unplaceable: [] };

    for (const element of resolve(intent.target.elementIds, context)) {
      /*
       * Where this request has left the host — and nothing at all if it did not touch it.
       *
       * A no-op is the wrong answer here rather than a harmless one. `attach` after a move the
       * planner refused would emit a line saying the furniture moved by zero: a change on the diff,
       * an operation on the canvas, and a count in the outcome, all for nothing happening. Saying
       * the host did not move is both true and the thing the user needs to know.
       */
      const host = context.pending.get(element.id);
      if (!host) {
        result.unplaceable.push({
          description: `Move what is on ${label(element)}`,
          reason: 'It has not moved, so there is nothing to bring with it.',
        });
        continue;
      }

      const was = geometryOutline(element.shape);
      const now = geometryOutline(host.shape);

      const shift = {
        x: elementAnchor(host).x - elementAnchor(element).x,
        y: elementAnchor(host).y - elementAnchor(element).y,
      };

      const standing = context.document.layout.elements.filter(
        (other) =>
          other.id !== element.id &&
          !other.hidden &&
          !isLocked(other) &&
          /* Inside the host as it *was*: that is what "standing on it" means. */
          polygonContainsPolygon(was, geometryOutline(other.shape)),
      );

      if (standing.length === 0) {
        result.unplaceable.push({
          description: `Move what is on ${label(element)}`,
          reason: 'There is nothing standing on it.',
        });
        continue;
      }

      for (const piece of standing) {
        const moved: DesignElement = {
          ...piece,
          shape: translateGeometry(piece.shape, shift.x, shift.y),
        };

        /*
         * It has to land on the host, not merely near where it was. A host that shrank can leave a
         * dining set half off the paving even after the shift, and a set on the grass is worse than
         * one that did not move — the user can see the second and would not notice the first.
         */
        if (!polygonContainsPolygon(now, geometryOutline(moved.shape))) {
          result.unplaceable.push({
            description: `Move ${label(piece)} with ${label(element)}`,
            reason: `There is no longer room for it on ${label(element)}.`,
          });
          continue;
        }

        if (!elementIsLegal(moved, context.boundary)) {
          result.unplaceable.push({
            description: `Move ${label(piece)} with ${label(element)}`,
            reason: 'It would end up outside the boundary.',
          });
          continue;
        }

        result.changes.push(change(nextId(), 'move', piece, moved, context));
      }
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

    /*
     * Towards another element, named by id and never by position.
     *
     * "Nearer the seating" is the commonest placement request there is and the other three
     * destinations cannot express it. Refused when it names the thing being moved: a move towards
     * itself has no direction, and the move ladder would report "already as far that way as it will
     * go" — technically true and completely unhelpful.
     */
    if (intent.towards === 'element') {
      if (!intent.elementId || intent.elementId === element.id) return null;
      const other = context.document.layout.elements.find(
        (candidate) => candidate.id === intent.elementId,
      );
      return other ? elementAnchor(other) : null;
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

    /*
     * Everything already on the plan is an obstacle, plus the house — except, for furniture, the
     * surfaces it is allowed to stand on. A dining set placed with every patio treated as an
     * obstacle can only ever land on the lawn beside the patio, which is the one place nobody
     * wants it.
     */
    const standsOn = new Set(['paved-area', 'gravel-mulch', 'structure', 'lawn']);
    const obstacles = context.document.layout.elements
      .filter((element) => !element.hidden && !isLocked(element))
      .filter((element) => intent.category !== 'furniture' || !standsOn.has(element.category))
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

      /*
       * The house is not part of `geometryIsLegal` any more — a patio may be attached to the
       * wall — but a *new* element is still sampled clear of it: `obstacles` carries the house
       * above, and `geometryClearsHouse` is the TypeScript half of the same rule. Growing or
       * moving an existing element towards the wall is allowed; conjuring one under the
       * building is not something a sentence ever meant.
       */
      const at = candidates.find(
        (point) =>
          geometryIsLegal(geometryFor(intent.footprint, point), context.boundary) &&
          geometryClearsHouse(geometryFor(intent.footprint, point), context.house),
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
    pending: new Map(),
  };
}

/**
 * How near a path's end has to be to something for that thing to be what it leaves or reaches.
 *
 * `PATH_STANDOFF` plus a little: the router stops a path 50 mm short of its destination on purpose,
 * so an end that reaches a shed sits just outside the shed. Anything within half a metre of a ring
 * is touching it as far as a person reading the plan is concerned.
 */
const HOST_REACH = 0.5;

/** Degrees off a bearing that still reads as square to it. Matches the style principle's own. */
const ALIGNED_ENOUGH = 2;

/** How far a redrawn route may differ from the old one and still be the same route. */
const SAME_ROUTE = PATH_STANDOFF * 2;

/** What a path's end is on, where it is on anything. */
function hostAt(end: Point, route: DesignElement, context: Context): DesignElement | null {
  let best: DesignElement | null = null;
  let bestDistance = HOST_REACH;

  for (const other of context.document.layout.elements) {
    if (other.id === route.id || other.hidden) continue;
    if (other.role === 'fill' || other.shape.kind === 'polyline') continue;

    const ring = geometryOutline(other.shape);
    if (ring.length < 3) continue;

    const distance = pointInPolygon(end, ring)
      ? 0
      : Math.min(
          ...ring.map((point, i) => distanceToSegment(end, point, ring[(i + 1) % ring.length]!)),
        );

    if (distance > bestDistance) continue;
    bestDistance = distance;
    best = other;
  }

  return best;
}

/**
 * Which of the legal routes answers the objective.
 *
 * `direct` is the shortest way round, which is what the word means and what the circulation
 * principle measures. `avoid` keeps only the ones that stay clear of what was named, then takes the
 * most direct of those — an objective that returned a wandering route because it happened to dodge
 * the right bed would be answering half the request. `connect` has already been answered by the
 * destination the caller resolved, so it too comes down to directness.
 *
 * Ties break on the candidate's own order, which is the router's preference: straight before the
 * L-shapes, nearest start before the rest.
 */
function pickRoute(
  intent: Extract<DesignIntent, { kind: 'reroute' }>,
  candidates: RouteCandidate[],
  context: Context,
): RouteCandidate | null {
  let field = candidates;

  if (intent.objective === 'avoid' && intent.avoidElementIds?.length) {
    const rings = intent.avoidElementIds
      .map((id) => context.document.layout.elements.find((element) => element.id === id))
      .filter((element): element is DesignElement => element !== undefined)
      .map((element) => geometryOutline(element.shape));

    field = candidates.filter((candidate) => {
      const strip = geometryOutline(candidate.geometry);
      return !rings.some((ring) => polygonsIntersect(strip, ring));
    });
  }

  return field.reduce<RouteCandidate | null>(
    (best, candidate) => (best === null || candidate.detour < best.detour ? candidate : best),
    null,
  );
}

/**
 * Whether a redrawn route is the route it started as.
 *
 * To a tolerance rather than exactly, and the tolerance is the router's own standoff. A route ends
 * `PATH_STANDOFF` short of what it reaches, so re-deriving the end of a path that already arrives
 * there moves it by fifty millimetres — which is not a reroute, it is the same line recomputed, and
 * proposing it would put a change in the diff that the user watches happen and cannot see.
 */
function samePoints(
  next: PlanGeometry,
  before: Extract<PlanGeometry, { kind: 'polyline' }>,
): boolean {
  if (next.kind !== 'polyline' || next.points.length !== before.points.length) return false;
  return next.points.every(
    (point, i) =>
      Math.hypot(point.x - before.points[i]!.x, point.y - before.points[i]!.y) <= SAME_ROUTE,
  );
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
  kind: 'resize' | 'reshape' | 'move' | 'rotate' | 'reroute',
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
    elementIsLegal(scaled(element, factor), context.boundary) &&
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

    if (elementIsLegal(moved, context.boundary) && clearOfOthers(moved, element, context)) {
      return moved;
    }
  }

  return null;
}

/**
 * Whether two outlines' bounding boxes overlap at all.
 *
 * A conservative pre-filter, and conservative in the safe direction: it can only say yes about
 * shapes that turn out not to meet, and the geometry engine settles those. What it must never do is
 * say no about two that do — which is exactly what `polygonsIntersect` does to a border and the
 * lawn in front of it, because they share their left and right edges and touching is not crossing.
 */
function boxesOverlap(a: Point[], b: Point[]): boolean {
  const box = (ring: Point[]) => ({
    left: Math.min(...ring.map((point) => point.x)),
    right: Math.max(...ring.map((point) => point.x)),
    top: Math.min(...ring.map((point) => point.y)),
    bottom: Math.max(...ring.map((point) => point.y)),
  });

  const first = box(a);
  const second = box(b);
  return (
    first.left <= second.right &&
    second.left <= first.right &&
    first.top <= second.bottom &&
    second.top <= first.bottom
  );
}

/**
 * Which way "towards the house" is, from where this element stands.
 *
 * A unit vector from the element's anchor to the house, which is the same frame every other
 * position in this file is expressed in — never a screen axis, because a plot can be drawn at any
 * angle and a bed "deepened downwards" would mean something different on every plan.
 *
 * Null with no house, and null when the element is sitting on the house's own centre, where there
 * is no direction to give.
 */
function houseDirection(
  element: DesignElement,
  context: Context,
  edge: 'towards-house' | 'away-from-house',
): Point | null {
  if (!context.houseCentre) return null;

  const anchor = elementAnchor(element);
  const dx = context.houseCentre.x - anchor.x;
  const dy = context.houseCentre.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;

  const sign = edge === 'towards-house' ? 1 : -1;
  return { x: (sign * dx) / length, y: (sign * dy) / length };
}

/**
 * Moves the corners on one side of an outline, and leaves the rest where they are.
 *
 * Which corners: those on the far half along `direction`, measured by projecting each onto it and
 * splitting at the midpoint of the spread. That is what makes this a *reshape* rather than a
 * resize — a border deepened away from the house keeps its two ends exactly where the paths meet
 * it, where scaling the whole outline would drag them along the fence as well.
 *
 * Returns null when the push would collapse the shape, rather than emitting a bed of no depth.
 */
function pushEdge(element: DesignElement, direction: Point, metres: number): DesignElement | null {
  const shape = element.shape;
  if (shape.kind !== 'polygon') return null;

  const along = shape.points.map((point) => point.x * direction.x + point.y * direction.y);
  const low = Math.min(...along);
  const high = Math.max(...along);
  const spread = high - low;

  /* A sliver has no two sides to tell apart, and pushing one of them is meaningless. */
  if (spread < MIN_SIDE) return null;

  const midpoint = (low + high) / 2;
  const moving = along.map((value) => value > midpoint);
  const points = shape.points.map((point, index) =>
    moving[index]
      ? { x: point.x + direction.x * metres, y: point.y + direction.y * metres }
      : point,
  );

  /*
   * The moved side must still be on the far side of the one that stayed.
   *
   * Comparing the overall spread is not enough and the difference is not academic: pulling a
   * 1.5 m border back by 3 m leaves a spread of 1.5 again, with the two sides swapped — an outline
   * folded through itself, which has a perfectly ordinary vertex list and a quietly wrong area, so
   * nothing downstream would report it. Same class of fault as `setEdgeLength`'s bow tie.
   */
  const after = points.map((point) => point.x * direction.x + point.y * direction.y);
  const movedSide = after.filter((_value, index) => moving[index]!);
  const fixedSide = after.filter((_value, index) => !moving[index]!);
  if (movedSide.length === 0 || fixedSide.length === 0) return null;
  if (Math.min(...movedSide) - Math.max(...fixedSide) < MIN_SIDE) return null;

  return { ...element, shape: { ...shape, points } };
}

/**
 * Nothing else on the plan is in the way. Base fills are ground, so they do not count.
 *
 * **Nor does anything standing on it.** A dining set on a terrace overlaps that terrace by design,
 * so counting it as an obstacle made every furnished surface immovable and unresizable — the
 * planner refused with "there is no room around it to grow into" about a table the user could see
 * was on top of it. That is the fault `attach` exists to answer, and it cannot answer it while the
 * move that would need it is refused first. The predicate is containment in the element's own
 * outline as it stands, which is what "standing on it" means everywhere else in this codebase.
 */
function clearOfOthers(
  candidate: DesignElement,
  original: DesignElement,
  context: Context,
): boolean {
  const outline = geometryOutline(candidate.shape);
  const host = geometryOutline(original.shape);

  return context.document.layout.elements.every((other) => {
    if (other.id === original.id || other.hidden || isLocked(other)) return true;
    if (other.role === 'fill') return true;
    if (polygonContainsPolygon(host, geometryOutline(other.shape))) return true;

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
