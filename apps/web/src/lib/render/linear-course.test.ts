import { describe, expect, it } from 'vitest';
import { elementOutline, type DesignElement, type Point } from '@garden-studio/schema';
import { resolvePattern } from '../materials/palette';
import { compileLinearCourse, courseMeasure, courseSample, courseStrip } from './linear-course';
import type { RenderSurface } from './scene';
import { COURSE_FIXTURES } from './course-fixtures';

function surface(points: Point[], width = 0.102, material = 'brick-edging'): RenderSurface {
  const element = { id: 'course', role: 'fill', category: 'paved-area', zone: 'back', material,
    shape: { kind: 'polyline', points, width } } as DesignElement;
  return { elementId: element.id, element, outline: elementOutline(element), centreline: points,
    material: resolvePattern(material), anchor: { origin: { x: 0, y: 0 }, rotation: 0 },
    seed: element.id, layers: [], exclusions: null, cutEdge: null };
}

describe('world-space linear courses', () => {
  it('keeps a full-width miter at right-angle joins instead of tapering the course', () => {
    expect(courseStrip([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], -0.1, 0.1)).toEqual([
      { x: 0, y: 0.1 }, { x: 1.9, y: 0.1 }, { x: 1.9, y: 2 },
      { x: 2.1, y: 2 }, { x: 2.1, y: -0.1 }, { x: 0, y: -0.1 },
    ]);
  });
  it('bevels acute joins without an unbounded spike', () => {
    const points = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0.2, y: 0.1 }];
    const outline = courseStrip(points, -0.1, 0.1);
    expect(outline).toHaveLength(8);
    expect(outline.every((p) => p.x >= -0.2 && p.x <= 2.2 && p.y >= -0.2 && p.y <= 0.3)).toBe(true);
  });
  it.each(COURSE_FIXTURES)('keeps the $id prototype bounded, deterministic and forward ordered', ({ points, width, material }) => {
    const input = surface(points, width, material);
    const course = compileLinearCourse(input)!;
    expect(course).toEqual(compileLinearCourse(structuredClone(input)));
    expect(new Set(course.units.map((unit) => unit.id)).size).toBe(course.units.length);
    for (const unit of course.units) {
      expect(unit.start).toBeGreaterThanOrEqual(0);
      expect(unit.end).toBeLessThanOrEqual(course.length);
      expect(unit.end).toBeGreaterThan(unit.start);
      expect(Math.hypot(unit.tangent.x, unit.tangent.y)).toBeCloseTo(1);
      expect(unit.outline.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    }
  });
  it('samples arc length across vertices and ignores duplicate points', () => {
    const measure = courseMeasure([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }]);
    expect(measure.length).toBe(5);
    expect(courseSample(measure, 3)).toEqual({ at: { x: 2, y: 1 }, tangent: { x: 0, y: 1 } });
  });
  it('uses real module and mortar dimensions and clips the final unit at the endpoint', () => {
    const course = compileLinearCourse(surface([{ x: 0, y: 0 }, { x: 1, y: 0 }]))!;
    expect(course.moduleLength).toBe(0.102);
    expect(course.joint).toBe(0.01);
    expect(course.units[1]!.start - course.units[0]!.end).toBeCloseTo(0.01);
    expect(course.units.at(-1)!.end).toBe(1);
    expect(course.units.every((unit) => unit.end > unit.start)).toBe(true);
  });
  it.each(['concrete-kerb', 'sett-edging', 'timber-sleeper'])('lays %s along the local tangent', (material) => {
    const course = compileLinearCourse(surface([{ x: 1, y: 1 }, { x: 1, y: 6 }], 0.1, material))!;
    expect(course.units.every((unit) => Math.abs(unit.tangent.x) < 1e-8 && unit.tangent.y === 1)).toBe(true);
  });
  it('keeps unit IDs and placement independent of zoom and unrelated world geometry', () => {
    const input = surface([{ x: 4, y: 2 }, { x: 6, y: 5 }, { x: 7, y: 5 }]);
    expect(compileLinearCourse(input)).toEqual(compileLinearCourse(structuredClone(input)));
  });
  it('handles closed curves, concave corners, tiny ends and degenerate runs without NaNs', () => {
    const circle = Array.from({ length: 65 }, (_, i) => ({ x: 3 + Math.cos(i / 64 * Math.PI * 2) * 2,
      y: 3 + Math.sin(i / 64 * Math.PI * 2) * 2 }));
    const ring = compileLinearCourse(surface(circle))!;
    expect(ring.closed).toBe(true);
    for (const points of [circle, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1.1, y: 0.3 }, { x: 3, y: 2 }],
      [{ x: 0, y: 0 }, { x: 0.02, y: 0 }]]) {
      const course = compileLinearCourse(surface(points))!;
      expect(course.units.length).toBeGreaterThan(0);
      expect(course.units.flatMap((unit) => unit.outline).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    }
    expect(compileLinearCourse(surface([{ x: 0, y: 0 }, { x: 0, y: 0 }]))).toBeNull();
  });
});
