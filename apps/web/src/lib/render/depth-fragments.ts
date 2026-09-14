import { shadowOccluders, type Point } from '@garden-studio/schema';
import { boundaryBand } from '../materials/symbols/boundary';
import { depthOf, extrude, liftRing, visualBounds } from './projection';
import type { RenderExtrusionNode, RenderNode } from './scene';

/** Split open pergolas into actual posts and overhead members, using their shadow geometry. */
export function structureContributions(node: RenderNode, light: Point): RenderNode[] {
  if (node.kind !== 'extrusion' || node.source.of !== 'element' || node.source.element.symbol !== 'pergola') return [node];
  const element = node.source.element;
  const casters = shadowOccluders([element], null);
  if (!casters.length) return [node];
  return casters.map((caster, index): RenderExtrusionNode => {
    const baseHeight = caster.baseHeight ?? 0;
    const base = baseHeight ? liftRing(caster.outline, baseHeight) : caster.outline;
    return { ...node, id: `${node.id}:${baseHeight ? 'beam' : 'post'}:${index}`,
      contribution: baseHeight ? 'beam' : 'post',
      depth: baseHeight ? node.depth + 0.0001 : depthOf(caster.outline),
      bounds: visualBounds(caster.outline, caster.height),
      extrusion: extrude(base, caster.height - baseHeight, light) };
  });
}

/**
 * Every segment retains its original run for post/skin phase. Artificial cut faces are discarded.
 * Horizontal runs already have one depth, so splitting them buys nothing and only adds seams.
 */
export function boundaryContributions(node: RenderNode, light: Point): RenderNode[] {
  if (node.kind !== 'extrusion' || node.source.of !== 'boundary') return [node];
  const { run, inward } = node.source;
  const dx = run.end.x - run.start.x, dy = run.end.y - run.start.y;
  if (Math.abs(dy) < 0.5 || Math.hypot(dx, dy) < 2) return [node];
  const count = Math.ceil(Math.hypot(dx, dy) / 1.5);
  const at = (t: number) => ({ x: run.start.x + dx * t, y: run.start.y + dy * t });
  return Array.from({ length: count }, (_unused, index): RenderExtrusionNode => {
    const segment = { ...run, start: at(index / count), end: at((index + 1) / count), length: run.length / count };
    const outline = boundaryBand(segment, inward);
    const extrusion = extrude(outline, run.height, light);
    extrusion.faces = extrusion.faces.filter((face) => node.extrusion.faces.some((original) =>
      Math.abs(face.normal.x - original.normal.x) < 1e-5 && Math.abs(face.normal.y - original.normal.y) < 1e-5));
    for (const face of extrusion.faces) {
      const original = node.extrusion.faces.find((candidate) =>
        Math.abs(face.normal.x - candidate.normal.x) < 1e-5 && Math.abs(face.normal.y - candidate.normal.y) < 1e-5)!;
      face.skinOffset = Math.hypot(face.base[0].x - original.base[0].x, face.base[0].y - original.base[0].y);
    }
    const bounds = visualBounds(outline, run.height);
    return { ...node, id: `${node.id}:segment:${index}`, contribution: 'boundary-segment', parentRun: run,
      depth: Math.min(...outline.map((point) => point.y)),
      bounds: { minX: bounds.minX - 0.06, minY: bounds.minY - 0.06, width: bounds.width + 0.12, length: bounds.length + 0.12 },
      extrusion, source: { of: 'boundary', inward, run: segment } };
  });
}
