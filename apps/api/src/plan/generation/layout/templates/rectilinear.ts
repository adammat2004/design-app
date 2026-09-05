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

/**
 * "Terrace and lawn" — the rectilinear plan.
 *
 * The modern default, and what most designed suburban gardens are: a terrace across the doors,
 * one rectangular lawn panel set slightly off-centre so the planting is deeper on one side than
 * the other, a destination room in the far corner on the diagonal from the door, and a utility
 * strip across the back on the gate's side where the shed and the bins can be reached without
 * crossing the lawn. Everything is parallel to the house wall.
 */
export function rectilinear(request: SketchRequest, room: Room): LayoutSketch {
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
  /** A `v` on the gate's side, `metres` in from that fence. */
  const gateV = (metres: number) => (gate === 'right' ? deep.vMax - metres : deep.vMin + metres);
  /** A `v` on the other side. */
  const farV = (metres: number) => (gate === 'right' ? deep.vMin + metres : deep.vMax - metres);

  const slots: Slot[] = [
    { id: 'terrace', kind: 'terrace', anchor: rectCentre(terrace), maxSize: rectSize(terrace) },
  ];

  // Beside the terrace along the house wall, on the gate's side: an outdoor kitchen lives here.
  slots.push({
    id: 'beside-terrace',
    kind: 'beside-terrace',
    anchor: { u: 0.8 * s, v: gate === 'right' ? terrace.v1 + 1.7 * s : terrace.v0 - 1.7 * s },
    maxSize: { width: 3.2 * s, depth: 1.5 * s },
    turn: true,
  });

  // At the end of the terrace, continuing along the wall away from the gate: the dining pergola.
  slots.push({
    id: 'terrace-end',
    kind: 'terrace-end',
    anchor: { u: T / 2, v: gate === 'right' ? terrace.v0 - 1.9 * s : terrace.v1 + 1.9 * s },
    maxSize: { width: 3.6 * s, depth: Math.max(2.4, T) },
  });

  /*
   * The utility corner: the shed stands in the far corner on the gate's side, 0.6 m off both
   * fences, and the lawn is notched round it rather than stopped short of it. A bay across the
   * whole back of the garden cost the lawn four metres of depth on every plan that asked for a
   * shed; a notch costs it one corner.
   */
  const wantsUtility =
    request.features.includes('storage') || request.features.includes('vegPatch');
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
        anchor: { u: farRoom.u, v: farV(b + 2.1 * s) },
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

  // Deeper planting on the far side, a mowing strip's worth on the gate side.
  const lawnRect = {
    u0: T + 0.6 * s,
    u1: D - b,
    v0: gate === 'right' ? deep.vMin + 1.4 * b : deep.vMin + b,
    v1: gate === 'right' ? deep.vMax - b : deep.vMax - 1.4 * b,
  };
  const notched = notchV > lawnRect.u0 && notchU > lawnRect.u0 + 1.5 && notchU < lawnRect.u1;
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
