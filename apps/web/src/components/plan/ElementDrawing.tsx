'use client';

import { useMemo } from 'react';
import { Circle, Group, Image as KonvaImage, Line } from 'react-konva';
import { rectToPolygon, resolveSymbol, type Point } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementOutline, type DesignElement } from '@/lib/concepts';
import { materialFill, useSurfacePattern } from '@/lib/materials';
import {
  canopiesForSymbol,
  CONTACT_SHADOW_SPRITE,
  SYMBOL_SPRITES,
} from '@/lib/materials/assets/material-assets';
import { getAssetVariants, type LoadedAsset } from '@/lib/materials/assets/registry';
import { useAssetVersion } from '@/lib/materials/assets/use-assets';
import {
  CONTACT_SHADOW_ALPHA,
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
  LIGHT_DIRECTION,
} from '@/lib/materials/light';
import {
  beamLines,
  canopyCrown,
  canopyRing,
  canopySpriteBox,
  firePitRings,
  MIN_TRUNK_PX,
  trunkAndCanopy,
} from '@/lib/materials/symbols/canopy';
import {
  MIN_STRUCTURE_DETAIL_PX,
  ROOF_ALPHA,
  roofTones,
} from '@/lib/materials/symbols/draw-symbol';
import { symbolSprite } from '@/lib/materials/symbols/sprites';
import {
  facesLight,
  gardenRoomParts,
  gazeboRoof,
  glazingBars,
  pergolaPosts,
  raisedBedRails,
  rectNormal,
  shedRoof,
} from '@/lib/materials/symbols/structures';
import type { ElementPass } from '@/lib/materials/scene-passes';
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
  interacting = false,
  part = 'all',
  exclusions,
  cutEdge,
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
  /**
   * Whether this element is being dragged or resized right now.
   *
   * Only the editor ever passes it — step 4 draws inert. It caps the surface's detail for the
   * duration of the gesture, because a moving outline misses the raster cache on every frame.
   */
  interacting?: boolean;
  part?: ElementPass;
  exclusions?: Point[][];
  /** Which outline segments carry the cut edge, decided by the scene; absent means all. */
  cutEdge?: boolean[];
}) {
  const style = CATEGORY_COLOURS[element.category];
  const fill = materialFill(element);
  const pattern = useSurfacePattern(element, transform.scale, light, interacting, exclusions, cutEdge);
  const { shape } = element;

  // Re-renders once, when the sprites arrive; until then a symbol draws its procedural self.
  const assetVersion = useAssetVersion();
  const sprite = useMemo(
    () => symbolSprite(element, getAssetVariants),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version is what changes the answer
    [element, assetVersion],
  );

  const at = (point: Point): Point => {
    const px = metresToPx(point, transform);
    return { x: px.x - offsetPx.x, y: px.y - offsetPx.y };
  };

  const toPx = (points: Point[]): number[] =>
    points.flatMap((point) => {
      const { x, y } = at(point);
      return [x, y];
    });

  /*
   * Fills get no outline. They used to have a hairline in the category colour, which was fine
   * around a pale flat surface and became a pale seam across the lawn the moment the lawn was a
   * photograph cut into zones. Their edge is the cut edge the painter draws, or nothing.
   */
  const common = {
    fill,
    stroke: style.stroke,
    strokeWidth: 0,
  };

  /*
   * A point is not a surface. Which symbol it becomes is decided by category and geometry kind
   * together, which needs no schema change: `ElementCategory` stays the closed seven-value enum,
   * and a tree is simply what a planting bed looks like when it is a point rather than a region.
   */
  if (part === 'object') {
    return (
      <Group>
        <Line points={toPx(elementOutline(element))} closed fill="#000" opacity={0} />
        <SymbolDrawing
          element={element}
          transform={transform}
          at={at}
          light={light}
          sprite={sprite}
        />
      </Group>
    );
  }

  if (shape.kind === 'point' && part !== 'ground') {
    // A fire pit bowl or a parasol: a sprite on a point, over an invisible circle to grab it by.
    if (sprite) {
      return (
        <Group>
          <Circle
            x={at(shape.at).x}
            y={at(shape.at).y}
            radius={shape.radius * transform.scale}
            fill="#000000"
            opacity={0}
          />
          <SymbolDrawing
            element={element}
            transform={transform}
            at={at}
            light={light}
            sprite={sprite}
          />
        </Group>
      );
    }

    return (
      <PointSymbol
        element={element}
        radiusPx={shape.radius * transform.scale}
        centre={at(shape.at)}
        toPx={toPx}
        common={common}
        light={light ?? LIGHT_DIRECTION}
        disc={
          pattern
            ? {
                points: toPx(elementOutline(element)),
                fill: {
                  fillPatternImage: pattern.image as unknown as HTMLImageElement,
                  fillPatternX: at(pattern.originMetres).x,
                  fillPatternY: at(pattern.originMetres).y,
                  fillPatternScaleX: pattern.scale,
                  fillPatternScaleY: pattern.scale,
                  fillPatternRepeat: 'no-repeat',
                  fillPriority: 'pattern',
                },
              }
            : null
        }
      />
    );
  }

  /*
   * A path is its strip — `elementOutline` tessellates the polyline to the same ribbon the
   * validator checks — painted like any other surface, so stepping stones are stones set in grass.
   * It used to be a stroke, which never reached the painter and drew every path as a grey lozenge.
   * Below a few pixels wide the strip is too thin to pattern and a stroke says more.
   */
  if (shape.kind === 'polyline' && shape.width * transform.scale < 3) {
    return (
      <Line
        points={toPx(shape.points)}
        stroke={fill}
        strokeWidth={3}
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

  /*
   * Furniture is its sprite: no surface under it, because the surface it stands on is the element
   * beneath. The outline stays as an invisible hit region so it can be picked up and moved, and
   * becomes a flat block only while the sprite is missing.
   */
  if (element.category === 'furniture') {
    return (
      <Group>
        <Line
          {...common}
          points={toPx(elementOutline(element))}
          closed
          lineJoin="round"
          opacity={sprite ? 0 : 1}
        />
        <SymbolDrawing
          element={element}
          transform={transform}
          at={at}
          light={light}
          sprite={sprite}
        />
      </Group>
    );
  }

  return (
    <Group>
      <Line
        {...common}
        {...patternFill}
        points={toPx(elementOutline(element))}
        closed
        lineJoin="round"
      />
      {part !== 'ground' ? (
        <SymbolDrawing
          element={element}
          transform={transform}
          at={at}
          light={light}
          sprite={sprite}
        />
      ) : null}
    </Group>
  );
}

const ORIGIN: Point = { x: 0, y: 0 };

/** A trunk seen from above. Matches the composer's, so screen and export draw one tree. */
const TRUNK_TONE = '#4a3a2c';

/* ---------------------------------------------------------------- symbols */

/**
 * What an element's symbol adds over its surface: a sprite, or the drawn posts and roofs.
 *
 * The React half of `draw-symbol.ts`, from the same pure geometry, so the screen and the composer
 * agree. Konva nodes rather than a raster because these are few and the editor selects and drags
 * them; the surface under them is still the cached raster.
 */
function SymbolDrawing({
  element,
  transform,
  at,
  light,
  sprite,
}: {
  element: DesignElement;
  transform: CanvasTransform;
  at: (point: Point) => Point;
  light: Point | undefined;
  sprite: ReturnType<typeof symbolSprite>;
}) {
  const lit = light ?? LIGHT_DIRECTION;
  const { shape } = element;
  const scale = transform.scale;

  if (sprite) {
    const { box, asset } = sprite;
    const centre = at(box.centre);
    const width = box.width * scale;
    const height = box.height * scale;
    const radius = Math.max(width, height) / 2;
    const shadow = getAssetVariants(CONTACT_SHADOW_SPRITE)[0] ?? null;
    const reach = radius * CONTACT_SHADOW_SCALE;
    const offset = radius * CONTACT_SHADOW_OFFSET_RATIO;

    return (
      <Group listening={false}>
        {shadow ? (
          <KonvaImage
            image={shadow.image as HTMLImageElement}
            x={centre.x - lit.x * offset - reach}
            y={centre.y - lit.y * offset - reach}
            width={reach * 2}
            height={reach * 2}
            opacity={CONTACT_SHADOW_ALPHA}
          />
        ) : null}
        <KonvaImage
          image={asset.image as HTMLImageElement}
          x={centre.x}
          y={centre.y}
          width={width}
          height={height}
          offsetX={width / 2}
          offsetY={height / 2}
          rotation={box.rotation}
        />
      </Group>
    );
  }

  const symbol = resolveSymbol(element);
  if (shape.kind !== 'rect') return null;
  /*
   * A kept existing feature is a rect with no symbol. Its fill is the translucent keep-status
   * green, not a hex — parsing it as one took the concept canvas down. Same early-out as
   * `drawSymbol`: nothing to add over the surface unless this is a structure.
   */
  if (!symbol && element.category !== 'structure') return null;

  const ringPoints = (ring: Point[]) => ring.flatMap((p) => [at(p).x, at(p).y]);

  switch (symbol) {
    case 'pergola': {
      if (Math.min(shape.width, shape.depth) * scale < MIN_STRUCTURE_DETAIL_PX) return null;
      return (
        <Group listening={false}>
          {beamLines(shape.centre, shape.width, shape.depth, shape.rotation).map((beam, index) => (
            <Line
              key={index}
              points={ringPoints(beam)}
              stroke={CATEGORY_COLOURS.structure.stroke}
              strokeWidth={1.5}
              opacity={0.55}
            />
          ))}
          {pergolaPosts(shape).map((post, index) => (
            <Line key={`post-${index}`} points={ringPoints(post)} closed fill={POST_TONE} />
          ))}
        </Group>
      );
    }
    case 'shed': {
      const { lit: litTone, unlit: unlitTone } = roofTones(element);
      const roof = shedRoof(shape);
      const normal = rectNormal(
        shape,
        shape.width >= shape.depth ? { x: 0, y: 1 } : { x: 1, y: 0 },
      );
      const secondLit = facesLight(normal, lit);
      return (
        <Group listening={false}>
          <Line
            points={ringPoints(roof.slopes[0])}
            closed
            fill={secondLit ? unlitTone : litTone}
            opacity={ROOF_ALPHA}
          />
          <Line
            points={ringPoints(roof.slopes[1])}
            closed
            fill={secondLit ? litTone : unlitTone}
            opacity={ROOF_ALPHA}
          />
          <Line
            points={ringPoints(roof.ridge)}
            stroke={CATEGORY_COLOURS.structure.stroke}
            strokeWidth={1.5}
          />
        </Group>
      );
    }
    case 'gazebo': {
      const { lit: litTone, unlit: unlitTone } = roofTones(element);
      const normals: Point[] = [
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ];
      return (
        <Group listening={false}>
          {gazeboRoof(shape).map((facet, index) => (
            <Line
              key={index}
              points={ringPoints(facet)}
              closed
              fill={facesLight(rectNormal(shape, normals[index]!), lit) ? litTone : unlitTone}
              opacity={ROOF_ALPHA}
            />
          ))}
        </Group>
      );
    }
    /*
     * The two glazed buildings. Same geometry as the composer draws, same convention about which
     * face is glass — see `gardenRoomParts`. The `GLASS` and `GLAZING_BAR` tones are repeated here
     * rather than imported because every other case in this switch inlines its colours too, and
     * one exported constant among a dozen literals reads as if it meant something more.
     */
    case 'garden-room': {
      const { lit: litTone, unlit: unlitTone } = roofTones(element);
      const parts = gardenRoomParts(shape);
      const fallNormal = rectNormal(
        shape,
        shape.width >= shape.depth ? { x: 0, y: -1 } : { x: -1, y: 0 },
      );
      const bars = 0.6 * scale >= MIN_GLAZING_BAR_PX;
      const bar = glazingBarPx(scale);

      return (
        <Group listening={false}>
          <Line
            points={ringPoints(parts.plane)}
            closed
            fill={facesLight(fallNormal, lit) ? litTone : unlitTone}
            opacity={ROOF_ALPHA}
          />
          <Line points={ringPoints(parts.glazing)} closed fill={GLASS} />
          <Line points={ringPoints(parts.glazing)} closed stroke={GLAZING_BAR} strokeWidth={bar} />
          {bars
            ? parts.mullions.map((mullion, index) => (
                <Line
                  key={`mullion-${index}`}
                  points={ringPoints(mullion)}
                  stroke={GLAZING_BAR}
                  strokeWidth={bar}
                />
              ))
            : null}
          <Line
            points={ringPoints(parts.high)}
            stroke={CATEGORY_COLOURS.structure.stroke}
            strokeWidth={bar * 1.6}
          />
        </Group>
      );
    }
    case 'greenhouse': {
      const { lit: litTone, unlit: unlitTone } = roofTones(element);
      const roof = shedRoof(shape);
      const normal = rectNormal(
        shape,
        shape.width >= shape.depth ? { x: 0, y: 1 } : { x: 1, y: 0 },
      );
      const secondLit = facesLight(normal, lit);
      const bars = 0.6 * scale >= MIN_GLAZING_BAR_PX;
      const bar = glazingBarPx(scale);

      return (
        <Group listening={false}>
          <Line
            points={ringPoints(roof.slopes[0])}
            closed
            fill={secondLit ? unlitTone : litTone}
            opacity={ROOF_ALPHA}
          />
          <Line
            points={ringPoints(roof.slopes[1])}
            closed
            fill={secondLit ? litTone : unlitTone}
            opacity={ROOF_ALPHA}
          />
          <Line points={ringPoints(roof.slopes[0])} closed fill={GLASS} />
          <Line points={ringPoints(roof.slopes[1])} closed fill={GLASS} />
          {bars
            ? glazingBars(shape).map((line, index) => (
                <Line
                  key={`bar-${index}`}
                  points={ringPoints(line)}
                  stroke={GLAZING_BAR}
                  strokeWidth={bar}
                />
              ))
            : null}
          <Line
            points={ringPoints(rectToPolygon(shape))}
            closed
            stroke={GLAZING_BAR}
            strokeWidth={bar * 1.4}
          />
          <Line
            points={ringPoints(roof.ridge)}
            stroke={CATEGORY_COLOURS.structure.stroke}
            strokeWidth={bar * 1.6}
          />
        </Group>
      );
    }
    case 'raised-bed': {
      const rails = raisedBedRails(shape);
      return (
        <Group listening={false}>
          <Line points={ringPoints(rails.outer)} closed fill={POST_TONE} />
          <Line
            points={ringPoints(rails.inner)}
            closed
            fill={CATEGORY_COLOURS['planting-bed'].fill}
          />
        </Group>
      );
    }
    default:
      if (element.category === 'structure') {
        return (
          <Beams
            centre={shape.centre}
            width={shape.width}
            depth={shape.depth}
            rotation={shape.rotation}
            scale={scale}
            toPx={(points) => points.flatMap((p) => [at(p).x, at(p).y])}
          />
        );
      }
      return null;
  }
}

/** Posts read as darker timber end-grain. The same tone `draw-symbol.ts` uses. */
const POST_TONE = '#5b4a36';

/**
 * Glazing, matching `draw-symbol.ts`. A cool near-white rather than a blue — glass from above is
 * reflected sky, and a saturated blue panel in a garden reads as water.
 */
const GLASS = 'rgba(214, 230, 236, 0.32)';
const GLAZING_BAR = 'rgba(48, 57, 52, 0.7)';

/** Below this the bars stop being divisions and become a grey wash over the whole roof. */
const MIN_GLAZING_BAR_PX = 3;

/** A 30 mm bar, floored at a whole pixel. The twin of `draw-symbol.ts`'s. */
function glazingBarPx(pxPerMetre: number): number {
  return Math.max(1, Math.min(3, 0.03 * pxPerMetre));
}

/* ---------------------------------------------------------------- symbols */

interface CommonStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/** The material's raster, laid over the point's tessellated circle — a disc of water or of bark. */
interface PatternedDisc {
  points: number[];
  fill: Record<string, unknown>;
}

function PointSymbol({
  element,
  radiusPx,
  centre,
  toPx,
  common,
  light,
  disc,
}: {
  element: DesignElement;
  radiusPx: number;
  centre: Point;
  toPx: (points: Point[]) => number[];
  common: CommonStyle;
  light: Point;
  disc: PatternedDisc | null;
}) {
  const shape = element.shape;

  // Re-renders once, when the canopies arrive; until then the drawn ring below stands in.
  const assetVersion = useAssetVersion();
  // Per species: an evergreen draws a conifer, an ornamental a blossom tree, and so on.
  const canopies = useMemo(
    () => canopiesForSymbol(element.symbol, element.plantId).flatMap((id) => getAssetVariants(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the version is what changes the answer
    [assetVersion, element.symbol, element.plantId],
  );

  if (shape.kind !== 'point') return null;

  // Too small to read as anything but a dot; a canopy at four pixels is noise, not a tree.
  if (radiusPx < 8) {
    return <Circle {...common} x={centre.x} y={centre.y} radius={Math.max(3, radiusPx)} />;
  }

  if (element.category === 'planting-bed') {
    if (canopies.length > 0) {
      return (
        <CanopySprite
          element={element}
          canopies={canopies}
          centre={centre}
          radiusPx={radiusPx}
          light={light}
        />
      );
    }

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

  // The disc itself: the material's raster over the circle the geometry tessellates it to, or the
  // flat colour while there is none.
  const body = disc ? (
    <Line {...common} {...disc.fill} points={disc.points} closed lineJoin="round" />
  ) : (
    <Circle {...common} x={centre.x} y={centre.y} radius={radiusPx} />
  );

  // The drawn bowl stands in only while there is no fire-pit sprite: the bowl is furniture now.
  const bowlSprites = getAssetVariants(SYMBOL_SPRITES['fire-pit']!);
  if (element.category === 'gravel-mulch' && bowlSprites.length === 0) {
    const { rim, flame } = firePitRings(shape.at, shape.radius);

    return (
      <Group>
        {body}
        <Line points={toPx(rim)} closed stroke="#8a7358" strokeWidth={1.5} listening={false} />
        <Line points={toPx(flame)} closed tension={0.2} fill="#e08a3c" listening={false} />
      </Group>
    );
  }

  return body;
}

/**
 * A tree as a photographed canopy, inscribed in its radius and standing on a contact shadow.
 *
 * The invisible circle underneath is the hit region — the sprite has holes between its leaves and
 * a tree that could only be grabbed by a leaf would be maddening to move. Same choice of variant
 * and turn as `render-plan.ts`, from the same seeded box, so a sheet and the screen agree.
 */
function CanopySprite({
  element,
  canopies,
  centre,
  radiusPx,
  light,
}: {
  element: DesignElement;
  canopies: LoadedAsset[];
  centre: Point;
  radiusPx: number;
  light: Point;
}) {
  const shape = element.shape;
  if (shape.kind !== 'point') return null;

  const box = canopySpriteBox(
    shape.at,
    radiusPx,
    element.id,
    canopies.length,
    (variant) => canopies[variant]?.entry.opaqueRadiusRatio ?? 1,
  );
  const sprite = canopies[box.variant]!;
  const shadow = getAssetVariants(CONTACT_SHADOW_SPRITE)[0] ?? null;

  const { width, height } = sprite.image;
  const scale = (box.halfWidth * 2) / Math.max(width, height);
  const reach = radiusPx * CONTACT_SHADOW_SCALE;
  const offset = radiusPx * CONTACT_SHADOW_OFFSET_RATIO;
  // A canopy concentric with its own point is a disc lying on the grass; the offset says it is up.
  const stand = trunkAndCanopy(centre, radiusPx, light);

  return (
    <Group>
      <Circle x={centre.x} y={centre.y} radius={radiusPx} fill="#000000" opacity={0} />
      {shadow ? (
        <KonvaImage
          image={shadow.image as HTMLImageElement}
          x={centre.x - light.x * offset - reach}
          y={centre.y - light.y * offset - reach}
          width={reach * 2}
          height={reach * 2}
          opacity={CONTACT_SHADOW_ALPHA}
          listening={false}
        />
      ) : null}
      {/*
        The trunk, on the element's *recorded* point — the one the placer positioned and the
        validator checked. The canopy is what moves; getting it the other way round would put the
        tree's stored position somewhere the drawing does not show it.
      */}
      {radiusPx >= MIN_TRUNK_PX ? (
        <Circle
          x={stand.trunk.x}
          y={stand.trunk.y}
          radius={stand.trunkRadius}
          fill={TRUNK_TONE}
          listening={false}
        />
      ) : null}
      <KonvaImage
        image={sprite.image as HTMLImageElement}
        x={stand.canopy.x}
        y={stand.canopy.y}
        width={width * scale}
        height={height * scale}
        offsetX={(width * scale) / 2}
        offsetY={(height * scale) / 2}
        rotation={(box.rotation * 180) / Math.PI}
        listening={false}
      />
    </Group>
  );
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
