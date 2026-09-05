'use client';

import { Circle, Group, Line, Rect, Shape, Text } from 'react-konva';
import {
  BOUNDARY_HEIGHTS,
  BOUNDARY_THICKNESS,
  DEFAULT_BOUNDARY_KIND,
  type BoundaryRun,
  type Point,
} from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { metresToPx, pxToMetres, type CanvasTransform } from '@/lib/canvas-transform';
import { gridSteps, niceStep } from '@/lib/grid';
import { SIZE_ANCHOR_CAR, type AlignmentGuide, type DimensionGuide } from '@/lib/guides';
import { FENCE_SHADE_OPACITY } from '@/lib/materials/light';
import {
  boundaryBand,
  BOUNDARY_PALETTE,
  crownInset,
  inGap,
  inwardNormal,
  MIN_BAND_PX,
  ringIsClockwise,
  runPosts,
} from '@/lib/materials/symbols/boundary';
import { fenceShadeBands } from '@/lib/materials/symbols/property';
import { formatLength, fromDisplay, type Unit } from '@/lib/units';

/**
 * The pieces of canvas furniture that are not about any one thing being drawn: graph paper,
 * the scale bar, the zoom stack's buttons, dimension lines and the little white number chips.
 *
 * These are shared by the boundary editor and the existing-features editor. Two copies of the
 * grid would be two ladders of step sizes, and the moment they disagreed the two screens would
 * stop measuring the same garden the same way.
 */

/**
 * A round number of units wide, so the bar reads "1 m" rather than "0.83 m" at any zoom.
 *
 * The grid square size is written underneath because the grid is the thing the user actually
 * measures against while drawing, and until now nothing on screen said how big one square was —
 * which is most of how a plot ends up drawn ten times too large. The two numbers are allowed to
 * differ: the bar takes the largest step that fits in 110 px and the grid the largest that fits
 * in 40, so the caption names its own step rather than assuming the bar's.
 */
export function ScaleBar({ transform, unit }: { transform: CanvasTransform; unit: Unit }) {
  // Same ladder the grid uses, so the bar always measures a whole number of grid boxes.
  const step = niceStep(transform.scale, unit, 110);
  const widthPx = fromDisplay(step, unit) * transform.scale;
  const square = gridSteps(transform.scale, unit).minor;

  return (
    <div data-testid="scale-bar" className="absolute bottom-4 left-4 text-[11px] text-garden-muted">
      <span>{`${step} ${unit}`}</span>
      <span
        aria-hidden
        style={{ width: Math.max(widthPx, 12) }}
        className="mt-1 block border-x border-b border-garden-muted"
      >
        <span className="block h-1.5" />
      </span>
      <span data-testid="grid-square-size" className="mt-1 block">
        {`${square} ${unit} squares`}
      </span>
    </div>
  );
}

export function ZoomButton({
  label,
  testId,
  pressed,
  onClick,
  children,
}: {
  label: string;
  testId: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      className={[
        'p-2 text-garden-ink not-last:border-b not-last:border-garden-line hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:ring-inset focus-visible:outline-none',
        pressed ? 'bg-garden-sage text-garden-forest' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * Graph paper. The whole point of the grid is that you can measure against it, so the step
 * comes from the same helper the scale bar uses and is expressed in whatever unit the user is
 * reading. Every fifth line is heavier so the eye can count boxes without losing its place.
 */
export function SquareGrid({
  transform,
  unit,
  width,
  height,
}: {
  transform: CanvasTransform;
  unit: Unit;
  width: number;
  height: number;
}) {
  return (
    <Shape
      sceneFunc={(context) => {
        const steps = gridSteps(transform.scale, unit);
        const minor = fromDisplay(steps.minor, unit);
        const major = fromDisplay(steps.major, unit);

        const topLeft = pxToMetres({ x: 0, y: 0 }, transform);
        const bottomRight = pxToMetres({ x: width, y: height }, transform);
        const columns = Math.ceil((bottomRight.x - topLeft.x) / minor) + 1;
        const rows = Math.ceil((bottomRight.y - topLeft.y) / minor) + 1;

        // Guard against a pathological loop if the viewport is ever extreme.
        if (columns + rows > 4000) return;

        const draw = (step: number, colour: string, lineWidth: number) => {
          context.beginPath();
          context.strokeStyle = colour;
          context.lineWidth = lineWidth;

          const firstX = Math.floor(topLeft.x / step) * step;
          for (let x = firstX; x <= bottomRight.x; x += step) {
            const at = metresToPx({ x, y: 0 }, transform).x;
            context.moveTo(at, 0);
            context.lineTo(at, height);
          }

          const firstY = Math.floor(topLeft.y / step) * step;
          for (let y = firstY; y <= bottomRight.y; y += step) {
            const at = metresToPx({ x: 0, y }, transform).y;
            context.moveTo(0, at);
            context.lineTo(width, at);
          }

          context.stroke();
        };

        draw(minor, COLOUR.gridMinor, 1);
        draw(major, COLOUR.gridMajor, 1);
      }}
    />
  );
}

/**
 * A dashed dimension line with arrowheads and its distance written at the midpoint — the
 * "2.7 m from this wall to that fence" readouts.
 */
export function MeasurementGuides({
  guides,
  transform,
  unit,
  showLabels = true,
}: {
  guides: DimensionGuide[];
  transform: CanvasTransform;
  unit: Unit;
  showLabels?: boolean;
}) {
  return (
    <>
      {guides.map((guide) => {
        const from = metresToPx(guide.from, transform);
        const to = metresToPx(guide.to, transform);
        // Too short to draw legibly; the number would sit on top of both arrowheads.
        if (Math.hypot(to.x - from.x, to.y - from.y) < 24) return null;

        const angle = Math.atan2(to.y - from.y, to.x - from.x);

        return (
          <Group key={guide.id} listening={false}>
            <Line
              points={[from.x, from.y, to.x, to.y]}
              stroke={COLOUR.measurement}
              strokeWidth={1}
              dash={[5, 4]}
            />
            <Arrowhead at={from} angle={angle + Math.PI} />
            <Arrowhead at={to} angle={angle} />
            {showLabels ? (
              <Label
                at={{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }}
                text={formatLength(guide.distance, unit)}
              />
            ) : null}
          </Group>
        );
      })}
    </>
  );
}

/**
 * The property boundary, drawn as whatever each side is actually made of.
 *
 * Purely presentation — the geometry is the same boundary polygon everything else measures and
 * validates against, and nothing here is fed back into it. It exists because a garden is an
 * enclosed thing: a 2 px green outline reads as the edge of a diagram, where a wall or a hedge
 * reads as the end of the garden, which is what the plan is actually depicting.
 *
 * **Per run, not per polygon.** This used to draw one close-boarded fence round every plot,
 * because that was the only thing it could draw. `boundaryRuns` resolves each side to its own
 * kind — the stored style if the user has described that side, a fence if not — so a plot with a
 * brick wall on one side and an open frontage on another looks like that plot and not like every
 * other one.
 *
 * Bands are metres and posts are spaced in metres, so both stay a real size as the user zooms —
 * the same rule the paving joints follow. Below `MIN_POST_SPACING_PX` apart the posts are dropped:
 * a solid line of them is noise, and at that zoom the band alone says everything.
 */
export function FenceLine({
  polygon,
  runs,
  transform,
  light,
  gaps,
}: {
  polygon: Point[];
  /**
   * One entry per side, from `boundaryRuns(site)`. Omitted draws the whole polygon as the default
   * fence, which is what the thumbnails and any caller without a site want.
   */
  runs?: BoundaryRun[];
  transform: CanvasTransform;
  /**
   * Unit vector towards the light. Given, the panels the sun is behind throw a strip of shade
   * into the garden — the contact-shadow convention, not the cast layer, so it appears whether
   * or not the plan knows where it is. Omitted draws no shade, which is what step 1 and 2 want.
   */
  light?: Point;
  /** Gates: the run is broken and no post stands in the gap. From `gateGaps`. */
  gaps?: [Point, Point][];
}) {
  if (polygon.length < 3) return null;

  const shade = light ? fenceShadeBands(polygon, light) : [];
  const gapList = gaps ?? [];
  const clockwise = ringIsClockwise(polygon);
  const resolved = runs ?? defaultRuns(polygon);

  const toPx = (point: Point) => metresToPx(point, transform);
  const flat = (points: Point[]) => points.flatMap((point) => {
    const at = toPx(point);
    return [at.x, at.y];
  });

  const gapPx = gapList.map(([a, b]) => {
    const from = toPx(a);
    const to = toPx(b);
    return [from.x, from.y, to.x, to.y];
  });

  return (
    <Group listening={false}>
      {shade.map((band, index) => (
        <Line
          key={`shade-${index}`}
          points={flat(band)}
          closed
          fill={COLOUR.fenceShade}
          opacity={FENCE_SHADE_OPACITY}
        />
      ))}

      {resolved.map((run) => {
        const palette = BOUNDARY_PALETTE[run.kind];
        const inward = inwardNormal(run, clockwise);
        const band = boundaryBand(run, inward);
        const bandPx = run.thickness * transform.scale;

        /*
         * Thin enough that a filled band would be a wash of anti-aliasing, or a kind with no body
         * at all: stroked as a line instead. The threshold is on the drawn width rather than on
         * the kind, so a railing becomes a line before a wall does — which is correct, because it
         * genuinely is thinner.
         */
        const asLine = palette.dashed || bandPx < MIN_BAND_PX;

        const postRadius = Math.max(1.2, Math.min(3.2, transform.scale * 0.05));
        const posts = palette.detail
          ? runPosts(
              run,
              transform.scale,
              { x: (inward.x * run.thickness) / 2, y: (inward.y * run.thickness) / 2 },
              crownInset(run),
            ).filter((post) => !inGap(post, gapList))
          : [];

        return (
          <Group key={run.edgeVertexId}>
            {asLine ? (
              <Line
                points={flat([run.start, run.end])}
                stroke={palette.body}
                strokeWidth={palette.dashed ? 1.5 : 2.5}
                dash={palette.dashed ? [6, 5] : undefined}
                lineCap="round"
              />
            ) : (
              <Line points={flat(band)} closed fill={palette.body} />
            )}

            {/* A wall's coping: the light line along the top that says masonry rather than timber. */}
            {palette.cap && !asLine ? (
              <Line
                points={flat([
                  { x: run.start.x + inward.x * run.thickness, y: run.start.y + inward.y * run.thickness },
                  { x: run.end.x + inward.x * run.thickness, y: run.end.y + inward.y * run.thickness },
                ])}
                stroke={palette.cap}
                strokeWidth={Math.max(1, bandPx * 0.3)}
              />
            ) : null}

            {posts.map((post, index) => {
              const at = toPx(post);
              /* A hedge's "posts" are its crowns, so they are round and overlap into a mass. */
              const isHedge = run.kind === 'hedge';
              const radius = isHedge
                ? Math.max(postRadius, (run.thickness * transform.scale) / 2)
                : postRadius;

              return isHedge ? (
                <Circle
                  key={index}
                  x={at.x}
                  y={at.y}
                  radius={radius}
                  fill={palette.detail ?? undefined}
                  opacity={0.75}
                />
              ) : (
                <Rect
                  key={index}
                  x={at.x - postRadius}
                  y={at.y - postRadius}
                  width={postRadius * 2}
                  height={postRadius * 2}
                  fill={palette.detail ?? undefined}
                  cornerRadius={0.5}
                />
              );
            })}
          </Group>
        );
      })}

      {/* The gaps: the run painted out for the width of each gate. */}
      {gapPx.map((segment, index) => (
        <Line
          key={`gap-${index}`}
          points={segment}
          stroke="#ffffff"
          strokeWidth={5}
          lineCap="butt"
        />
      ))}
    </Group>
  );
}

/**
 * Every side as the default fence, for a caller with a polygon but no site.
 *
 * Thumbnails and the brief screen's property sketch draw a boundary without ever loading the
 * styles; giving them the default here means they get the drawing they always had rather than a
 * special case, and means `runs` can stay optional.
 */
function defaultRuns(polygon: Point[]): BoundaryRun[] {
  const runs: BoundaryRun[] = [];

  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i]!;
    const end = polygon[(i + 1) % polygon.length]!;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 1e-6) continue;

    runs.push({
      edgeVertexId: `edge-${i}`,
      start,
      end,
      kind: DEFAULT_BOUNDARY_KIND,
      height: BOUNDARY_HEIGHTS[DEFAULT_BOUNDARY_KIND],
      thickness: BOUNDARY_THICKNESS[DEFAULT_BOUNDARY_KIND],
      length,
    });
  }

  return runs;
}

/**
 * A real object drawn to scale beside the plan, as something to judge the drawing against.
 *
 * Deliberately not clamped to a minimum size. If the car is three pixels wide the plot is far too
 * large, and drawing that faithfully is more useful than keeping the car legible.
 */
export function SizeAnchor({
  at,
  transform,
  unit,
}: {
  at: Point;
  transform: CanvasTransform;
  unit: Unit;
}) {
  const origin = metresToPx(at, transform);
  const width = SIZE_ANCHOR_CAR.width * transform.scale;
  const depth = SIZE_ANCHOR_CAR.depth * transform.scale;

  // Below a pixel there is nothing to see and the cabin inset would invert.
  if (width < 1) return null;

  return (
    <Group listening={false} opacity={0.55}>
      <Rect
        x={origin.x}
        y={origin.y}
        width={width}
        height={depth}
        cornerRadius={Math.min(depth / 3, width / 6)}
        stroke={COLOUR.measurement}
        strokeWidth={1}
      />
      {/* The cabin, so the outline reads as a car rather than as another rectangle. */}
      {width > 24 ? (
        <Rect
          x={origin.x + width * 0.28}
          y={origin.y + depth * 0.16}
          width={width * 0.42}
          height={depth * 0.68}
          cornerRadius={Math.min(depth / 5, width / 12)}
          stroke={COLOUR.measurement}
          strokeWidth={1}
        />
      ) : null}
      <Text
        x={origin.x}
        y={origin.y + depth + 3}
        text={`Car · ${formatLength(SIZE_ANCHOR_CAR.width, unit)} long`}
        fontSize={10}
        fill={COLOUR.measurement}
      />
    </Group>
  );
}

export function Arrowhead({ at, angle }: { at: Point; angle: number }) {
  const size = 5;
  const wing = 0.5;

  return (
    <Line
      points={[
        at.x - Math.cos(angle - wing) * size,
        at.y - Math.sin(angle - wing) * size,
        at.x,
        at.y,
        at.x - Math.cos(angle + wing) * size,
        at.y - Math.sin(angle + wing) * size,
      ]}
      stroke={COLOUR.measurement}
      strokeWidth={1}
      listening={false}
    />
  );
}

/** A white chip carrying a number, sized to its text so it never clips. */
export function Label({ at, text, tone }: { at: Point; text: string; tone?: string }) {
  const width = text.length * 6.4 + 12;

  return (
    <Group x={at.x} y={at.y} listening={false}>
      <Rect
        x={-width / 2}
        y={-9}
        width={width}
        height={18}
        cornerRadius={4}
        fill="#ffffff"
        stroke={COLOUR.gridMajor}
        strokeWidth={1}
      />
      <Text
        text={text}
        fontSize={11}
        fill={tone ?? COLOUR.houseInk}
        width={width}
        offsetX={width / 2}
        offsetY={-4}
        align="center"
      />
    </Group>
  );
}

/**
 * The fine dotted lines that flash when a shape comes into agreement with something else — a
 * wall level with a fence, or two features' centres lining up. Full width or full height, so the
 * eye can follow the agreement right across the plan.
 */
export function AlignmentLines({
  guides,
  transform,
  width,
  height,
}: {
  guides: AlignmentGuide[];
  transform: CanvasTransform;
  width: number;
  height: number;
}) {
  return (
    <>
      {guides.map((guide) => {
        const at = metresToPx({ x: guide.at, y: guide.at }, transform);

        return (
          <Line
            key={`${guide.axis}-${guide.at}`}
            points={guide.axis === 'x' ? [at.x, 0, at.x, height] : [0, at.y, width, at.y]}
            stroke={COLOUR.alignment}
            strokeWidth={1}
            dash={[2, 4]}
            opacity={0.8}
            listening={false}
          />
        );
      })}
    </>
  );
}
