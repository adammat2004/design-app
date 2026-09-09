import { designedBeds } from '../beds.js';
import {
  behindTerrace,
  borderDepth,
  isCourtyard,
  rectCentre,
  rectSize,
  roomBehind,
  terraceRect,
  type LayoutSketch,
  type LocalPoint,
  type Room,
  type SketchRequest,
  type Slot,
} from '../sketch.js';

/** How many points the lawn's outline is sampled at. Enough to read as a curve, not a polygon. */
const LAWN_SAMPLES = 28;

/** How far the lawn bulges and pinches, as a fraction of its radius. */
const LAWN_WAVE = 0.13;

/**
 * "Sweeping lawn" — the curved plan.
 *
 * What a cottage or naturalistic garden looks like from above: the same terrace off the doors,
 * then one flowing lawn whose edge bulges and pinches, so the planting is deep in the bays it
 * leaves and shallow at its bulges. The far room sits in the far bulge where the lawn opens out,
 * the utility corner is tucked into the bay nearest the gate, and the path curves rather than
 * cutting straight across. Nothing here is parallel to anything except the terrace.
 */
export function curved(request: SketchRequest, room: Room): LayoutSketch {
  const s = request.scale;
  const D = room.uMax;
  const b = borderDepth(s);
  const terrace = terraceRect(request, room);
  const T = terrace.u1;

  const gate = request.gateSide ?? 'right';
  const gateSign = gate === 'right' ? 1 : -1;
  const courtyard = isCourtyard(s, D);

  // The part of the room behind the terrace: on an L-plot, the deep limb alone.
  const deep = roomBehind(room, T + 0.4);
  const gateV = (metres: number) => (gate === 'right' ? deep.vMax - metres : deep.vMin + metres);
  const farV = (metres: number) => (gate === 'right' ? deep.vMin + metres : deep.vMax - metres);

  /*
   * The lawn: an ellipse filling the room inside the border, with a two-lobed wave on its radius.
   * The wave's phase is fixed so the bulge lands on the far-from-gate side at the back — where the
   * far room wants the space — and the pinch on the gate side, where the utility corner wants a
   * deeper bay. Clamped to clear the terrace by a stride.
   */
  let lawn: LayoutSketch['lawn'] = null;
  if (!courtyard) {
    const cu = (T + 0.6 * s + (D - b)) / 2;
    const cv = (deep.vMin + deep.vMax) / 2;
    const a = (D - b - (T + 0.6 * s)) / 2;
    const bb = (deep.vMax - deep.vMin - 2 * b) / 2;
    const phase = gate === 'right' ? Math.PI / 4 : -Math.PI / 4 + Math.PI;

    const points: LocalPoint[] = [];
    for (let i = 0; i < LAWN_SAMPLES; i += 1) {
      const theta = (i / LAWN_SAMPLES) * Math.PI * 2;
      const r = 1 + LAWN_WAVE * Math.sin(2 * theta + phase);
      const u = Math.max(T + 0.4, cu + a * r * Math.cos(theta));
      const v = cv + bb * r * Math.sin(theta);
      points.push({ u, v });
    }
    lawn = { kind: 'polygon', points };
  }

  const farRoom = behindTerrace(T + 0.4, D - b, 3.8 * s);
  const utility = behindTerrace(T, D - b, 2.4 * s);
  const lawnFar = behindTerrace(T + 0.4, D - b, 3.6 * s);

  const slots: Slot[] = [
    { id: 'terrace', kind: 'terrace', anchor: rectCentre(terrace), maxSize: rectSize(terrace) },
    {
      id: 'beside-terrace',
      kind: 'beside-terrace',
      anchor: { u: 0.8 * s, v: gate === 'right' ? terrace.v1 + 1.7 * s : terrace.v0 - 1.7 * s },
      maxSize: { width: 3.2 * s, depth: 1.5 * s },
      turn: true,
    },
    {
      id: 'terrace-end',
      kind: 'terrace-end',
      anchor: { u: T / 2, v: gate === 'right' ? terrace.v0 - 1.9 * s : terrace.v1 + 1.9 * s },
      maxSize: { width: 3.6 * s, depth: Math.max(2.4, T) },
    },
  ];

  if (!courtyard) {
    slots.push(
      {
        id: 'far-room',
        kind: 'far-room',
        anchor: { u: farRoom.u, v: farV(b + 2.4 * s) },
        maxSize: { width: 3.8 * s, depth: farRoom.depth },
      },
      {
        id: 'utility',
        kind: 'utility',
        anchor: { u: utility.u, v: gateV(b + 1.7 * s) },
        maxSize: { width: 3 * s, depth: utility.depth },
        turn: true,
      },
      {
        id: 'utility-2',
        kind: 'utility-2',
        anchor: { u: Math.max(T + 1.2 * s, utility.u - 3.2 * s), v: gateV(b + 1.5 * s) },
        maxSize: { width: 2.6 * s, depth: utility.depth },
        turn: true,
      },
      {
        id: 'lawn-far',
        kind: 'lawn-far',
        anchor: { u: Math.min((T + D) / 2 + 1.2 * s, lawnFar.u), v: gateV(b + 3.2 * s) },
        maxSize: { width: 3.6 * s, depth: lawnFar.depth },
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

  // A path that swings out towards the gate side before curving back to the far room.
  const paths = courtyard
    ? []
    : [
        {
          from: { u: T, v: gateSign * 0.6 * s },
          via: [
            { u: T + (D - T) * 0.33, v: gateV(b + 2.2 * s + 3.4 * s) },
            { u: T + (D - T) * 0.66, v: 0 },
          ],
          to: { slot: 'far-room', or: ['lawn-far'] },
          name: 'Garden path',
        },
        {
          from: { u: 0, v: gateSign * (room.vMax - room.vMin) },
          to: { gate: true as const },
          name: 'Side path',
        },
      ];

  const trees: LocalPoint[] = [
    { u: D - 1.9, v: gateV(1.9) },
    { u: D - 1.9, v: farV(1.9) },
    { u: T + 2.4, v: farV(1.9) },
    { u: D * 0.6, v: gateV(1.9) },
    { u: D * 0.5, v: farV(1.9) },
  ];

  return {
    template: 'curved',
    beds: designedBeds(request, room, terrace, 'curved'),
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
