'use client';

import { Circle, Group, Line } from 'react-konva';
import type { Point } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementOutline, type DesignElement } from '@/lib/concepts';
import { materialFill, useSurfacePattern } from '@/lib/materials';
import { beamLines, canopyCrown, canopyRing, firePitRings } from '@/lib/materials/symbols/canopy';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';

/**
 * What one layout element looks like. Nothing about how it behaves.
 *
 * There used to be two of these — one in the editor and one in `ConceptCanvas` — and they had
 * already drifted: the editor drew a material's texture while step 4 still drew a flat category
 * colour, so the screen where the user *chooses* a concept showed something the next screen
 * contradicted. One component for both canvases is the only way that stays fixed.
 *
 * Interaction stays with the caller. The editor wraps this in a draggable group parked on the
 * element's anchor so a drag can read the node's own position; step 4 renders it inert at the
 * origin. `offsetPx` is how the two are reconciled: everything is computed in stage pixels and then
 * shifted into whatever frame the caller's group is in.
 */
export function ElementDrawing({
  element,
  transform,
  offsetPx = ORIGIN,
  light,
}: {
  element: DesignElement;
  transform: CanvasTransform;
  /** Where the caller's group sits, in stage pixels. Zero when drawing absolutely. */
  offsetPx?: Point;
  /**
   * Unit vector towards the light. Omitted falls back to the conventional drawing light, which
   * is what a thumbnail or a plan with no location gets.
   *
   * Passed in rather than read from a store, because everything below the single hook in
   * `lib/materials` is a pure function of data and reaching into state here would end that.
   */
  light?: Point;
}) {
  const style = CATEGORY_COLOURS[element.category];
  const fill = materialFill(element);
  const pattern = useSurfacePattern(element, transform.scale, light);
  const { shape } = element;
  const isFill = element.role === 'fill';

  const at = (point: Point): Point => {
    const px = metresToPx(point, transform);
    return { x: px.x - offsetPx.x, y: px.y - offsetPx.y };
  };

  const toPx = (points: Point[]): number[] =>
    points.flatMap((point) => {
      const { x, y } = at(point);
      return [x, y];
    });

  const common = {
    fill,
    stroke: style.stroke,
    strokeWidth: isFill ? 1 : 1.75,
  };

  /*
   * A point is not a surface. Which symbol it becomes is decided by category and geometry kind
   * together, which needs no schema change: `ElementCategory` stays the closed seven-value enum,
   * and a tree is simply what a planting bed looks like when it is a point rather than a region.
   */
  if (shape.kind === 'point') {
    return (
      <PointSymbol
        element={element}
        radiusPx={shape.radius * transform.scale}
        centre={at(shape.at)}
        toPx={toPx}
        common={common}
      />
    );
  }

  if (shape.kind === 'polyline') {
    return (
      <Line
        points={toPx(shape.points)}
        stroke={fill}
        strokeWidth={Math.max(3, shape.width * transform.scale)}
        lineCap="round"
        lineJoin="round"
      />
    );
  }

  /*
   * Konva fills a shape with a pattern natively, which does the clipping, keeps the fill as the hit
   * region and leaves the stroke on top — all three of which a separate clipped image would have to
   * reproduce by hand. `fill` stays underneath as the fallback for the frame before a raster exists.
   * The transform is translate-then-scale, so the raster's top-left lands on `fillPatternX/Y`.
   */
  const patternFill = pattern
    ? ({
        // Konva types this as HTMLImageElement but hands it to createPattern, which takes a canvas.
        fillPatternImage: pattern.image as unknown as HTMLImageElement,
        fillPatternX: at(pattern.originMetres).x,
        fillPatternY: at(pattern.originMetres).y,
        fillPatternScaleX: pattern.scale,
        fillPatternScaleY: pattern.scale,
        fillPatternRepeat: 'no-repeat',
        fillPriority: 'pattern',
      } as const)
    : null;

  return (
    <Group>
      <Line
        {...common}
        {...patternFill}
        points={toPx(elementOutline(element))}
        closed
        lineJoin="round"
      />
      {element.category === 'structure' && shape.kind === 'rect' ? (
        <Beams
          centre={shape.centre}
          width={shape.width}
          depth={shape.depth}
          rotation={shape.rotation}
          scale={transform.scale}
          toPx={toPx}
        />
      ) : null}
    </Group>
  );
}

const ORIGIN: Point = { x: 0, y: 0 };

/* ---------------------------------------------------------------- symbols */

interface CommonStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

function PointSymbol({
  element,
  radiusPx,
  centre,
  toPx,
  common,
}: {
  element: DesignElement;
  radiusPx: number;
  centre: Point;
  toPx: (points: Point[]) => number[];
  common: CommonStyle;
}) {
  const shape = element.shape;
  if (shape.kind !== 'point') return null;

  // Too small to read as anything but a dot; a canopy at four pixels is noise, not a tree.
  if (radiusPx < 8) {
    return <Circle {...common} x={centre.x} y={centre.y} radius={Math.max(3, radiusPx)} />;
  }

  if (element.category === 'planting-bed') {
    const tone = CATEGORY_COLOURS['planting-bed'];

    return (
      <Group>
        <Line
          points={toPx(canopyRing(shape.at, shape.radius, element.id))}
          closed
          tension={0.35}
          fill={tone.fill}
          stroke={tone.stroke}
          strokeWidth={1}
        />
        {/* The lit crown, same sun as every slab bevel. */}
        <Line
          points={toPx(canopyCrown(shape.at, shape.radius, element.id))}
          closed
          tension={0.35}
          fill="#ffffff"
          opacity={0.22}
          listening={false}
        />
      </Group>
    );
  }

  if (element.category === 'gravel-mulch') {
    const { rim, flame } = firePitRings(shape.at, shape.radius);

    return (
      <Group>
        <Circle {...common} x={centre.x} y={centre.y} radius={radiusPx} />
        <Line points={toPx(rim)} closed stroke="#8a7358" strokeWidth={1.5} listening={false} />
        <Line points={toPx(flame)} closed tension={0.2} fill="#e08a3c" listening={false} />
      </Group>
    );
  }

  return <Circle {...common} x={centre.x} y={centre.y} radius={radiusPx} />;
}

/** Beams across a pergola, so a structure stops reading as a plain tan rectangle. */
function Beams({
  centre,
  width,
  depth,
  rotation,
  scale,
  toPx,
}: {
  centre: Point;
  width: number;
  depth: number;
  rotation: number;
  scale: number;
  toPx: (points: Point[]) => number[];
}) {
  // Below this the beams merge into a solid block and are worse than drawing nothing.
  if (Math.min(width, depth) * scale < 40) return null;

  return (
    <Group listening={false}>
      {beamLines(centre, width, depth, rotation).map((beam, index) => (
        <Line
          key={index}
          points={toPx(beam)}
          stroke={CATEGORY_COLOURS.structure.stroke}
          strokeWidth={1.5}
          opacity={0.55}
        />
      ))}
    </Group>
  );
}
