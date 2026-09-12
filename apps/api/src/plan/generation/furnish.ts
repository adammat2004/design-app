import {
  geometryClearsHouse,
  geometryIsLegal,
  geometryOutline,
  polygonContainsPolygon,
  polygonsIntersect,
  SYMBOLS,
  type DesignElement,
  type DesiredFeature,
  type PlanGeometry,
  type Point,
  type SymbolId,
} from '@garden-studio/schema';
import { materialFor } from './archetypes.js';
import type { DesignConstraints } from './constraints.js';
import { FURNISHINGS, HOST_SYMBOLS, MARGIN } from './furnishings.js';

export { hostFloor, MARGIN } from './furnishings.js';

/**
 * Puts a thing inside the feature the brief asked for.
 *
 * Pure: no SQL, because the item goes in the *middle* of its host and the only question is
 * whether it fits. It inherits the host's rotation, sits centred, keeps a margin of clear surface
 * round it, and is verified by the same `geometryIsLegal` every placed thing goes through — which
 * it must pass, being inside a host that passed it, but the check is cheap and the guarantee
 * "nothing in a concept can fail the validator that guards its save" is worth keeping literal.
 *
 * The item is a separate element rather than a property of the host, so the editor can move the
 * table off the patio and the assistant can be asked to. It is pushed onto `obstacles` by the
 * caller like everything else, and the concept test's disjointness rule is relaxed for it alone:
 * furniture is *supposed* to overlap the surface it stands on.
 */

export interface FurnishOptions {
  /** Which concept this is; picks the first choice from the feature's list. */
  index: number;
  rng: () => number;
  constraints: DesignConstraints;
  houseRing: Point[] | null;
  boundary: Point[];
  nextId: () => string;
}

/** The symbol the host itself carries, if its feature implies one. */
export function hostSymbol(feature: DesiredFeature): SymbolId | undefined {
  return HOST_SYMBOLS[feature];
}

export function furnish(
  host: DesignElement,
  feature: DesiredFeature,
  options: FurnishOptions,
): DesignElement | null {
  const choices = FURNISHINGS[feature];
  if (!choices || choices.length === 0) return null;

  /*
   * The play area is the one place a roll is right: a swing, a trampoline and a slide are three
   * equally good answers and three concepts with the same one would be dull. Everywhere else the
   * concept's own index decides, so the balanced concept and the entertaining one differ on
   * purpose rather than by chance.
   */
  const start =
    feature === 'play'
      ? Math.floor(options.rng() * choices.length)
      : Math.min(options.index, choices.length - 1);

  for (let step = 0; step < choices.length; step += 1) {
    const symbol = choices[(start + step) % choices.length]!;
    const shape = fitInside(host.shape, symbol);
    if (!shape) continue;
    if (!geometryIsLegal(shape, options.boundary)) continue;
    if (!geometryClearsHouse(shape, options.houseRing)) continue;

    return {
      id: options.nextId(),
      category: 'furniture',
      role: 'feature',
      name: SYMBOLS[symbol].label,
      shape,
      zone: host.zone,
      material: materialFor('furniture', options.constraints, options.index),
      symbol,
      height: SYMBOLS[symbol].height,
    };
  }

  return null;
}

/** A restrained group of independently editable objects, fitted to the actual room. */
export function furnishRoom(
  host: DesignElement,
  feature: DesiredFeature,
  options: FurnishOptions,
): DesignElement[] {
  const primary = furnish(host, feature, options);
  if (!primary) return [];
  const items = [primary];
  const hostRing = geometryOutline(host.shape);
  const add = (symbol: SymbolId, shape: PlanGeometry) => {
    const outline = geometryOutline(shape);
    if (!polygonContainsPolygon(hostRing, outline) || !geometryIsLegal(shape, options.boundary) ||
      !geometryClearsHouse(shape, options.houseRing) ||
      items.some((item) => polygonsIntersect(outline, geometryOutline(item.shape)))) return;
    items.push({
      id: options.nextId(), category: 'furniture', role: 'feature', zone: host.zone,
      name: SYMBOLS[symbol].label, symbol, shape, height: SYMBOLS[symbol].height,
      material: materialFor('furniture', options.constraints, options.index),
    });
  };

  if (feature === 'firePit' && host.shape.kind === 'point' && host.shape.radius >= 1.8) {
    // Two seats facing the bowl, with a clear entry on either side of the circle.
    for (const sign of [-1, 1]) {
      const offset = host.shape.radius - 0.65;
      if (offset - 0.3 < 0.85) continue;
      add('bench', { kind: 'rect', centre: { x: host.shape.at.x, y: host.shape.at.y + sign * offset },
        width: 1.6, depth: 0.6, rotation: sign === 1 ? 180 : 0 });
    }
  }

  if ((feature === 'seating' || feature === 'pergola') && host.shape.kind === 'rect') {
    const hostShape = host.shape;
    const radians = hostShape.rotation * Math.PI / 180;
    const at = (x: number, y: number) => ({
      x: hostShape.centre.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: hostShape.centre.y + x * Math.sin(radians) + y * Math.cos(radians),
    });
    if (primary.symbol === 'lounger' && hostShape.width >= 3.4 && hostShape.depth >= 2.8) {
      // A pair has a purpose; an isolated lounger in the middle of a generous room does not.
      if (primary.shape.kind === 'rect') {
        const second = { ...primary.shape, centre: at(1.05, 0) };
        add('lounger', second);
      }
    }
    if (options.constraints.budget !== 'low') {
      for (const sign of [-1, 1]) {
        add('planter', { kind: 'rect', centre: at(sign * (hostShape.width / 2 - 0.65), hostShape.depth / 2 - 0.65),
          width: 0.6, depth: 0.6, rotation: hostShape.rotation });
      }
    }
  }
  return items;
}

/**
 * The item's geometry, centred in the host with `MARGIN` clear all round, or `null` if it will
 * not go. A rect item may be turned a quarter to fit a host that runs the other way.
 */
export function fitInside(host: PlanGeometry, symbol: SymbolId): PlanGeometry | null {
  const { footprint } = SYMBOLS[symbol];

  if (host.kind === 'point') {
    if (footprint.kind !== 'point') return null;
    if (footprint.radius + MARGIN > host.radius) return null;
    return { kind: 'point', at: host.at, radius: footprint.radius };
  }

  if (host.kind !== 'rect') return null;

  if (footprint.kind === 'point') {
    const clear = footprint.radius * 2 + MARGIN * 2;
    if (clear > host.width || clear > host.depth) return null;
    return { kind: 'point', at: host.centre, radius: footprint.radius };
  }

  const fits = (w: number, d: number) =>
    w + MARGIN * 2 <= host.width && d + MARGIN * 2 <= host.depth;

  if (fits(footprint.width, footprint.depth)) {
    return {
      kind: 'rect',
      centre: host.centre,
      width: footprint.width,
      depth: footprint.depth,
      rotation: host.rotation,
    };
  }

  if (fits(footprint.depth, footprint.width)) {
    return {
      kind: 'rect',
      centre: host.centre,
      width: footprint.depth,
      depth: footprint.width,
      rotation: host.rotation,
    };
  }

  return null;
}

/** Whether an item's outline lies wholly inside its host's. The test's oracle, exported for it. */
export function sitsInside(item: Point[], host: Point[]): boolean {
  return polygonContainsPolygon(host, item);
}
