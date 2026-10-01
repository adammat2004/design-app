import { describe, expect, it } from 'vitest';
import { rectToPolygon } from '../../geometry/shapes.js';
import type { DesignElement } from '../concepts.js';
import { geometryOutline } from '../features.js';
import {
  reachOf,
  rightAnglePoint,
  snapPointTo,
  snapShapeDelta,
  type ShapeSubject,
} from './snap.js';
import { snapTargetsFor } from './targets.js';

/** A 20 × 16 plot with an 8 × 6 house in the middle. */
const boundary = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];
const house = rectToPolygon({ centre: { x: 10, y: 8 }, width: 8, depth: 6 });
const targets = snapTargetsFor({ boundary, house });

const on = { enabled: true, unit: 'm' as const };

function subjectOf(shape: DesignElement['shape']): ShapeSubject {
  const outline = geometryOutline(shape);
  return { corners: shape.kind === 'rect' ? rectToPolygon(shape) : outline, outline };
}

describe('reachOf', () => {
  it('is the old fixed threshold unless told the zoom', () => {
    expect(reachOf(undefined)).toBe(0.3);
    expect(reachOf({ metres: 0.5 })).toBe(0.5);
  });

  /** Ten pixels is a hair's breadth zoomed out and a yard zoomed in; on screen it is the same. */
  it('scales a pixel reach by the zoom', () => {
    expect(reachOf({ px: 10, pxPerMetre: 100 })).toBeCloseTo(0.1);
    expect(reachOf({ px: 10, pxPerMetre: 10 })).toBeCloseTo(1);
  });
});

describe('snapPointTo', () => {
  it('returns the raw point, exactly, when snapping is off', () => {
    const raw = { x: 6.07, y: 5.03 };
    expect(snapPointTo(raw, targets, { ...on, enabled: false })).toEqual({
      point: raw,
      source: 'none',
      guides: [],
      marker: null,
    });
  });

  it('prefers a corner over the edge it sits on', () => {
    const result = snapPointTo({ x: 6.1, y: 5.1 }, targets, on);
    expect(result.source).toBe('vertex');
    expect(result.point).toEqual({ x: 6, y: 5 });
  });

  it('lands on the middle of a wall', () => {
    const result = snapPointTo({ x: 10.1, y: 4.9 }, targets, on);
    expect(result.source).toBe('midpoint');
    expect(result.point).toEqual({ x: 10, y: 5 });
  });

  it('lands on an edge where no corner is near', () => {
    const result = snapPointTo({ x: 7.3, y: 4.8 }, targets, on);
    expect(result.source).toBe('edge');
    expect(result.point.y).toBeCloseTo(5);
    expect(result.point.x).toBeCloseTo(7.3);
  });

  it('falls back to a line it is level with, then to the grid', () => {
    const aligned = snapPointTo({ x: 6.2, y: 2.3 }, targets, on);
    expect(aligned.source).toBe('align');
    expect(aligned.point.x).toBe(6);
    expect(aligned.guides).toContainEqual({ axis: 'x', at: 6 });

    const gridded = snapPointTo({ x: 3.3, y: 2.3 }, targets, on);
    expect(gridded.source).toBe('grid');
    expect(gridded.point).toEqual({ x: 3.5, y: 2.5 });
  });

  it('passes over a candidate the caller refuses', () => {
    const result = snapPointTo({ x: 6.1, y: 5.1 }, targets, {
      ...on,
      accept: (point) => !(point.x === 6 && point.y === 5),
    });
    expect(result.source).not.toBe('vertex');
  });

  it('reaches further when zoomed out', () => {
    const raw = { x: 6.6, y: 5.6 };
    expect(snapPointTo(raw, targets, on).source).not.toBe('vertex');
    expect(snapPointTo(raw, targets, { ...on, threshold: { px: 10, pxPerMetre: 10 } }).source).toBe(
      'vertex',
    );
  });

  it('squares a drawn corner to the previous side', () => {
    const vertices = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
    ];
    const result = snapPointTo({ x: 4.2, y: 3.4 }, targets, { ...on, rightAngle: { vertices } });
    expect(result.source).toBe('angle');
    expect(result.point).toEqual({ x: 4, y: 3.5 });
  });
});

describe('rightAnglePoint', () => {
  /** A plot drawn 20° off the screen still has right angles, relative to its own sides. */
  it('turns relative to the previous side, not the screen', () => {
    const angle = (20 * Math.PI) / 180;
    const vertices = [
      { x: 0, y: 0 },
      { x: 5 * Math.cos(angle), y: 5 * Math.sin(angle) },
    ];
    const point = rightAnglePoint(vertices, { x: 3, y: 5 }, { grid: false, unit: 'm' });
    const side = { x: vertices[1]!.x - vertices[0]!.x, y: vertices[1]!.y - vertices[0]!.y };
    const turn = { x: point.x - vertices[1]!.x, y: point.y - vertices[1]!.y };
    expect(side.x * turn.x + side.y * turn.y).toBeCloseTo(0, 9);
  });
});

describe('snapShapeDelta', () => {
  it('pulls a corner onto the house corner', () => {
    const patio = subjectOf({ kind: 'rect', centre: { x: 4.6, y: 3.6 }, width: 3, depth: 3, rotation: 0 });
    const { delta, marker } = snapShapeDelta(patio, targets, on);
    // The patio's bottom-right corner (6.1, 5.1) goes onto the house's top-left (6, 5).
    expect(delta.x).toBeCloseTo(-0.1);
    expect(delta.y).toBeCloseTo(-0.1);
    expect(marker).toEqual({ x: 6, y: 5 });
  });

  /**
   * A house turned 23° has walls at 23°, and an axis alignment cannot put anything flush against
   * one. A corner onto the wall's segment can.
   */
  it('pulls a shape flush against a rotated wall', () => {
    const turned = rectToPolygon({ centre: { x: 10, y: 8 }, width: 8, depth: 6, rotation: 23 });
    const rotatedTargets = snapTargetsFor({ boundary, house: turned });
    const [corner] = turned;
    const wallStart = turned[0]!;
    const wallEnd = turned[1]!;
    // A point a little way along the first wall, pushed 0.2 m off it.
    const along = { x: wallStart.x + (wallEnd.x - wallStart.x) * 0.5, y: wallStart.y + (wallEnd.y - wallStart.y) * 0.5 };
    const normal = { x: -(wallEnd.y - wallStart.y), y: wallEnd.x - wallStart.x };
    const length = Math.hypot(normal.x, normal.y);
    const off = { x: along.x + (normal.x / length) * 0.2, y: along.y + (normal.y / length) * 0.2 };
    expect(corner).toBeTruthy();

    const bed: ShapeSubject = { corners: [off], outline: [off] };
    const { delta } = snapShapeDelta(bed, rotatedTargets, { ...on, threshold: { metres: 0.3 } });
    const landed = { x: off.x + delta.x, y: off.y + delta.y };
    const cross =
      (wallEnd.x - wallStart.x) * (landed.y - wallStart.y) - (wallEnd.y - wallStart.y) * (landed.x - wallStart.x);
    expect(Math.abs(cross) / Math.hypot(wallEnd.x - wallStart.x, wallEnd.y - wallStart.y)).toBeLessThan(1e-9);
  });

  it('keeps the old axis alignment for a shape nothing touches', () => {
    const patio = subjectOf({ kind: 'rect', centre: { x: 7.35, y: 2.5 }, width: 3, depth: 2, rotation: 0 });
    const { delta, guides } = snapShapeDelta(patio, targets, on);
    expect(delta.x).toBeCloseTo(0.15);
    expect(guides.some((guide) => guide.axis === 'x')).toBe(true);
  });

  it('never pulls into what the caller refuses, and does nothing when off', () => {
    const patio = subjectOf({ kind: 'rect', centre: { x: 4.6, y: 3.6 }, width: 3, depth: 3, rotation: 0 });
    expect(snapShapeDelta(patio, targets, { ...on, accept: () => false }).delta).toEqual({ x: 0, y: 0 });
    expect(snapShapeDelta(patio, targets, { ...on, enabled: false }).delta).toEqual({ x: 0, y: 0 });
  });
});

describe('snapTargetsFor', () => {
  it('offers a base fill for alignment but not its corners — its edges are zone seams', () => {
    const lawn: DesignElement = {
      id: 'g1',
      category: 'lawn',
      role: 'fill',
      fillKind: 'base',
      zone: 'back',
      shape: { kind: 'rect', centre: { x: 3, y: 12 }, width: 4, depth: 4, rotation: 0 },
    };
    const withLawn = snapTargetsFor({ boundary, house, elements: [lawn] });
    expect(withLawn.points.length).toBe(targets.points.length);
    expect(withLawn.lines.x.length).toBeGreaterThan(targets.lines.x.length);
  });
});
