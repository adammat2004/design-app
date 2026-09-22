import type { CandidateParams } from '../../design/types.js';
import { DEFAULT_PARAMS } from '../../knowledge/archetypes/types.js';
import { designedBeds } from '../beds.js';
import {
  behindTerrace,
  MOWING_STRIP,
  borderIn,
  clamp,
  clampToRoom,
  isCourtyard,
  lawnEnd,
  lawnStart,
  roomBehind,
  terraceDepth,
  terraceEndSlot,
  terraceFloor,
  terraceSlot,
  terraceWidth,
  type LayoutSketch,
  type LocalPoint,
  type LocalRect,
  type Room,
  type SketchRequest,
  type Slot,
} from '../sketch.js';

/** The paved line down the middle, in metres. A path two people can walk abreast. */
const AXIS_WIDTH = 1.2;

/**
 * "Formal axis" — the symmetric plan.
 *
 * Everything mirrors about the line out from the door: a centred terrace, a rectangular lawn
 * panel with a paved path down its middle, a focal point at the end of the axis — the water, or
 * the pergola, or a bench — and the utility pieces in the two far corners. The mirror line is the
 * door's own normal, so a door off-centre on its wall still gets a plan that is symmetric about
 * the view from it, which is what formal means.
 *
 * The one thing that may break the mirror is the terrace. Symmetry uses the narrower side of the
 * door for both halves, and a door a metre from a fence would mirror the terrace into a strip too
 * narrow for its table; so the terrace keeps its floor and slides along the wall to stay in the
 * room, exactly as the other templates do, while the lawn and the axis stay centred on the door.
 */
/*
 * `lawnBias` and `destination` are **pinned** on this composition rather than offered.
 *
 * A formal plan is symmetric about the view from the doors; biasing the lawn to one side or moving
 * the focal point off the axis does not give a variation on a formal garden, it gives a plan that
 * is no longer one. `formalArchetype.params` never emits either, and this signature ignores them if
 * a caller passes them anyway — which is what keeps the mirror-symmetry test true by construction.
 */
export function formal(
  request: SketchRequest,
  room: Room,
  params: CandidateParams = { archetype: 'formal_axis', ...DEFAULT_PARAMS },
): LayoutSketch {
  const s = request.scale;
  const D = room.uMax;
  /*
   * The border the plan actually has room for: `borderIn`, not `borderDepth`.
   *
   * `isCourtyard` asks the same question with the same function, so what the template *draws* and
   * what the composition believes about whether a lawn fits are one answer. Deepening the border
   * without this had a small garden reported as a courtyard and paved corner to corner.
   */
  const b = borderIn(s, room.vMax - room.vMin - MOWING_STRIP);

  // Symmetry needs equal room either side of the axis; use the narrower side for both, but never
  // narrower than the terrace's floor.
  const floor = terraceFloor(room);
  const hw = Math.max(Math.min(-room.vMin, room.vMax), floor.width / 2);
  const symmetric: Room = { uMin: room.uMin, uMax: room.uMax, vMin: -hw, vMax: hw };

  const depth = terraceDepth(s, D, params.terraceDepth);
  const width = Math.max(floor.width, Math.min(terraceWidth(request, room), 2 * hw - 0.8));
  const [v0, v1] = clampToRoom(width, room, (request.doorWidth ?? 0) / 2);
  const terrace: LocalRect = {
    u0: Math.max(room.uMin, 0),
    u1: Math.max(room.uMin, 0) + depth,
    v0,
    v1,
  };
  const T = terrace.u1;

  const courtyard = isCourtyard(s, D, room.vMax - room.vMin, params.terraceDepth);
  // Behind the terrace the room may be narrower (an L-plot): the lawn and the far slots mirror
  // about the axis within *that* width.
  const deep = roomBehind(symmetric, T + 0.4);
  const dw = Math.max(0.5, Math.min(-deep.vMin, deep.vMax));
  // The focal room at the end of the axis takes a share of what is free behind the terrace, so a
  // shallow garden keeps a lawn in front of it rather than a pool with no lawn at all.
  const start = lawnStart(s, D, T);
  const end = lawnEnd(s, D, T);
  const axisEnd = Math.min(clamp(3.4 * s, 2.4, 5), Math.max(1.2, (end - start) * 0.45));

  const lawn: LayoutSketch['lawn'] = courtyard
    ? null
    : {
        kind: 'rect',
        rect: { u0: start, u1: end - axisEnd, v0: -(dw - b), v1: dw - b },
        cornerRadius: 0,
      };

  const utility = behindTerrace(T, D - b, 2.4 * s);
  const lawnRoom = behindTerrace(start, lawn ? lawn.rect.u1 : D - b, 3.6 * s);

  const slots: Slot[] = [
    terraceSlot(terrace, room),
    {
      id: 'beside-terrace',
      kind: 'beside-terrace',
      anchor: { u: 0.8 * s, v: terrace.v1 + 1.7 * s },
      maxSize: { width: 3.2 * s, depth: 1.5 * s },
      turn: true,
    },
  ];

  if (!courtyard) {
    slots.push(
      {
        id: 'axis-end',
        kind: 'axis-end',
        anchor: { u: D - b - axisEnd / 2, v: 0 },
        maxSize: { width: Math.min(3.6 * s, 2 * dw - 2 * b - 0.4), depth: axisEnd - 0.4 },
      },
      {
        id: 'utility',
        kind: 'utility',
        anchor: { u: utility.u, v: -(dw - b - 1.6 * s) },
        maxSize: { width: 2.8 * s, depth: utility.depth },
        turn: true,
      },
      {
        id: 'utility-2',
        kind: 'utility-2',
        anchor: { u: utility.u, v: dw - b - 1.6 * s },
        maxSize: { width: 2.8 * s, depth: utility.depth },
        turn: true,
      },
      {
        id: 'far-room',
        kind: 'far-room',
        anchor: { u: lawnRoom.u, v: dw - b - 2.1 * s },
        maxSize: { width: 3.6 * s, depth: lawnRoom.depth },
      },
      {
        id: 'lawn-far',
        kind: 'lawn-far',
        anchor: { u: lawnRoom.u, v: -(dw - b - 2.1 * s) },
        maxSize: { width: 3.6 * s, depth: lawnRoom.depth },
      },
      terraceEndSlot(terrace, 'left', s),
    );
  } else {
    slots.push({
      id: 'axis-end',
      kind: 'axis-end',
      anchor: { u: (T + D) / 2, v: 0 },
      maxSize: { width: 2 * hw - 0.8, depth: Math.max(1.5, D - T - 0.6) },
    });
  }

  const axisPath: LocalRect | null =
    courtyard || !lawn
      ? null
      : { u0: T, u1: lawn.rect.u1, v0: -AXIS_WIDTH / 2, v1: AXIS_WIDTH / 2 };

  const paths = courtyard
    ? []
    : [
        { from: { terrace: true as const }, to: { slot: 'utility' }, name: 'Path to the shed' },
        {
          from: { u: 0, v: hw * 2 * (request.gateSide === 'left' ? -1 : 1) },
          to: { gate: true as const },
          name: 'Side path',
        },
      ];

  const trees: LocalPoint[] = [
    { u: D - 1.9, v: -(dw - 1.9) },
    { u: D - 1.9, v: dw - 1.9 },
    { u: D * 0.5, v: -(dw - 1.9) },
    { u: D * 0.5, v: dw - 1.9 },
  ];

  return {
    template: 'formal',
    beds: designedBeds(request, room, terrace, 'formal'),
    terrace,
    lawn,
    lawnCategory: request.lawnAllowed ? 'lawn' : 'gravel-mulch',
    slots,
    paths,
    trees,
    axisPath,
    courtyard,
  };
}
