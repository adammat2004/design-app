/**
 * The material catalogue moved into `@garden-studio/schema`: the assistant hands material ids
 * back, so the closed set has to be something the server can validate against.
 *
 * The colours came out of it in the process — see `material-colours.ts`, re-exported here so
 * the canvas and the panels keep importing `materialFill` from where they always have.
 */
export {
  MATERIALS,
  MaterialIdSchema,
  canTake,
  cheaperAlternative,
  defaultMaterial,
  findMaterial,
  materialLabel,
  materialsFor,
  type Material,
  type MaterialId,
} from '@garden-studio/schema';

export { MATERIAL_FILLS, materialFill } from './material-colours';

/*
 * The patterned half of the same idea. `materialFill` answers "what colour is this?" and
 * `useSurfacePattern` answers "what does it look like?" — a material with no pattern falls back to
 * the colour, which is why both stay reachable from here.
 */
export { MATERIAL_TONES, resolvePattern, type MaterialManifestEntry } from './materials/palette';
export { useSurfacePattern, type SurfacePattern } from './materials/use-surface-pattern';
export { LIGHT_DIRECTION } from './materials/light';
