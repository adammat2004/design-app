import { boundingBox, clipToHalfPlane, gardenDirection, housePolygon, type Point } from '@garden-studio/schema';
import type { PlanScene } from './build-scene';

export interface PresentationView { pxPerMetre: number; centre: Point }
export interface PresentationSize { width: number; height: number }
export const clampZoom = (scale: number) => Math.min(400, Math.max(4, scale));

/** Fit the designed back garden with a small strip of house context, or the whole property. */
export function presentationExtent(scene: PlanScene, mode: 'garden' | 'plot'): Point[] {
  const direction = gardenDirection(scene.site);
  if (mode === 'plot' || !scene.house || !direction ||
    (scene.site.selectedZoneIds.length > 0 && !scene.site.selectedZoneIds.includes('back'))) return scene.boundary;
  const house = housePolygon(scene.house);
  const edge = Math.max(...house.map((p) => p.x * direction.x + p.y * direction.y));
  const cut = clipToHalfPlane(scene.boundary,
    { x: direction.x * (edge - 1.2), y: direction.y * (edge - 1.2) }, direction);
  return cut.length >= 3 ? cut : scene.boundary;
}

export function fitPresentation(points: Point[], size: PresentationSize): PresentationView {
  const box = boundingBox(points);
  return { pxPerMetre: clampZoom(Math.min(size.width / Math.max(box.width, 0.01), size.height / Math.max(box.length, 0.01)) * 0.92),
    centre: { x: box.minX + box.width / 2, y: box.minY + box.length / 2 } };
}

/** Keep the world point beneath the cursor fixed while zooming. */
export function zoomPresentation(view: PresentationView, factor: number, cursor: Point): PresentationView {
  const pxPerMetre = clampZoom(view.pxPerMetre * factor);
  return { pxPerMetre, centre: {
    x: view.centre.x + cursor.x / view.pxPerMetre - cursor.x / pxPerMetre,
    y: view.centre.y + cursor.y / view.pxPerMetre - cursor.y / pxPerMetre,
  } };
}
