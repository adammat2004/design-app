import { boundingBox, moduleRandom, pick, type Point } from '@garden-studio/schema';
import type { LinearCoursePrimitive } from '../render/primitives';
import { materialAssets } from './assets/material-assets';
import { cssToRgb, rgbToCss, shiftBrightness } from './light';
import { drawSurfacePattern, type DrawPass, type PatternContext } from './render-surface-pattern';

/** Laid courses are clipped unit polygons, skinned along each unit's local tangent. */
export function drawLinearCourse(context: PatternContext, primitive: Pick<LinearCoursePrimitive, 'surface' | 'course'>,
  pass: DrawPass, origin: Point): void {
  const { surface, course } = primitive;
  const px = (point: Point) => ({ x: (point.x - origin.x) * pass.pxPerMetre, y: (point.y - origin.y) * pass.pxPerMetre });
  const trace = (ring: Point[]) => {
    context.beginPath();
    ring.forEach((point, index) => { const p = px(point); if (index === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y); });
    context.closePath();
  };
  if (!surface.material) {
    context.fillStyle = '#666d63'; trace(surface.outline); context.fill(); return;
  }
  if (!course) {
    drawSurfacePattern(context, surface.outline, surface.material, surface.anchor, surface.seed,
      { ...pass, centreline: surface.centreline ?? undefined, layers: surface.layers }, origin);
    return;
  }
  context.save();
  trace(course.outline); context.clip();
  context.fillStyle = surface.material.jointColour; context.fill();
  const faceId = materialAssets(surface.material.id)?.face;
  const faces = faceId ? pass.assets?.(faceId) ?? [] : [];
  const showUnits = course.moduleLength * pass.pxPerMetre >= 2;
  if (!showUnits || !course.units.length) {
    context.fillStyle = surface.material.palette[0] ?? surface.material.jointColour;
    context.fill(); context.restore(); return;
  }
  for (const unit of course.units) {
    const random = moduleRandom(surface.seed, unit.index, unit.row);
    const tone = pick(surface.material.palette, random());
    context.save();
    trace(unit.outline); context.clip();
    context.fillStyle = tone; context.fill();
    if (faces.length) {
      const asset = pick(faces, random());
      const at = px(unit.at);
      const box = boundingBox(unit.outline);
      const span = Math.max(unit.end - unit.start, Math.hypot(box.width, box.length));
      context.translate(at.x, at.y);
      context.rotate(Math.atan2(unit.tangent.y, unit.tangent.x));
      context.globalAlpha = 0.62;
      context.drawImage(asset.image, -span * pass.pxPerMetre / 2 - 1, -course.width * pass.pxPerMetre / 2 - 1,
        span * pass.pxPerMetre + 2, course.width * pass.pxPerMetre + 2);
      context.globalAlpha = 1;
    }
    context.restore();
    // A fine arris stays subordinate to the real mortar gap.
    if (course.width * pass.pxPerMetre > 3) {
      context.strokeStyle = rgbToCss(shiftBrightness(cssToRgb(tone), 0.08));
      context.lineWidth = Math.min(0.65, course.width * pass.pxPerMetre * 0.06);
      trace(unit.outline); context.stroke();
    }
  }
  context.restore();
}
