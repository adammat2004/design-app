import {
  boundaryRuns,
  boundingBox,
  elementCentreline,
  elementOutline,
  housePolygon,
  insetPolygon,
  patternAnchor,
  resolvedGates,
  shadowCast,
  shadowOccluders,
  streetEdge,
  streetOutward,
  type BoundaryRun,
  type DesignElement,
  type HouseFootprint,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import { COLOUR } from '../canvas-colours';
import { CATEGORY_COLOURS } from '../concept-colours';
import { materialFill } from '../material-colours';
import {
  canopiesForSymbol,
  CONTACT_SHADOW_SPRITE,
  SYMBOL_SPRITES,
} from './assets/material-assets';
import type { LoadedAsset } from './assets/registry';
import {
  CONTACT_SHADOW_ALPHA,
  CONTACT_SHADOW_OFFSET_RATIO,
  CONTACT_SHADOW_SCALE,
  FENCE_SHADE_OPACITY,
  LIGHT_DIRECTION,
  SHADOW_OPACITY,
  SHADOW_TONE,
} from './light';
import {
  boundaryBand,
  BOUNDARY_PALETTE,
  crownInset,
  inwardNormal,
  MIN_BAND_PX,
  ringIsClockwise,
  runPosts,
} from './symbols/boundary';
import {
  fenceShadeBands,
  houseGroundShadow,
  HOUSE_SHADOW_ALPHA,
  STREET_KERB_OFFSET,
  WALL_THICKNESS,
} from './symbols/property';
import { MIN_DRAWN_SYMBOL_PX } from './lod';
import { resolvePattern } from './palette';
import { drawShadowLayer } from './render-shadow-layer';
import {
  drawSurfacePattern,
  type DrawPass,
  type MakeCanvas,
  type PatternCanvas,
  type PatternContext,
} from './render-surface-pattern';
import {
  beamLines,
  canopyCrown,
  canopyRing,
  canopySpriteBox,
  firePitRings,
  MIN_TRUNK_PX,
  trunkAndCanopy,
} from './symbols/canopy';
import { drawSymbol, MIN_STRUCTURE_DETAIL_PX } from './symbols/draw-symbol';

/**
 * A whole plan, drawn into one 2D context.
 *
 * The Konva canvases draw a plan as a tree of React nodes, and for the screen that is right. But
 * four other things need the same picture as pixels — the concept card on step 4, the PNG the user
 * downloads, the judging sheet `render:plan` writes, and later the image a hero render is
 * conditioned on — and each of them drawing its own version is how step 4 came to contradict
 * step 5 the first time. This is the one place the stacking order is written down as code that
 * runs outside React:
 *
 * ```
 *   ground ─▶ fills (base, then accent) ─▶ cast shadows ─▶ features ─▶ house ─▶ fence
 *             └── drawSurfacePattern ──┘    (one layer,      ├── surfaces (same painter)
 *                                            composited       ├── paths
 *                                            once)            └── symbols: trees, fire pits, beams
 * ```
 *
 * It obeys the renderer's one rule: **no authority.** Everything here is handed an outline that
 * `geometryOutline` already produced, and the only decisions it makes are about pixels. Nothing
 * downstream reads what it draws.
 *
 * A context rather than a canvas, for the reason `drawSurfacePattern` takes one: jsdom cannot
 * make a 2D context, so the tests hand in `@napi-rs/canvas` and the browser hands in the DOM's.
 */

/** What is drawn. A subset of the document, in the frame every canvas already uses. */
export interface PlanScene {
  boundary: Point[];
  house: HouseFootprint | null;
  elements: DesignElement[];
  /** Read only for its sun. `location: null` means no shadow layer is drawn at all. */
  site: SiteSection;
}

/** The composer needs to composite a layer, which the surface painter never does. */
export interface PlanContext extends PatternContext {
  drawImage(image: PatternCanvas, dx: number, dy: number): void;
  drawImage(image: PatternCanvas, dx: number, dy: number, dw: number, dh: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  lineJoin: string;
  lineCap: string;
  /** Optional: the street's kerb is dashed where the context can, solid where it cannot. */
  setLineDash?(segments: number[]): void;
}

export interface PlanPass extends DrawPass {
  /** For the shadow sub-layer, which must be filled opaque on its own and composited once. */
  makeCanvas: MakeCanvas;
}

/** A neutral ground for the plot — the same tint the canvases fill the boundary with. */
export const PLOT_GROUND = '#eef3ea';

/** A trunk seen from above: dark, and the same on every tree because bark at 1:100 is one tone. */
const TRUNK_TONE = '#4a3a2c';

/**
 * Draws the scene.
 *
 * `rasterOrigin` is the world point the context's `(0, 0)` is, so a caller can draw a plan with a
 * margin round it (the sheets) or flush (a thumbnail) without this function knowing which.
 */
export function drawPlan(
  context: PlanContext,
  scene: PlanScene,
  pass: PlanPass,
  rasterOrigin: Point,
): void {
  const { boundary, house } = scene;
  if (boundary.length < 3) return;

  const { pxPerMetre } = pass;
  const light = pass.light ?? LIGHT_DIRECTION;
  const toPx = (point: Point): Point => ({
    x: (point.x - rasterOrigin.x) * pxPerMetre,
    y: (point.y - rasterOrigin.y) * pxPerMetre,
  });

  const elements = scene.elements.filter((element) => !element.hidden);
  const seam = firstFeatureIndex(elements);

  context.save();

  /* The ground, clipped to the plot; everything else is drawn inside this clip. */
  tracePath(context, boundary, toPx);
  context.clip();
  context.fillStyle = PLOT_GROUND;
  context.fill();

  for (const element of elements.slice(0, seam)) {
    drawElement(context, element, pass, light, toPx, rasterOrigin);
  }

  drawShadows(context, scene, pass, toPx);

  for (const element of elements.slice(seam)) {
    drawElement(context, element, pass, light, toPx, rasterOrigin);
  }

  context.restore();

  /* The house sits above the planting so a bed can run right up to the wall. */
  if (house) drawHouse(context, house, pass, toPx);

  drawFence(context, boundary, boundaryRuns(scene.site), pxPerMetre, light, toPx);
  drawAccess(context, scene.site, pxPerMetre, toPx);
}

/**
 * Gates as gaps in the fence with the leaf standing open, and a kerb outside the street edge.
 * The same resolvers `GateMarks` draws from, so a sheet and the screen agree about the fence.
 */
function drawAccess(
  context: PlanContext,
  site: SiteSection,
  pxPerMetre: number,
  toPx: (point: Point) => Point,
): void {
  const street = streetEdge(site);
  const outward = streetOutward(site);
  if (street && outward) {
    const a = toPx({
      x: street[0].x + outward.x * STREET_KERB_OFFSET,
      y: street[0].y + outward.y * STREET_KERB_OFFSET,
    });
    const b = toPx({
      x: street[1].x + outward.x * STREET_KERB_OFFSET,
      y: street[1].y + outward.y * STREET_KERB_OFFSET,
    });
    context.save();
    context.setLineDash?.([8, 5]);
    context.lineWidth = 2;
    context.strokeStyle = COLOUR.measurement;
    context.globalAlpha = 0.8;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();
    context.globalAlpha = 1;
  }

  for (const { segment, inward } of resolvedGates(site)) {
    const from = toPx(segment[0]);
    const to = toPx(segment[1]);

    // The gap: the rail painted out in paper for the width of the gate.
    context.lineWidth = 6;
    context.lineCap = 'butt';
    context.strokeStyle = PLOT_GROUND;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();

    // The leaf standing open into the garden, and the quarter arc it swings through.
    const width = Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y);
    const hinge = segment[0];
    const open = toPx({ x: hinge.x + inward.x * width, y: hinge.y + inward.y * width });
    context.lineWidth = 1.5;
    context.strokeStyle = COLOUR.fencePost;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(open.x, open.y);
    context.stroke();

    context.beginPath();
    const along = { x: (segment[1].x - hinge.x) / width, y: (segment[1].y - hinge.y) / width };
    for (let step = 0; step <= 12; step += 1) {
      const t = step / 12;
      // Sweep from the closed leaf (along the fence) round to the open one (inward).
      const dir = {
        x: along.x * Math.cos((Math.PI / 2) * t) + inward.x * Math.sin((Math.PI / 2) * t),
        y: along.y * Math.cos((Math.PI / 2) * t) + inward.y * Math.sin((Math.PI / 2) * t),
      };
      const at = toPx({ x: hinge.x + dir.x * width, y: hinge.y + dir.y * width });
      if (step === 0) context.moveTo(at.x, at.y);
      else context.lineTo(at.x, at.y);
    }
    context.lineWidth = 1;
    context.globalAlpha = 0.7;
    context.stroke();
    context.globalAlpha = 1;
  }
}

/** Where the shadow layer is spliced in: after every fill, before every feature. */
export function firstFeatureIndex(elements: DesignElement[]): number {
  const index = elements.findIndex((element) => element.role === 'feature');
  return index === -1 ? elements.length : index;
}

/* ---------------------------------------------------------------- elements */

function drawElement(
  context: PlanContext,
  element: DesignElement,
  pass: DrawPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const { shape } = element;

  if (shape.kind === 'point') {
    // A fire pit bowl or a parasol: a sprite on a point, before the drawn symbols get a look in.
    if (drawSymbol(context, element, pass.pxPerMetre, light, pass.assets, toPx)) return;
    drawPointSymbol(context, element, pass, light, toPx, rasterOrigin);
    return;
  }

  const outline = elementOutline(element);
  if (outline.length < 3) return;

  /*
   * A path is its strip — the same ribbon the validator checks — painted like any other surface,
   * so stepping stones are stones set in grass rather than a grey stroke. It used to be a stroke,
   * which never reached the painter and drew every path as a flat lozenge.
   */
  if (shape.kind === 'polyline') {
    drawSurface(context, element, outline, pass, light, toPx, rasterOrigin);
    return;
  }

  /*
   * Furniture is its sprite and nothing else: no surface under it, because the surface it stands
   * on is the element beneath. Only when the sprite is missing does it fall back to a flat block,
   * so a table is never invisible.
   */
  if (element.category === 'furniture') {
    if (!drawSymbol(context, element, pass.pxPerMetre, light, pass.assets, toPx)) {
      drawSurface(context, element, outline, pass, light, toPx, rasterOrigin);
    }
    return;
  }

  drawSurface(context, element, outline, pass, light, toPx, rasterOrigin);

  if (drawSymbol(context, element, pass.pxPerMetre, light, pass.assets, toPx)) return;

  if (element.category === 'structure' && shape.kind === 'rect') {
    // A structure with no symbol: the beams that told a pergola from a plain block before symbols.
    if (Math.min(shape.width, shape.depth) * pass.pxPerMetre >= MIN_STRUCTURE_DETAIL_PX) {
      context.strokeStyle = CATEGORY_COLOURS.structure.stroke;
      context.lineWidth = 1.5;
      for (const [from, to] of beamLines(shape.centre, shape.width, shape.depth, shape.rotation)) {
        const a = toPx(from);
        const b = toPx(to);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
    }
  }
}

/**
 * A surface: its material's pattern when it has one, a flat fill when it does not. Exactly the
 * pair of paths `ElementDrawing` takes, with the same painter behind the first.
 */
function drawSurface(
  context: PlanContext,
  element: DesignElement,
  outline: Point[],
  pass: DrawPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const manifest = resolvePattern(element.material);

  if (manifest) {
    drawSurfacePattern(
      context,
      outline,
      manifest,
      patternAnchor(element),
      element.id,
      {
        pxPerMetre: pass.pxPerMetre,
        light,
        assets: pass.assets,
        makeCanvas: pass.makeCanvas,
        // A path lays its stepping stones along its own line, not across its bounding box.
        centreline: elementCentreline(element) ?? undefined,
        // A bed's planting scheme is a property of the bed, so the layer stack needs the element.
        element,
      },
      rasterOrigin,
    );
  } else {
    tracePath(context, outline, toPx);
    context.fillStyle = materialFill(element);
    context.fill();
  }

  // Fills get no outline — see `ElementDrawing`: a hairline round each zone is a seam across the lawn.
  if (element.role === 'fill') return;

  tracePath(context, outline, toPx);
  context.lineWidth = 1.75;
  context.lineJoin = 'round';
  context.strokeStyle = CATEGORY_COLOURS[element.category].stroke;
  context.stroke();
}

/** The point symbols, from the same pure geometry the Konva `PointSymbol` draws. */
function drawPointSymbol(
  context: PlanContext,
  element: DesignElement,
  pass: DrawPass,
  light: Point,
  toPx: (point: Point) => Point,
  rasterOrigin: Point,
): void {
  const { shape } = element;
  if (shape.kind !== 'point') return;

  const { pxPerMetre } = pass;
  const centre = toPx(shape.at);
  const radiusPx = shape.radius * pxPerMetre;

  if (radiusPx < 8) {
    context.beginPath();
    context.arc(centre.x, centre.y, Math.max(MIN_DRAWN_SYMBOL_PX, radiusPx), 0, Math.PI * 2);
    context.fillStyle = materialFill(element);
    context.fill();
    return;
  }

  if (element.category === 'planting-bed') {
    const canopies = pass.assets
      ? canopiesForSymbol(element.symbol).flatMap((id) => pass.assets!(id))
      : [];
    if (canopies.length > 0) {
      const shadow = pass.assets!(CONTACT_SHADOW_SPRITE)[0] ?? null;
      drawCanopySprite(context, element, canopies, shadow, centre, radiusPx, light);
      return;
    }

    const tone = CATEGORY_COLOURS['planting-bed'];
    traceCurve(context, canopyRing(shape.at, shape.radius, element.id), toPx);
    context.fillStyle = tone.fill;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = tone.stroke;
    context.stroke();

    traceCurve(context, canopyCrown(shape.at, shape.radius, element.id), toPx);
    context.globalAlpha = 0.22;
    context.fillStyle = '#ffffff';
    context.fill();
    context.globalAlpha = 1;
    return;
  }

  // The disc itself: the material over the circle the geometry tessellates it to.
  drawSurface(context, element, elementOutline(element), pass, light, toPx, rasterOrigin);

  /*
   * The drawn bowl and flame stand in only while there is no fire-pit sprite to place: once the
   * bowl is a piece of furniture inside the bark circle, a glyph on the circle as well is two fire
   * pits drawn on one.
   */
  const bowlSprite = pass.assets?.(SYMBOL_SPRITES['fire-pit']!) ?? [];
  if (element.category === 'gravel-mulch' && bowlSprite.length === 0) {
    const { rim, flame } = firePitRings(shape.at, shape.radius);

    tracePath(context, rim, toPx);
    context.lineWidth = 1.5;
    context.strokeStyle = '#8a7358';
    context.stroke();

    traceCurve(context, flame, toPx, 0.2);
    context.fillStyle = '#e08a3c';
    context.fill();
  }
}

/**
 * A tree as a photographed canopy, inscribed in its radius and standing on a contact shadow.
 *
 * The same sprite the Konva canvas draws, from the same seeded choice, so a sheet and the screen
 * show the same tree. The shadow convention is the scatter painter's: proportional to the thing,
 * pushed away from the pass's light, never a claim about the time of day.
 */
function drawCanopySprite(
  context: PlanContext,
  element: DesignElement,
  canopies: LoadedAsset[],
  shadow: LoadedAsset | null,
  centre: Point,
  radiusPx: number,
  light: Point,
): void {
  const { shape } = element;
  if (shape.kind !== 'point') return;

  const box = canopySpriteBox(
    shape.at,
    radiusPx,
    element.id,
    canopies.length,
    (variant) => canopies[variant]?.entry.opaqueRadiusRatio ?? 1,
  );
  const sprite = canopies[box.variant]!;

  if (shadow) {
    const reach = radiusPx * CONTACT_SHADOW_SCALE;
    const offset = radiusPx * CONTACT_SHADOW_OFFSET_RATIO;
    context.globalAlpha = CONTACT_SHADOW_ALPHA;
    context.drawImage(
      shadow.image as PatternCanvas,
      centre.x - light.x * offset - reach,
      centre.y - light.y * offset - reach,
      reach * 2,
      reach * 2,
    );
    context.globalAlpha = 1;
  }

  /*
   * The trunk, and the canopy nudged off it.
   *
   * A canopy drawn concentric with its own point is a green disc lying on the grass — nothing in
   * the drawing says the leaves are six metres up. A small dark trunk on the element's *recorded*
   * point, with the canopy shifted a little away from the light, reads as parallax and is the
   * oldest cue in landscape drawing. The trunk stays put and the canopy moves, never the reverse:
   * the point is where the placer put the tree and where the validator checked it.
   */
  const stand = trunkAndCanopy(centre, radiusPx, light);

  if (radiusPx >= MIN_TRUNK_PX) {
    context.beginPath();
    context.arc(stand.trunk.x, stand.trunk.y, stand.trunkRadius, 0, Math.PI * 2);
    context.fillStyle = TRUNK_TONE;
    context.fill();
  }

  const { width, height } = sprite.image;
  const scale = (box.halfWidth * 2) / Math.max(width, height);

  context.save();
  context.translate(stand.canopy.x, stand.canopy.y);
  context.rotate(box.rotation);
  context.drawImage(
    sprite.image as PatternCanvas,
    (-width * scale) / 2,
    (-height * scale) / 2,
    width * scale,
    height * scale,
  );
  context.restore();
}

/* ---------------------------------------------------------------- shadows */

/**
 * The cast-shadow layer, at the same seam the canvases splice it in.
 *
 * Drawn into a canvas of its own and composited once, for the reason `SHADOW_TONE` gives: two
 * overlapping shadows are one shadow, and only an opaque layer drawn at a single opacity gets
 * that right. The sub-canvas covers the plot, not the shadows, so the frame the sheets draw at
 * 09:00 and the one at 19:00 have their pixels in the same places.
 */
function drawShadows(
  context: PlanContext,
  scene: PlanScene,
  pass: PlanPass,
  toPx: (point: Point) => Point,
): void {
  const cast = shadowCast(scene.site);
  if (!cast) return;

  const occluders = shadowOccluders(scene.elements, scene.house, boundaryRuns(scene.site));
  if (occluders.length === 0) return;

  const box = boundingBox(scene.boundary);
  const widthPx = Math.max(1, Math.ceil(box.width * pass.pxPerMetre));
  const heightPx = Math.max(1, Math.ceil(box.length * pass.pxPerMetre));

  const layer = pass.makeCanvas(widthPx, heightPx);
  const layerContext = layer.getContext('2d');
  if (!layerContext) return;

  const originMetres = { x: box.minX, y: box.minY };
  drawShadowLayer(
    layerContext,
    occluders,
    cast,
    scene.boundary,
    { pxPerMetre: pass.pxPerMetre },
    originMetres,
  );

  const at = toPx(originMetres);
  context.globalAlpha = SHADOW_OPACITY;
  context.drawImage(layer, at.x, at.y);
  context.globalAlpha = 1;
}

/* ---------------------------------------------------------------- property */

/**
 * The house as a building: a wall of real thickness round a floor, the way `HouseShape` draws it.
 * The outline is the geometry of record; the inset is derived here, every time.
 */
function drawHouse(
  context: PlanContext,
  house: HouseFootprint,
  pass: PlanPass,
  toPx: (point: Point) => Point,
): void {
  const outline = housePolygon(house);
  if (outline.length < 3) return;

  const interior = insetPolygon(outline, WALL_THICKNESS);

  /*
   * The shadow first, so the building stands on the garden rather than beside it. Drawn here
   * rather than in the cast-shadow layer because it is unconditional — the cast layer only exists
   * when the plan knows where on Earth it is, and a house has to look like a house either way.
   */
  context.save();
  context.globalAlpha = HOUSE_SHADOW_ALPHA;
  tracePath(context, houseGroundShadow(outline, pass.light ?? LIGHT_DIRECTION), toPx);
  context.fillStyle = SHADOW_TONE;
  context.fill();
  context.restore();

  tracePath(context, outline, toPx);
  context.fillStyle = interior ? COLOUR.houseWall : COLOUR.houseFill;
  context.fill();
  context.lineWidth = 1.5;
  context.lineJoin = 'round';
  context.strokeStyle = COLOUR.houseStroke;
  context.stroke();

  if (!interior) return;

  /*
   * The inside of the building, left deliberately plain.
   *
   * This used to be tiled with a photograph of pale oak flooring. A landscape plan does not show a
   * building's interior finishes, and drawing one had a specific cost: the eye parsed a large
   * warm-toned timber field as another garden surface — a deck — so the house became the brightest
   * and most textured object in a drawing whose subject is the garden. A quiet neutral recedes,
   * which is the whole job. The wall band round it is what says "building", and the openings drawn
   * into that band are what the layout grammar reads.
   */
  tracePath(context, interior, toPx);
  context.fillStyle = COLOUR.houseFill;
  context.fill();
}

/** Post spacing along the fence, in metres — the same figure `FenceLine` defaults to. */
export const FENCE_POST_SPACING = 1.8;

/**
 * The boundary as a fence: a rail with posts at real intervals, dropped when they would crowd.
 * A port of `FenceLine`, so a sheet and the screen agree about what the edge of the garden is.
 */
function drawFence(
  context: PlanContext,
  boundary: Point[],
  runs: BoundaryRun[],
  pxPerMetre: number,
  light: Point,
  toPx: (point: Point) => Point,
): void {
  // The shade under the panels the sun is behind, clipped to the plot like everything else.
  context.save();
  tracePath(context, boundary, toPx);
  context.clip();
  context.globalAlpha = FENCE_SHADE_OPACITY;
  context.fillStyle = COLOUR.fenceShade;
  for (const band of fenceShadeBands(boundary, light)) {
    tracePath(context, band, toPx);
    context.fill();
  }
  context.globalAlpha = 1;
  context.restore();

  /*
   * Per run, so a plot with a wall on one side and railings on another draws as that plot. The
   * geometry and the palette both come from `symbols/boundary.ts`, shared with `FenceLine` — two
   * renderers working the same thing out separately is exactly how they drift.
   */
  const clockwise = ringIsClockwise(boundary);

  for (const run of runs) {
    const palette = BOUNDARY_PALETTE[run.kind];
    const inward = inwardNormal(run, clockwise);
    const bandPx = run.thickness * pxPerMetre;
    const asLine = palette.dashed || bandPx < MIN_BAND_PX;

    if (asLine) {
      context.beginPath();
      const from = toPx(run.start);
      const to = toPx(run.end);
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.lineWidth = palette.dashed ? 1.5 : 2.5;
      context.lineJoin = 'round';
      context.strokeStyle = palette.body;
      context.stroke();
    } else {
      tracePath(context, boundaryBand(run, inward), toPx);
      context.fillStyle = palette.body;
      context.fill();

      // A wall's coping: the light line along the top that says masonry rather than timber.
      if (palette.cap) {
        const inner = (point: Point) => ({
          x: point.x + inward.x * run.thickness,
          y: point.y + inward.y * run.thickness,
        });
        const from = toPx(inner(run.start));
        const to = toPx(inner(run.end));
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.lineWidth = Math.max(1, bandPx * 0.3);
        context.strokeStyle = palette.cap;
        context.stroke();
      }
    }

    if (!palette.detail) continue;

    const postRadius = Math.max(1.2, Math.min(3.2, pxPerMetre * 0.05));
    const posts = runPosts(
      run,
      pxPerMetre,
      { x: (inward.x * run.thickness) / 2, y: (inward.y * run.thickness) / 2 },
      crownInset(run),
    );

    context.fillStyle = palette.detail;

    for (const post of posts) {
      const at = toPx(post);

      if (run.kind === 'hedge') {
        // A hedge's "posts" are its crowns: round, overlapping, and read as one mass.
        const radius = Math.max(postRadius, bandPx / 2);
        context.save();
        context.globalAlpha = 0.75;
        context.beginPath();
        traceCircle(context, at, radius);
        context.fill();
        context.restore();
      } else {
        context.fillRect(at.x - postRadius, at.y - postRadius, postRadius * 2, postRadius * 2);
      }
    }
  }
}

/** A circle as a path, for the hedge crowns. The context has no `arc`, so it is traced. */
function traceCircle(context: PlanContext, centre: Point, radius: number): void {
  const segments = 12;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = centre.x + Math.cos(angle) * radius;
    const y = centre.y + Math.sin(angle) * radius;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

/* ---------------------------------------------------------------- paths */

function tracePath(context: PatternContext, ring: Point[], toPx: (point: Point) => Point): void {
  context.beginPath();
  ring.forEach((point, index) => {
    const at = toPx(point);
    if (index === 0) context.moveTo(at.x, at.y);
    else context.lineTo(at.x, at.y);
  });
  context.closePath();
}

/**
 * A closed ring through its points as a smooth curve — what Konva's `tension` does to a `Line`.
 *
 * Quadratic curves through the midpoints between successive vertices, which is a simpler spline
 * than Konva's Catmull-Rom but rounds the same lobes. The canopy is a symbol, not geometry, so the
 * two drawings need to agree in character rather than in pixels.
 */
function traceCurve(
  context: PatternContext,
  ring: Point[],
  toPx: (point: Point) => Point,
  tension = 0.35,
): void {
  if (ring.length < 3) return;
  const points = ring.map(toPx);
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  context.beginPath();
  const start = mid(points[points.length - 1]!, points[0]!);
  context.moveTo(start.x, start.y);

  for (let i = 0; i < points.length; i += 1) {
    const control = points[i]!;
    const next = points[(i + 1) % points.length]!;
    const end = mid(control, next);
    // Tension pulls the curve towards the vertex; 0 would run straight between midpoints.
    const cx = end.x + (control.x - end.x) * (0.5 + tension);
    const cy = end.y + (control.y - end.y) * (0.5 + tension);
    context.quadraticCurveTo(cx, cy, end.x, end.y);
  }

  context.closePath();
}
