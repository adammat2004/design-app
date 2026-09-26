import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { elementOutline, type DesignElement, type Point } from '@garden-studio/schema';
import { COURSE_FIXTURES, courseFixtureElements } from '../render/course-fixtures';
import { compileLinearCourse, courseMeasure, courseSample } from '../render/linear-course';
import type { RenderSurface } from '../render/scene';
import { resolvePattern } from './palette';
import { drawLinearCourse } from './render-linear-course';
import type { PatternContext } from './render-surface-pattern';

function raster(element: DesignElement, scale: number) {
  if (element.shape.kind !== 'polyline') throw new Error('Expected a course fixture');
  const surface: RenderSurface = { elementId: element.id, element, outline: elementOutline(element),
    centreline: element.shape.points, material: resolvePattern(element.material),
    anchor: { origin: { x: 0, y: 0 }, rotation: 0 }, seed: element.id, layers: [], exclusions: null,
    cutEdge: null };
  const course = compileLinearCourse(surface)!;
  const canvas = createCanvas(14 * scale, 15 * scale);
  const context = canvas.getContext('2d');
  drawLinearCourse(context as unknown as PatternContext, { surface, course }, { pxPerMetre: scale }, { x: 0, y: 0 });
  return { course, alpha: (point: Point) => context.getImageData(Math.floor(point.x * scale), Math.floor(point.y * scale), 1, 1).data[3] };
}

describe.each([32, 64])('course raster coverage at %i physical pixels/metre', (scale) => {
  it.each(COURSE_FIXTURES.filter((fixture) => fixture.id !== 'short-end'))('has no transparent holes along $id', (fixture) => {
    const element = courseFixtureElements().find((entry) => entry.id === `prototype-${fixture.id}`)!;
    const { course, alpha } = raster(element, scale);
    const measure = courseMeasure(course.points);
    // Mortar is a physical receiver too. Ignore just the antialiased butt-cap pixels.
    for (let distance = 0.05; distance < measure.length - 0.05; distance += 0.025) {
      expect(alpha(courseSample(measure, distance).at), `hole at ${distance.toFixed(3)}m`).toBeGreaterThan(240);
    }
  });
  it('retains a transparent centre inside a closed circular course', () => {
    const element = courseFixtureElements().find((entry) => entry.id === 'prototype-circular')!;
    const { alpha } = raster(element, scale);
    expect(alpha({ x: 3, y: 4 })).toBe(0);
    expect(alpha({ x: 4.5, y: 4 })).toBe(255);
  });
  it('preserves square butt caps on a sub-module endpoint', () => {
    const element = courseFixtureElements().find((entry) => entry.id === 'prototype-short-end')!;
    const { alpha } = raster(element, scale);
    expect(alpha({ x: 1.01, y: 10 })).toBeGreaterThan(240);
    expect(alpha({ x: 0.95, y: 10 })).toBe(0);
    expect(alpha({ x: 1.1, y: 10 })).toBe(0);
  });
});
