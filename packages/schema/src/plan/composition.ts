import { boundingBox, pointInPolygon, polygonArea, rotatePoint } from '../geometry/primitives.js';
import {
  elementArea,
  elementOutline,
  type DesignElement,
  type ElementCategory,
} from './concepts.js';
import { isPlantSymbol } from './symbols.js';
import type { ZoneId } from './zone-id.js';
import type { GardenZone } from './zones.js';

/**
 * How a plan is composed, measured.
 *
 * `quantities.ts` counts what a plan is made of, and it is explicit that its areas overlap on
 * purpose: a base fill is the whole zone, and everything else is drawn over it, so summing
 * element areas describes a garden half again bigger than the plot. That is fine for a schedule
 * (it says which layer each line is in) and useless for a question like "how much of this garden
 * is lawn?", which is the question a designer asks first.
 *
 * Coverage is a property of the z-order, and the honest way to read it without a polygon-boolean
 * library is to *sample* it: lay a grid of points over the designed zones and ask, for each, which
 * element is on top. Shares are then counts over counts, they sum to one by construction, and two
 * lawns drawn over the same ground count once. The grid is coarse (a quarter of a metre by
 * default) and that is the point — this is a measurement of composition at the scale a plan is
 * read, not a survey.
 *
 * ```
 *   zones ──► bounding box ──► grid at `step` ──► inside a zone? ──► topmost element ──► kind
 *                                                                                          │
 *   hard · lawn · planting · water · undesigned (base showing) · existing  ◄────────────────┘
 * ```
 *
 * This module has no authority: it reads outlines `geometryOutline` already tessellated and
 * areas `elementArea` already computed. Nothing downstream reads it — the generator's rule bands
 * live beside the generator, because a band is an opinion and this is not.
 */

/** What a sampled point is covered by, read from the topmost element over it. */
export type CoverKind = 'hard' | 'lawn' | 'planting' | 'water' | 'undesigned' | 'existing';

export interface CompositionShares {
  hard: number;
  lawn: number;
  planting: number;
  water: number;
  /** A base fill showing through: ground nothing was designed onto. */
  undesigned: number;
  existing: number;
}

export interface CompositionReport {
  /** Square metres represented by the sampled points that fell inside a zone. */
  sampledArea: number;
  /** Fractions of `sampledArea`; they sum to 1 (to rounding) when any point was sampled. */
  shares: CompositionShares;
  /**
   * The largest paved rectangle placed as a feature — the terrace, on every generated plan. Its
   * rotation is the frame the lawn's extent is measured in.
   */
  terrace: { width: number; depth: number; minDimension: number; rotation: number } | null;
  /**
   * The largest accent lawn or gravel panel: the open ground of the garden. `null` is a
   * courtyard — a plan with nowhere open at all.
   */
  panel: { category: ElementCategory; area: number; minDimension: number } | null;
  /** `panel` when it is grass; the number every lawn rule reads. */
  lawn: { area: number; minDimension: number } | null;
  baseByZone: Partial<Record<ZoneId, ElementCategory>>;
  /** Whether any lawn, base or accent, lies in the front zone. */
  frontHasLawn: boolean;
  courtyard: boolean;
}

/** Everything but a bed is a hard surface; the reading a plan gives at arm's length. */
const KIND_BY_CATEGORY: Record<ElementCategory, CoverKind | null> = {
  'paved-area': 'hard',
  structure: 'hard',
  'gravel-mulch': 'hard',
  lawn: 'lawn',
  'planting-bed': 'planting',
  'water-feature': 'water',
  // Stands on a surface; it does not cover ground.
  furniture: null,
  /*
   * Nor does a light, and this one matters more than furniture does. A lighting scheme is dozens
   * of fittings scattered right across the plan, so counting them as cover would move every band
   * in `COMPOSITION_BANDS` by the amount of lighting a concept happened to specify — a measurement
   * of the plan's composition that changed when you added a bollard.
   */
  lighting: null,
  'existing-feature': 'existing',
};

export const DEFAULT_SAMPLE_STEP = 0.25;

interface Sampled {
  kind: CoverKind;
  outline: Point[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Point {
  x: number;
  y: number;
}

export function measureComposition(
  elements: DesignElement[],
  zones: GardenZone[],
  step = DEFAULT_SAMPLE_STEP,
): CompositionReport {
  const covers = coverElements(elements);
  const shares = sampleShares(covers, zones, step);

  const terrace = largestPavedRect(elements);
  const panel = largestPanel(elements, terrace?.rotation ?? 0);

  const baseByZone: Partial<Record<ZoneId, ElementCategory>> = {};
  for (const element of elements) {
    if (element.hidden || element.role !== 'fill' || element.fillKind !== 'base') continue;
    baseByZone[element.zone] = element.category;
  }

  const frontHasLawn = elements.some(
    (element) => !element.hidden && element.zone === 'front' && element.category === 'lawn',
  );

  return {
    sampledArea: shares.sampledArea,
    shares: shares.shares,
    terrace,
    panel,
    lawn:
      panel && panel.category === 'lawn'
        ? { area: panel.area, minDimension: panel.minDimension }
        : null,
    baseByZone,
    frontHasLawn,
    courtyard: panel === null,
  };
}

/**
 * The elements that cover ground, in stacking order, with the kind each reads as.
 *
 * Plants are skipped whatever their category: a tree canopy over a lawn is a tree standing on a
 * lawn, and counting its circle as planting would turn five trees into forty square metres of
 * border. Furniture is skipped for the same reason — it stands on its host.
 */
function coverElements(elements: DesignElement[]): Sampled[] {
  const covers: Sampled[] = [];
  for (const element of elements) {
    if (element.hidden) continue;
    if (isPlantSymbol(element.symbol)) continue;
    const category = KIND_BY_CATEGORY[element.category];
    if (category === null) continue;
    const kind: CoverKind =
      element.role === 'fill' && element.fillKind === 'base' ? 'undesigned' : category;
    const outline = elementOutline(element);
    if (outline.length < 3) continue;
    const box = boundingBox(outline);
    covers.push({
      kind,
      outline,
      box: {
        minX: box.minX,
        minY: box.minY,
        maxX: box.minX + box.width,
        maxY: box.minY + box.length,
      },
    });
  }
  return covers;
}

function sampleShares(
  covers: Sampled[],
  zones: GardenZone[],
  step: number,
): { sampledArea: number; shares: CompositionShares } {
  const counts: Record<CoverKind, number> = {
    hard: 0,
    lawn: 0,
    planting: 0,
    water: 0,
    undesigned: 0,
    existing: 0,
  };
  const zoneRings = zones.map((zone) => zone.polygon).filter((ring) => ring.length >= 3);
  if (zoneRings.length === 0 || step <= 0) {
    return { sampledArea: 0, shares: { ...counts } };
  }

  const all = boundingBox(zoneRings.flat());
  let total = 0;

  // Sample at cell centres so a point never sits exactly on a zone seam or a grid-aligned edge.
  for (let y = all.minY + step / 2; y < all.minY + all.length; y += step) {
    for (let x = all.minX + step / 2; x < all.minX + all.width; x += step) {
      const point = { x, y };
      if (!zoneRings.some((ring) => pointInPolygon(point, ring))) continue;
      total += 1;

      // Last match wins: array order is stacking order.
      let kind: CoverKind | null = null;
      for (const cover of covers) {
        if (x < cover.box.minX || x > cover.box.maxX || y < cover.box.minY || y > cover.box.maxY) {
          continue;
        }
        if (pointInPolygon(point, cover.outline)) kind = cover.kind;
      }
      // Ground with nothing at all on it reads the same as base showing through.
      counts[kind ?? 'undesigned'] += 1;
    }
  }

  const shares: CompositionShares = { ...counts };
  if (total > 0) {
    for (const key of Object.keys(shares) as CoverKind[]) shares[key] = counts[key] / total;
  }
  return { sampledArea: total * step * step, shares };
}

function largestPavedRect(elements: DesignElement[]): CompositionReport['terrace'] {
  let best: CompositionReport['terrace'] = null;
  let bestArea = 0;
  for (const element of elements) {
    if (element.hidden || element.role !== 'feature' || element.category !== 'paved-area') continue;
    if (element.shape.kind !== 'rect') continue;
    const area = element.shape.width * element.shape.depth;
    if (area <= bestArea) continue;
    bestArea = area;
    best = {
      width: element.shape.width,
      depth: element.shape.depth,
      minDimension: Math.min(element.shape.width, element.shape.depth),
      rotation: element.shape.rotation,
    };
  }
  return best;
}

/**
 * The biggest open panel — accent lawn or accent gravel — and its narrowest extent measured in
 * the terrace's frame, so a lawn that is 3 m wide along the house reads as 3 m whatever the
 * house's rotation.
 */
function largestPanel(elements: DesignElement[], rotation: number): CompositionReport['panel'] {
  let best: CompositionReport['panel'] = null;
  for (const element of elements) {
    if (element.hidden || element.role !== 'fill' || element.fillKind !== 'accent') continue;
    if (element.category !== 'lawn' && element.category !== 'gravel-mulch') continue;
    const area = elementArea(element);
    if (best && area <= best.area) continue;
    best = {
      category: element.category,
      area,
      minDimension: minExtent(elementOutline(element), rotation),
    };
  }
  return best;
}

/** The smaller side of the outline's bounding box after undoing `rotation` (degrees clockwise). */
export function minExtent(outline: Point[], rotation: number): number {
  if (outline.length < 3) return 0;
  const origin = { x: 0, y: 0 };
  const box = boundingBox(outline.map((point) => rotatePoint(point, origin, -rotation)));
  return Math.min(box.width, box.length);
}

/** The area a set of zones covers, for reporting a share as square metres. */
export function zonesArea(zones: GardenZone[]): number {
  return zones.reduce((total, zone) => total + polygonArea(zone.polygon), 0);
}
