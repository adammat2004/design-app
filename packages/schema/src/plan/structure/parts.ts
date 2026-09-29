import { rectToPolygon } from '../../geometry/shapes.js';
import type { Point } from '../../geometry/primitives.js';
import type { ResolvedStructure } from './definitions.js';
import type { StructureFinishId } from './finishes.js';

/**
 * A structure as a list of simple solids: the one geometry every representation of it reads.
 *
 * ## One answer, three drawings
 *
 * The plan draws a pergola's posts and rafters from above, the shadow model casts from them, the web
 * configurator renders them in 3D, and the future AR scene builder will triangulate them into a
 * `solid` node with `boxMesh`. Before this existed the rafter count, post size and beam height were
 * written out separately in four places and had already drifted — the Konva drawing spaced its
 * rafters at 0.6 m while the composer spaced them at 0.35 m. Now there is one list and each consumer
 * draws the parts it can show.
 *
 * ## The frame, and the one rule
 *
 * Local metres, origin on the ground at the rect's centre: **X across the width, Y up, Z along the
 * depth** (the rect's local +y, which is the front). That is the ar-contract's convention with the
 * rect's own rotation not yet applied — right-handed, not mirrored — so a consumer places the whole
 * set with the element's centre, `elevation` and yaw and never moves a part on its own.
 *
 * **Every part lies within the width × depth footprint.** It is what makes "the 3D model cannot
 * occupy different ground from the 2D element" a property rather than a hope, and there is a test on
 * it. The parts are sized *from* the rect; nothing here can make the structure larger than the ground
 * the validator measured.
 *
 * ## A placeholder that is also the production answer for the frame
 *
 * These are boxes and a pyramid, deliberately: this is not a place to model a beautiful gazebo. But a
 * structure is whatever rectangle the placer or the user gave it, so its posts and beams have to be
 * generated from that rectangle whatever model eventually dresses it — a stretched model would put
 * its posts in the wrong places (see `symbols/structures.ts` and the AR architecture note). A GLB
 * can later replace the *look* of a part; it cannot replace where the part is.
 */

export type Vec3 = [number, number, number];

export type StructurePartGroup =
  'post' | 'beam' | 'rafter' | 'roof' | 'side-left' | 'side-right' | 'side-rear' | 'light';

export type StructurePartShape =
  /** A cuboid, axis-aligned in the structure's local frame. `centre` is its middle. */
  | { kind: 'box'; centre: Vec3; size: Vec3 }
  /** A four-sided hipped roof: `base` is its footprint, standing on `y`, rising `rise` to an apex. */
  | { kind: 'pyramid'; centre: Vec3; base: [number, number]; rise: number };

export interface StructurePart {
  /** Stable across builds: a renderer may key on it. */
  id: string;
  group: StructurePartGroup;
  finish: StructureFinishId;
  shape: StructurePartShape;
}

interface FrameStyle {
  /** Post side. */
  post: number;
  /** Beam height and thickness. */
  beamHeight: number;
  beamThickness: number;
}

const CLASSIC: FrameStyle = { post: 0.15, beamHeight: 0.15, beamThickness: 0.1 };
const MODERN: FrameStyle = { post: 0.12, beamHeight: 0.2, beamThickness: 0.12 };

/** A classic pergola's rafters: the plan's long-standing spacing and section. */
const RAFTER_SPACING = 0.35;
const RAFTER_WIDTH = 0.075;
const RAFTER_HEIGHT = 0.15;
/** A modern roof's louvre blades. */
const BLADE_SPACING = 0.16;
const BLADE_WIDTH = 0.12;
const BLADE_HEIGHT = 0.03;
const PANEL_HEIGHT = 0.04;
/** A slatted side screen's boards. */
const BOARD_SPACING = 0.14;
const BOARD_HEIGHT = 0.09;
const BOARD_THICKNESS = 0.025;
const SCREEN_FOOT = 0.15;
const LIGHT_SECTION = 0.03;
/** The lowest a hipped roof's eaves may come down to. */
const MIN_EAVES = 2.1;

/**
 * The parts of a resolved structure.
 *
 * Pure and deterministic: the same element gives the same parts, in the same order, every time.
 * Everything is derived from `width`, `depth` and `height`, which came from the rect and `heightFor`.
 */
export function structureParts(structure: ResolvedStructure): StructurePart[] {
  switch (structure.definition.builder) {
    case 'canopy':
      return canopyParts(structure);
  }
}

/**
 * A pergola or a gazebo: four posts, a frame on top of them, a roof, and optional screens and light.
 *
 * The frame style comes from the model and the roof from the roof kind, independently, so a modern
 * gazebo with a hipped roof and a classic pergola with a solid one are both answers rather than
 * special cases.
 */
function canopyParts(structure: ResolvedStructure): StructurePart[] {
  const { width: w, depth: d, height: H, roof, frame } = structure;
  const style = structure.model === 'modern' ? MODERN : CLASSIC;
  const modern = style === MODERN;
  const roofFinish = roof.finish;
  const parts: StructurePart[] = [];
  const box = (
    id: string,
    group: StructurePartGroup,
    finish: StructureFinishId,
    centre: Vec3,
    size: Vec3,
  ) => {
    if (size.some((side) => side <= 0)) return;
    parts.push({ id, group, finish, shape: { kind: 'box', centre, size } });
  };

  /*
   * Where the frame tops out, and what sits above it.
   *
   * A hipped roof sits on the frame, so the frame stops at its eaves and the ridge is the overall
   * height — the height the user set is the height of the whole structure, which is the number a
   * planning officer would ask about. A slatted classic roof puts its rafters on top of the beams; a
   * modern ring carries its blades or panel inside itself, so its top *is* the overall height.
   */
  const rise =
    roof.kind === 'hipped' ? clamp(Math.min(w, d) * 0.3, 0.4, Math.max(0.4, H - MIN_EAVES)) : 0;
  const frameTop =
    roof.kind === 'hipped'
      ? H - rise
      : modern
        ? H
        : roof.kind === 'slatted'
          ? H - RAFTER_HEIGHT
          : roof.kind === 'solid'
            ? H - PANEL_HEIGHT
            : H;
  const beamBottom = frameTop - style.beamHeight;
  const beamY = frameTop - style.beamHeight / 2;

  /* ---- posts, inset so their outer faces are flush with the footprint ---- */
  const px = w / 2 - style.post / 2;
  const pz = d / 2 - style.post / 2;
  [
    [-px, -pz],
    [px, -pz],
    [px, pz],
    [-px, pz],
  ].forEach(([x, z], index) => {
    box(
      `post-${index}`,
      'post',
      frame,
      [x!, beamBottom / 2, z!],
      [style.post, beamBottom, style.post],
    );
  });

  /* ---- the frame on top of the posts ---- */
  const bt = style.beamThickness;
  // Front and rear always; a classic slatted roof lets its rafters do the work of the side beams.
  box('beam-rear', 'beam', frame, [0, beamY, -pz], [w, style.beamHeight, bt]);
  box('beam-front', 'beam', frame, [0, beamY, pz], [w, style.beamHeight, bt]);
  if (modern || roof.kind !== 'slatted') {
    const inner = d - 2 * bt;
    box('beam-left', 'beam', frame, [-px, beamY, 0], [bt, style.beamHeight, modern ? inner : d]);
    box('beam-right', 'beam', frame, [px, beamY, 0], [bt, style.beamHeight, modern ? inner : d]);
  }

  /* ---- the roof ---- */
  if (roof.kind === 'hipped') {
    parts.push({
      id: 'roof-hip',
      group: 'roof',
      finish: roofFinish,
      shape: { kind: 'pyramid', centre: [0, frameTop, 0], base: [w, d], rise },
    });
  } else if (roof.kind === 'slatted' && !modern) {
    /*
     * The rafters the plan has always drawn: `max(2, ceil(w / 0.35))` gaps, so one more rafter than
     * that, running the full depth. Inset by half a rafter at each end so the outer two stand on the
     * footprint's edge rather than half over it.
     */
    const count = Math.max(2, Math.ceil(w / RAFTER_SPACING));
    const span = w - RAFTER_WIDTH;
    for (let i = 0; i <= count; i += 1) {
      const x = -span / 2 + (span * i) / count;
      box(
        `rafter-${i}`,
        'rafter',
        roofFinish,
        [x, H - RAFTER_HEIGHT / 2, 0],
        [RAFTER_WIDTH, RAFTER_HEIGHT, d],
      );
    }
  } else if (roof.kind === 'slatted') {
    const innerW = w - 2 * bt;
    const innerD = d - 2 * bt;
    const count = Math.max(3, Math.floor(innerW / BLADE_SPACING));
    const span = innerW - BLADE_WIDTH;
    for (let i = 0; i < count; i += 1) {
      const x = count === 1 ? 0 : -span / 2 + (span * i) / (count - 1);
      box(
        `blade-${i}`,
        'rafter',
        roofFinish,
        [x, H - style.beamHeight / 2, 0],
        [BLADE_WIDTH, BLADE_HEIGHT, innerD],
      );
    }
  } else if (roof.kind === 'solid') {
    if (modern) {
      box(
        'roof-panel',
        'roof',
        roofFinish,
        [0, H - PANEL_HEIGHT, 0],
        [w - 2 * bt, PANEL_HEIGHT, d - 2 * bt],
      );
    } else {
      box('roof-panel', 'roof', roofFinish, [0, H - PANEL_HEIGHT / 2, 0], [w, PANEL_HEIGHT, d]);
    }
  }

  /* ---- side screens: horizontal boards between the posts ---- */
  const screenTop = beamBottom - 0.05;
  const boards = Math.max(0, Math.floor((screenTop - SCREEN_FOOT) / BOARD_SPACING));
  const sides: [keyof ResolvedStructure['sides'], StructurePartGroup][] = [
    ['left', 'side-left'],
    ['right', 'side-right'],
    ['rear', 'side-rear'],
  ];
  for (const [side, group] of sides) {
    if (structure.sides[side] !== 'slatted') continue;
    for (let i = 0; i < boards; i += 1) {
      const y = SCREEN_FOOT + BOARD_HEIGHT / 2 + i * BOARD_SPACING;
      if (side === 'rear') {
        box(
          `${group}-${i}`,
          group,
          frame,
          [0, y, -pz],
          [w - 2 * style.post, BOARD_HEIGHT, BOARD_THICKNESS],
        );
      } else {
        const x = side === 'left' ? -px : px;
        box(
          `${group}-${i}`,
          group,
          frame,
          [x, y, 0],
          [BOARD_THICKNESS, BOARD_HEIGHT, d - 2 * style.post],
        );
      }
    }
  }

  /* ---- a warm strip along the inside of the frame ---- */
  if (structure.lighting) {
    const y = beamBottom - LIGHT_SECTION / 2;
    const insetX = w / 2 - style.post - LIGHT_SECTION;
    const insetZ = d / 2 - style.post - LIGHT_SECTION;
    const alongW = w - 2 * (style.post + LIGHT_SECTION);
    const alongD = d - 2 * (style.post + LIGHT_SECTION);
    box('light-rear', 'light', 'warm-led', [0, y, -insetZ], [alongW, LIGHT_SECTION, LIGHT_SECTION]);
    box('light-front', 'light', 'warm-led', [0, y, insetZ], [alongW, LIGHT_SECTION, LIGHT_SECTION]);
    box('light-left', 'light', 'warm-led', [-insetX, y, 0], [LIGHT_SECTION, LIGHT_SECTION, alongD]);
    box('light-right', 'light', 'warm-led', [insetX, y, 0], [LIGHT_SECTION, LIGHT_SECTION, alongD]);
  }

  return parts;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The rect a structure stands on, in world metres. */
export interface StructureRect {
  centre: Point;
  rotation: number;
}

/**
 * A part as seen from directly above, in world metres: the ring it covers on the plan.
 *
 * The plan renderers and the shadow model both place parts through this, with the rect's own
 * rotation applied once here — the same `rectToPolygon` every other rect in the plan goes through,
 * so a rotated pergola cannot draw its rafters at an angle its outline does not have.
 */
export function partPlanOutline(part: StructurePart, rect: StructureRect): Point[] {
  const { shape } = part;
  const radians = (rect.rotation * Math.PI) / 180;
  const [x, , z] = shape.centre;
  const centre = {
    x: rect.centre.x + x * Math.cos(radians) - z * Math.sin(radians),
    y: rect.centre.y + x * Math.sin(radians) + z * Math.cos(radians),
  };
  const [width, depth] = shape.kind === 'box' ? [shape.size[0], shape.size[2]] : shape.base;
  return rectToPolygon({ centre, width, depth, rotation: rect.rotation });
}

/** A part's lowest and highest points above the structure's own base, in metres. */
export function partHeights(part: StructurePart): { bottom: number; top: number } {
  const { shape } = part;
  if (shape.kind === 'box') {
    return {
      bottom: shape.centre[1] - shape.size[1] / 2,
      top: shape.centre[1] + shape.size[1] / 2,
    };
  }
  return { bottom: shape.centre[1], top: shape.centre[1] + shape.rise };
}
