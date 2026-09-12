import type { LocalRect, LocalShape, Room, SketchRequest, TemplateId } from './sketch.js';
import { BED_MIN_DEPTH, borderDepth, clamp, lawnEnd, roomBehind } from './sketch.js';

/**
 * Beds are planned places. Their inner edges carve bays into the lawn at the fitting stage.
 *
 * ```
 *   room behind the terrace
 *   ┌────────────────────────────────────────┐ ── far
 *   │            Rear border  (≥ 1.2 m)      │
 *   ├──────┬──────────────────────────┬──────┤ ── lawnEnd
 *   │ side │                          │ side │
 *   │ bed  │      usable centre       │ bed  │   focal side bulges, other side a runner
 *   │      │                          │      │
 *   ├──────┴──────────────────────────┴──────┤ ── near (terrace + 0.15)
 *   │ flank │       terrace           │ flank│   `Terrace flank` beds beside the terrace
 *   └───────┴─────────────────────────┴──────┘ ── u = 0.3
 * ```
 *
 * **No bed is ever sketched thinner than `BED_MIN_DEPTH`.** The sliver guard in PostGIS throws
 * away anything under it, silently, and the first version drew its runners at a third of the
 * border depth — so every small garden's side beds vanished and the plan came out as a lawn, a
 * patio and nothing else. A bed too thin to survive is not drawn thin; it is not drawn.
 */
export function designedBeds(
  request: SketchRequest,
  room: Room,
  terrace: LocalRect,
  template: TemplateId,
): { name: string; shape: LocalShape }[] {
  const beds: { name: string; shape: LocalShape }[] = [];
  const deep = roomBehind(room, terrace.u1 + 0.2);
  const near = terrace.u1 + 0.15;
  const far = deep.uMax - 0.15;
  const width = deep.vMax - deep.vMin;
  const left = deep.vMin + 0.15;
  const right = deep.vMax - 0.15;

  // Beside the terrace, between its edge and the fence: the flanks. Independent of the room
  // behind, so a courtyard still gets planting either side of its terrace.
  for (const [edge, terraceEdge, sign, name] of [
    [room.vMin + 0.15, terrace.v0 - 0.15, 1, 'Terrace flank'],
    [room.vMax - 0.15, terrace.v1 + 0.15, -1, 'Terrace flank'],
  ] as const) {
    const free = sign === 1 ? terraceEdge - edge : edge - terraceEdge;
    if (free < BED_MIN_DEPTH + 0.3) continue;
    beds.push({
      name,
      shape: {
        kind: 'rect',
        rect: {
          u0: Math.max(room.uMin, 0) + 0.3,
          u1: terrace.u1,
          v0: sign === 1 ? edge : terraceEdge,
          v1: sign === 1 ? terraceEdge : edge,
        },
        cornerRadius: 0,
      },
    });
  }

  // Nothing behind the terrace deep enough for even a rear bed: the flanks are the beds.
  if (far - near < BED_MIN_DEPTH) return beds;

  // The rear border first: the one bed every garden has, however small.
  const end = Math.min(lawnEnd(request.scale, deep.uMax, terrace.u1), far - BED_MIN_DEPTH);
  beds.push({
    name: 'Rear border',
    shape: { kind: 'rect', rect: { u0: end, u1: far, v0: left, v1: right }, cornerRadius: 0 },
  });

  // Reserve a usable centre, even on a long narrow plot. Depth belongs to the focal side; an
  // equally deep strip on both sides would consume the lawn without making a garden room.
  const usableWidth = Math.min(3.2, width * 0.6);
  const plantingWidth = Math.max(0, width - usableWidth - 0.3);
  if (plantingWidth < BED_MIN_DEPTH || width < 3) return beds;

  const b = Math.max(
    BED_MIN_DEPTH,
    Math.min(borderDepth(request.scale), plantingWidth / 2.4, (far - near) * 0.24),
  );
  const side = (isLeft: boolean): LocalShape => {
    const edge = isLeft ? left : right;
    const sign = isLeft ? 1 : -1;
    const focal = request.gateSide === 'left' ? !isLeft : isLeft;
    const points = [
      { u: near, v: edge },
      { u: end, v: edge },
    ];
    const samples = template === 'curved' ? 24 : 8;
    for (let i = samples; i >= 0; i -= 1) {
      const t = i / samples;
      const bay =
        template === 'formal'
          ? 1
          : template === 'curved'
            ? (focal ? 0.7 : 0.4) +
              (focal ? 1.4 : 0.6) * Math.sin(Math.PI * (t + (focal ? 0 : 0.35))) ** 4
            : focal && t >= 0.375 && t <= 0.625
              ? 2.1
              : focal
                ? 0.7
                : t > 0.7
                  ? 0.9
                  : 0.35;
      // The floor wins over the profile: a runner is a bed, never a line.
      const cap = Math.max(BED_MIN_DEPTH, plantingWidth * (focal ? 0.72 : 0.28));
      const depth = template === 'formal' ? b : clamp(b * bay, BED_MIN_DEPTH, cap);
      points.push({ u: near + (end - near) * t, v: edge + sign * depth });
    }
    return { kind: 'polygon', points, styleCorners: template === 'rectilinear' };
  };

  // Room for one side bed only: the focal side gets it, the other keeps its mowing edge.
  const focalIsLeft = request.gateSide === 'left' ? false : true;
  if (plantingWidth < 2 * BED_MIN_DEPTH) {
    beds.push({
      name: template === 'formal' ? 'Side border' : 'Specimen border',
      shape: side(focalIsLeft),
    });
    return beds;
  }

  beds.push(
    { name: template === 'formal' ? 'Left border' : 'Specimen border', shape: side(true) },
    { name: template === 'formal' ? 'Right border' : 'Flowering border', shape: side(false) },
  );

  // A short bed frames the terrace's outside corner, leaving the door-to-lawn route open.
  // This breaks the perimeter-only composition without adding an island to a small garden.
  if (template !== 'formal' && width >= 9 && far - near >= 6) {
    const isLeft = request.gateSide !== 'left';
    const edge = isLeft ? left : right;
    const reach = Math.min(plantingWidth * 0.6, b * 2.2);
    beds.push({
      name: 'Terrace planting bay',
      shape: {
        kind: 'rect',
        rect: {
          u0: near,
          u1: near + Math.max(BED_MIN_DEPTH, Math.min(1.2, b)),
          v0: isLeft ? edge : edge - reach,
          v1: isLeft ? edge + reach : edge,
        },
        cornerRadius: template === 'curved' ? 0.5 : 0,
      },
    });
  }
  return beds;
}
