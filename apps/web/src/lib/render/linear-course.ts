import type { Point } from '@garden-studio/schema';
import type { RenderSurface } from './scene';

export interface CourseUnit {
  id: string;
  row: number;
  index: number;
  start: number;
  end: number;
  at: Point;
  tangent: Point;
  outline: Point[];
}

export interface LinearCourse {
  points: Point[];
  outline: Point[];
  width: number;
  length: number;
  moduleLength: number;
  joint: number;
  /** Phase is measured from the authored start, in metres; never from the viewport. */
  phase: number;
  closed: boolean;
  units: CourseUnit[];
}

const EPSILON = 1e-7;
const MAX_UNITS = 12000;

export function courseMeasure(points: Point[]) {
  const clean = points.filter((point, i) => i === 0 || Math.hypot(
    point.x - points[i - 1]!.x, point.y - points[i - 1]!.y,
  ) > EPSILON);
  const stations = [0];
  for (let i = 1; i < clean.length; i++) {
    stations.push(stations[i - 1]! + Math.hypot(
      clean[i]!.x - clean[i - 1]!.x, clean[i]!.y - clean[i - 1]!.y,
    ));
  }
  return { points: clean, stations, length: stations.at(-1) ?? 0 };
}

export function courseSample(measure: ReturnType<typeof courseMeasure>, distance: number) {
  const { points, stations, length } = measure;
  if (points.length < 2) return { at: points[0] ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  const d = Math.max(0, Math.min(length, distance));
  let lo = 0, hi = stations.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (stations[mid]! <= d) lo = mid; else hi = mid;
  }
  const a = points[lo]!, b = points[lo + 1]!;
  const span = stations[lo + 1]! - stations[lo]!;
  const tangent = { x: (b.x - a.x) / span, y: (b.y - a.y) / span };
  return { at: { x: a.x + tangent.x * (d - stations[lo]!), y: a.y + tangent.y * (d - stations[lo]!) }, tangent };
}

/** Constant-width render-only strip. Miter to 2x offset, then bevel; butt caps at open ends. */
export function courseStrip(points: Point[], lower: number, upper: number, closed = false): Point[] {
  const ring = closed ? points.slice(0, -1) : points;
  if (ring.length < 2) return [];
  const normal = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  };
  const side = (offset: number) => ring.flatMap((point, i) => {
    const before = ring[i - 1] ?? (closed ? ring.at(-1)! : null);
    const after = ring[i + 1] ?? (closed ? ring[0]! : null);
    const a = before ? normal(before, point) : normal(point, after!);
    const b = after ? normal(point, after) : a;
    const denominator = 1 + a.x * b.x + a.y * b.y;
    const x = denominator > EPSILON ? (a.x + b.x) / denominator : Infinity;
    const y = denominator > EPSILON ? (a.y + b.y) / denominator : Infinity;
    if (Math.hypot(x, y) <= 2) return [{ x: point.x + x * offset, y: point.y + y * offset }];
    return [{ x: point.x + a.x * offset, y: point.y + a.y * offset },
      { x: point.x + b.x * offset, y: point.y + b.y * offset }];
  });
  const left = side(upper), right = side(lower);
  // A closed strip needs a seam joining the outer and inner loops, not a filled disc.
  if (closed) { left.push(left[0]!); right.push(right[0]!); }
  return [...left, ...right.reverse()];
}

export function compileLinearCourse(surface: RenderSurface): LinearCourse | null {
  if (!surface.centreline || surface.element.shape.kind !== 'polyline') return null;
  const pattern = surface.material?.pattern;
  if (!pattern || (pattern.patternType !== 'grid' && pattern.patternType !== 'board')) return null;
  const measure = courseMeasure(surface.centreline);
  const width = surface.element.shape.width;
  if (measure.length <= EPSILON || width <= EPSILON) return null;
  const moduleLength = pattern.moduleSize.w / 1000;
  const joint = Math.min(pattern.jointWidth / 1000, moduleLength / 3);
  const moduleWidth = pattern.moduleSize.h / 1000;
  if (moduleLength <= EPSILON || moduleWidth <= EPSILON) return null;
  const rows = Math.max(1, Math.ceil(width / moduleWidth));
  const pitch = moduleLength + joint;
  const count = Math.ceil(measure.length / pitch);
  const units: CourseUnit[] = [];
  const first = measure.points[0]!, last = measure.points.at(-1)!;
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < EPSILON;
  const outline = courseStrip(measure.points, -width / 2, width / 2, closed);
  if (count * rows > MAX_UNITS) return { ...measure, outline, width, moduleLength, joint, phase: 0, closed, units };
  for (let row = 0; row < rows; row++) {
    const rowWidth = Math.min(moduleWidth, width - row * moduleWidth);
    const offset = -width / 2 + row * moduleWidth + rowWidth / 2;
    for (let index = 0; index < count; index++) {
      const start = index * pitch + (index === 0 ? 0 : joint / 2);
      const end = Math.min(measure.length, (index + 1) * pitch - joint / 2);
      if (end - start <= EPSILON) continue;
      const middle = courseSample(measure, (start + end) / 2);
      const line = [courseSample(measure, start).at,
        ...measure.points.filter((_p, i) => measure.stations[i]! > start + EPSILON && measure.stations[i]! < end - EPSILON),
        courseSample(measure, end).at];
      const half = Math.max(rowWidth - (rows > 1 ? joint : 0), 0.005) / 2;
      const outline = courseStrip(line, offset - half, offset + half);
      units.push({ id: `${surface.elementId}:course:${row}:${index}`, row, index, start, end,
        at: { x: middle.at.x - middle.tangent.y * offset, y: middle.at.y + middle.tangent.x * offset },
        tangent: middle.tangent, outline });
    }
  }
  return { points: measure.points, outline, length: measure.length, width, moduleLength, joint, phase: 0, closed, units };
}
