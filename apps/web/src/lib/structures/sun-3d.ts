import type { LocalFrame, SiteSection } from '@garden-studio/schema';
import { conventionalCast, LIGHT_DIRECTION, presentationCast } from '../materials/light';

/**
 * Where the sun is for the 3D view, as a unit vector towards it in the structure's local frame
 * (X across, Y up, Z towards the front).
 *
 * The plan's own sun: the real one where the site says where on Earth it is and the hour it is
 * drawn at, and the conventional top-left drawing light where it does not — `presentationCast`,
 * the one answer the 2D plan's shadows use. So a pergola's shadow in 3D falls the way the plan
 * draws it. A located garden at night has no sun; the editor still needs light to work by, so it
 * falls back to the drawing light rather than going dark.
 */
export function sunInFrame(site: SiteSection, frame: LocalFrame): [number, number, number] {
  const cast = presentationCast(site, LIGHT_DIRECTION) ?? conventionalCast(LIGHT_DIRECTION);
  // Towards the sun in plan metres, then turned into the structure's frame.
  const origin = frame.toLocal({ x: 0, y: 0 });
  const toward = frame.toLocal({ x: -cast.direction.x, y: -cast.direction.y });
  const across = { x: toward.x - origin.x, z: toward.z - origin.z };
  const length = Math.hypot(across.x, across.z) || 1;
  // A shadow `lengthPerMetre` long per metre of height is a sun at atan(1 / lengthPerMetre).
  const altitude = Math.atan2(1, Math.max(cast.lengthPerMetre, 1e-3));
  const flat = Math.cos(altitude);
  return [(across.x / length) * flat, Math.sin(altitude), (across.z / length) * flat];
}
