import { z } from 'zod';

/**
 * The words an AR scene is written in.
 *
 * Deliberately its own vocabulary rather than `ElementCategory` and `SymbolId` imported from
 * `@garden-studio/schema`. This package is what the phone imports, and the schema package is ~60
 * modules including the whole design agent — Metro tree-shakes poorly, so importing one enum from
 * it would ship the lot. The cost is that the two lists can drift, which is why
 * `vocabulary.test.ts` checks every `ModelKey` against the schema's `SymbolId` (a dev-only
 * dependency: the runtime package still depends on nothing but zod).
 */

/**
 * What a node *is*, for the renderer's own decisions: whether it is drawn translucent, whether it
 * is hidden by default, which toggle hides it. Coarser than `ElementCategory` in some places
 * (paving and decking are both paved areas in the plan) and finer in others (a tree is a
 * `planting-bed` point in the plan, and a very different thing to draw).
 */
export const ARCategorySchema = z.enum([
  /* ---- ground surfaces ---- */
  'lawn',
  'paving',
  'decking',
  'gravel',
  'planting',
  'water',
  'path',
  /* ---- built and standing things ---- */
  'structure',
  'steps',
  'retaining',
  'edging',
  'boundary',
  'house',
  /* ---- products and plants ---- */
  'furniture',
  'play',
  'lighting',
  'tree',
  'shrub',
  /** Something already in the real garden. The real one is in front of the camera. */
  'existing',
]);
export type ARCategory = z.infer<typeof ARCategorySchema>;

/**
 * A thing drawn from a 3D model file, named by what it is rather than by which file draws it.
 *
 * Every key is a `SymbolId` from `packages/schema/src/plan/symbols.ts` — the products: furniture,
 * play equipment, light fittings, the hot tub, shrubs and trees. The *structures* in that list
 * (`pergola`, `shed`, `gazebo`, `greenhouse`, `garden-room`, `raised-bed`, `steps`) are
 * deliberately absent: each is whatever rectangle the placer gave it, so it arrives as a `solid`
 * built from its own outline, exactly as the 2D renderer draws it from its outline rather than a
 * photograph.
 *
 * The scene never names a file. Which `.glb` draws `dining-set-4` is the renderer's model manifest,
 * so asset files can change without the scene format changing.
 */
export const ModelKeySchema = z.enum([
  'dining-set-4',
  'dining-set-6',
  'sofa-set',
  'lounger',
  'bbq',
  'fire-pit',
  'bench',
  'parasol',
  'planter',
  'swing',
  'slide',
  'trampoline',
  'light-spike',
  'light-bollard',
  'light-recessed',
  'light-wall',
  'hot-tub',
  'specimen',
  'shrub-evergreen',
  'shrub-flowering',
  'shrub-architectural',
  'shrub-topiary',
  'tree-deciduous',
  'tree-ornamental',
  'tree-evergreen',
  'tree-multistem',
  'tree-fruit',
]);
export type ModelKey = z.infer<typeof ModelKeySchema>;

/**
 * The infill of a planting bed, by form. A bed in the plan is a textured scatter of hundreds of
 * plants; in AR it is a capped number of instances of a few clump models, and these name them.
 */
export const PlantKeySchema = z.enum(['groundcover', 'perennial', 'grass', 'shrub-mass']);
export type PlantKey = z.infer<typeof PlantKeySchema>;

/**
 * What a model is replaced with when its file is missing or has not loaded. A missing asset must
 * never mean a missing object — the size is still true, so a box of the right size is still
 * useful, and it is what the spike draws before any model exists.
 */
export const FallbackShapeSchema = z.enum(['box', 'cylinder', 'tree']);
export type FallbackShape = z.infer<typeof FallbackShapeSchema>;

/**
 * What a door or a window in a wall is — a copy of the plan's `OpeningType`, for the reason
 * `ModelKey` is a copy: the phone never imports the schema. `vocabulary.test.ts` checks the copy.
 * (Added in 0.0.2.)
 */
export const OpeningKindSchema = z.enum([
  'patio-door',
  'back-door',
  'front-door',
  'window',
  'upper-window',
  'garage-door',
]);
export type OpeningKind = z.infer<typeof OpeningKindSchema>;
