import type { CandidateParams } from '../../design/types.js';
import { DEFAULT_PARAMS } from '../../knowledge/archetypes/types.js';
import { designedBeds } from '../beds.js';
import {
  behindTerrace,
  borderDepth,
  isCourtyard,
  lawnEnd,
  lawnStart,
  MOWING_STRIP,
  roomBehind,
  terraceEndSlot,
  terraceRect,
  terraceSlot,
  type LayoutSketch,
  type LocalPoint,
  type Room,
  type SketchRequest,
  type Slot,
} from '../sketch.js';

/**
 * "Terrace and lawn" — the rectilinear plan.
 *
 * The modern default, and what most designed suburban gardens are: a terrace across the doors,
 * one rectangular lawn panel set slightly off-centre so the planting is deeper on one side than
 * the other, a destination room in the far corner on the diagonal from the door, and a utility
 * strip across the back on the gate's side where the shed and the bins can be reached without
 * crossing the lawn. Everything is parallel to the house wall.
 *
 * `params` are the axes this composition may be varied along, and **the defaults are the
 * composition as it was drawn before there were parameters** — which is what the golden comparison
 * in `golden.test.ts` pins, to a nanometre.
 */
export function rectilinear(
  request: SketchRequest,
  room: Room,
  params: CandidateParams = { archetype: 'terrace_and_lawn', ...DEFAULT_PARAMS },
): LayoutSketch {
  const s = request.scale;
  const D = room.uMax;
  const b = borderDepth(s);
  const terrace = terraceRect(request, room, params.terraceDepth);
  const T = terrace.u1;

  const gate = request.gateSide ?? 'right';
  const gateSign = gate === 'right' ? 1 : -1;
  const courtyard = isCourtyard(s, D, room.vMax - room.vMin, params.terraceDepth);

  // The part of the room behind the terrace: on an L-plot, the deep limb alone.
  const deep = roomBehind(room, T + 0.4);
  /** A `v` on the gate's side, `metres` in from that fence. */
  const gateV = (metres: number) => (gate === 'right' ? deep.vMax - metres : deep.vMin + metres);
  /** A `v` on the other side. */
  const farV = (metres: number) => (gate === 'right' ? deep.vMin + metres : deep.vMax - metres);

  const slots: Slot[] = [terraceSlot(terrace, room)];

  // Beside the terrace along the house wall, on the gate's side: an outdoor kitchen lives here.
  slots.push({
    id: 'beside-terrace',
    kind: 'beside-terrace',
    anchor: { u: 0.8 * s, v: gate === 'right' ? terrace.v1 + 1.7 * s : terrace.v0 - 1.7 * s },
    maxSize: { width: 3.2 * s, depth: 1.5 * s },
    turn: true,
  });

  // At the end of the terrace, continuing along the wall away from the gate: the dining pergola.
  slots.push(terraceEndSlot(terrace, gate === 'right' ? 'left' : 'right', s));

  /*
   * The utility corner: the shed stands in the far corner on the gate's side, 0.6 m off both
   * fences, and the lawn is notched round it rather than stopped short of it. A bay across the
   * whole back of the garden cost the lawn four metres of depth on every plan that asked for a
   * shed; a notch costs it one corner.
   */
  const wantsUtility =
    request.features.includes('storage') ||
    request.features.includes('vegPatch') ||
    // A greenhouse belongs with the beds and the shed — it is worked in, not sat in. A garden room
    // is deliberately not on this list: it is a room, and it takes the far room like one.
    request.features.includes('greenhouse');
  const utility = behindTerrace(T, D - 0.6, 2.6 * s);
  const utilityWidth = 3.2 * s;
  const notchV = wantsUtility && !courtyard ? 0.6 + utilityWidth + 0.4 : 0;
  const notchU = wantsUtility && !courtyard ? D - 0.6 - utility.depth - 0.4 : D;

  const farRoom = behindTerrace(T, D - b, 4 * s);
  const lawnFar = behindTerrace(T + 0.6 * s, D - b, 4 * s);

  if (!courtyard) {
    slots.push(
      {
        id: 'far-room',
        kind: 'far-room',
        /*
         * On the diagonal from the door by default: the longest view in the garden, and the reason
         * a destination reads as somewhere to go rather than as a thing in a corner. `far-centre`
         * squares it up on the axis instead, which suits a plan with a strong middle.
         */
        anchor: {
          u: farRoom.u,
          v: params.destination === 'far-centre' ? (deep.vMin + deep.vMax) / 2 : farV(b + 2.1 * s),
        },
        maxSize: { width: 4 * s, depth: farRoom.depth },
      },
      {
        id: 'lawn-far',
        kind: 'lawn-far',
        anchor: { u: lawnFar.u, v: gateV(Math.max(b, notchV) + 2.3 * s) },
        maxSize: { width: 4.2 * s, depth: lawnFar.depth },
      },
      {
        id: 'utility',
        kind: 'utility',
        anchor: { u: utility.u, v: gateV(0.6 + utilityWidth / 2) },
        maxSize: { width: utilityWidth, depth: utility.depth },
        turn: true,
      },
      {
        id: 'utility-2',
        kind: 'utility-2',
        anchor: { u: utility.u, v: gateV(0.6 + utilityWidth + 0.4 + utilityWidth / 2) },
        maxSize: { width: utilityWidth, depth: utility.depth },
        turn: true,
      },
      {
        id: 'terrace-corner',
        kind: 'terrace-corner',
        anchor: {
          u: T + 1.3 * s,
          v: gate === 'right' ? terrace.v0 - 1.3 * s : terrace.v1 + 1.3 * s,
        },
        maxSize: { width: 1.9 * s, depth: 1.9 * s },
      },
    );
  } else {
    slots.push({
      id: 'far-room',
      kind: 'far-room',
      anchor: { u: (T + D) / 2, v: 0 },
      maxSize: { width: room.vMax - room.vMin - 0.8, depth: Math.max(1.5, D - T - 0.6) },
    });
  }

  /*
   * The lawn's border, **per side and deliberately lopsided**.
   *
   * It used to be `b` on every side but one, which is a decision that looks modest and is not: a
   * shape inset by a constant leaves an annulus by construction, so the leftover was a continuous
   * ring of planting round the whole garden however wide `b` was. Every plan came out as a lawn
   * marooned in a thicket, and no amount of designing beds could show through it.
   *
   * A designed garden is not bordered evenly. It has a deep bed on one or two sides and the lawn
   * running to the fence on the others — which is what makes the beds read as *places* rather than
   * as the space left over. So: the back gets a deep border (2×), the far side a normal one, and
   * the gate side only a mowing strip, because that is the side you walk down.
   */
  /*
   * `lawnBias` says which side keeps the mowing edge. `gate` is the default and the reasoning
   * above: you walk down the gate side, so the lawn runs to it and the deep bed goes opposite.
   * `away` swaps them, for a plan whose interest should be on the side you walk down. `centre`
   * gives both sides a full border, which is the even ring this note warns against — offered
   * because a formal or a very wide room genuinely wants it, never as the default.
   */
  const deepBorderOnMin = params.lawnBias === 'away' ? gate !== 'right' : gate === 'right';
  const shallowEdge = params.lawnBias === 'centre' ? b : MOWING_STRIP;
  const lawnRect = {
    u0: lawnStart(s, D, T),
    u1: lawnEnd(s, D, T),
    v0: deepBorderOnMin ? deep.vMin + b : deep.vMin + shallowEdge,
    v1: deepBorderOnMin ? deep.vMax - shallowEdge : deep.vMax - b,
  };
  const notched = notchV > 0 && notchU > lawnRect.u0 + 1.5 && notchU < lawnRect.u1;
  const lawn: LayoutSketch['lawn'] = courtyard
    ? null
    : notched
      ? {
          kind: 'polygon',
          // Anticlockwise from the near far-side corner, with the gate-side far corner cut out.
          points:
            gate === 'right'
              ? [
                  { u: lawnRect.u0, v: lawnRect.v0 },
                  { u: lawnRect.u1, v: lawnRect.v0 },
                  { u: lawnRect.u1, v: gateV(notchV) },
                  { u: notchU, v: gateV(notchV) },
                  { u: notchU, v: lawnRect.v1 },
                  { u: lawnRect.u0, v: lawnRect.v1 },
                ]
              : [
                  { u: lawnRect.u0, v: lawnRect.v0 },
                  { u: notchU, v: lawnRect.v0 },
                  { u: notchU, v: gateV(notchV) },
                  { u: lawnRect.u1, v: gateV(notchV) },
                  { u: lawnRect.u1, v: lawnRect.v1 },
                  { u: lawnRect.u0, v: lawnRect.v1 },
                ],
          styleCorners: true,
        }
      : { kind: 'rect', rect: lawnRect, cornerRadius: 0 };

  const paths = courtyard
    ? []
    : [
        { from: { u: T, v: 0 }, to: { slot: 'far-room', or: ['lawn-far'] }, name: 'Service path' },
        { from: { terrace: true as const }, to: { slot: 'utility' }, name: 'Path to the shed' },
        {
          from: { u: 0, v: gateSign * (room.vMax - room.vMin) },
          to: { gate: true as const },
          name: 'Side path',
        },
      ];

  const trees: LocalPoint[] = [
    { u: D - 1.9, v: farV(1.9) },
    { u: D - 1.9, v: gateV(notchV + 1.9) },
    { u: D * 0.55, v: farV(1.9) },
    { u: T + 2.2, v: farV(1.9) },
    { u: D * 0.78, v: gateV(1.9) },
  ];

  return {
    template: 'rectilinear',
    beds: designedBeds(request, room, terrace, 'rectilinear'),
    terrace,
    lawn,
    lawnCategory: request.lawnAllowed ? 'lawn' : 'gravel-mulch',
    slots,
    paths,
    trees,
    axisPath: null,
    courtyard,
  };
}
