import type { LocalRect, LocalShape, Room, SketchRequest, TemplateId } from './sketch.js';
import { borderDepth, roomBehind } from './sketch.js';

/** Beds are planned places. Their inner edges carve bays into the lawn at the fitting stage. */
export function designedBeds(
  request: SketchRequest,
  room: Room,
  terrace: LocalRect,
  template: TemplateId,
): { name: string; shape: LocalShape }[] {
  const deep = roomBehind(room, terrace.u1 + 0.2);
  const near = terrace.u1 + 0.15;
  const far = deep.uMax - 0.15;
  const width = deep.vMax - deep.vMin;
  if (far - near < 1.4 || width < 3) return [];
  const b = Math.min(borderDepth(request.scale), width * 0.16, (far - near) * 0.24);
  const end = far - b;
  const left = deep.vMin + 0.15;
  const right = deep.vMax - 0.15;
  const side = (isLeft: boolean): LocalShape => {
    const edge = isLeft ? left : right;
    const sign = isLeft ? 1 : -1;
    const focal = request.gateSide === 'left' ? !isLeft : isLeft;
    const points = [
      { u: near, v: edge },
      { u: end, v: edge },
    ];
    const samples = template === 'curved' ? 20 : 6;
    for (let i = samples; i >= 0; i -= 1) {
      const t = i / samples;
      const bay =
        template === 'formal'
          ? 1
          : template === 'curved'
            ? (focal ? 0.9 : 0.45) + (focal ? 1.05 : 0.6) * Math.sin(Math.PI * t) ** 2
            : focal && t > 0.25 && t < 0.75
              ? 1.65
              : focal
                ? 0.8
                : 0.45;
      points.push({ u: near + (end - near) * t, v: edge + sign * b * bay });
    }
    return { kind: 'polygon', points, styleCorners: template === 'rectilinear' };
  };
  return [
    { name: template === 'formal' ? 'Left border' : 'Specimen border', shape: side(true) },
    { name: template === 'formal' ? 'Right border' : 'Flowering border', shape: side(false) },
    {
      name: 'Rear border',
      shape: { kind: 'rect', rect: { u0: end, u1: far, v0: left, v1: right }, cornerRadius: 0 },
    },
  ];
}
