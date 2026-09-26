import { z } from 'zod';
import {
  ARCategorySchema,
  FallbackShapeSchema,
  ModelKeySchema,
  PlantKeySchema,
} from './vocabulary.js';

/**
 * An AR scene: a finished garden design, resolved into things a 3D renderer can draw.
 *
 * The pipeline is `PlanDocument → buildARScene → ARScene → renderer`. The builder (web/API side,
 * not written yet) makes **every** geometric decision — where things are, how big, which way they
 * face, what the ground is cut into. The renderer (apps/mobile) draws what it is given and never
 * invents a position, a size or a layout. That is the same rule the rest of the project lives by:
 * geometry is authoritative, and presentation has no authority over it.
 *
 * **Draft v0.** Changes are additive — a new optional field, a new node kind a reader may skip —
 * and are reviewed by both developers (see `CHANGELOG.md`). A breaking change bumps
 * `AR_SCENE_VERSION`, and `minReaderVersion` is how an older app refuses a scene it cannot draw
 * rather than drawing it wrongly.
 *
 * Every length is metres, every point is in the scene frame described in `coordinates.ts`, and
 * points are tuples rather than `{x, y, z}` objects because a mesh is thousands of them.
 */

export const AR_SCENE_FORMAT = 'garden-studio/ar-scene';
export const AR_SCENE_VERSION = 0;

const Vec2Schema = z.tuple([z.number(), z.number()]);
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const RingSchema = z.array(Vec2Schema).min(3);
const HexColourSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

/**
 * Triangles, ready to draw. Flat arrays in the layout every engine uploads: three numbers per
 * position and normal, two per UV, three indices per triangle.
 *
 * **Counter-clockwise is the front face**, the glTF rule, so a ground surface's triangles face +Y.
 * A polygon that runs clockwise on the plan's screen also runs clockwise seen from +Y, so the
 * builder has to check winding rather than copy the outline's order — get it wrong and the engine
 * culls the whole lawn.
 *
 * UVs are **world-space**: `(X, Z) / tileSizeM` of the material. Tiling therefore comes out of the
 * data rather than an engine's texture-transform settings, and two abutting patios share one
 * pattern the way they do in the plan.
 */
export const MeshSchema = z.object({
  positions: z.array(z.number()),
  normals: z.array(z.number()),
  uvs: z.array(z.number()),
  indices: z.array(z.number().int().nonnegative()),
});
export type Mesh = z.infer<typeof MeshSchema>;

/** Where the scene's `[0, 0, 0]` is. Always at ground level, never on a door sill. */
export const SceneOriginSchema = z.object({
  /**
   * How it was chosen: the foot of the garden door where there is one (the most recognisable
   * point in a real garden, and the one every design is laid out from), else the midpoint of the
   * house wall facing the garden, else the middle of the plot.
   */
  kind: z.enum(['garden-door', 'garden-wall', 'boundary-centroid', 'custom']),
  /** The same point in plan metres, which is what makes `sceneToPlan` exact. */
  plan: z.object({ x: z.number(), y: z.number() }),
});

export const SceneFrameSchema = z.object({
  units: z.literal('m'),
  up: z.literal('+y'),
  handedness: z.literal('right'),
  origin: SceneOriginSchema,
  /** Unit vector along the ground pointing out of the house into the garden, if there is a house. */
  houseOutward: Vec2Schema.nullable(),
  /**
   * Unit vector along the ground pointing to true north, if the plan says. **Advisory only** — a
   * phone compass outdoors is off by ten or twenty degrees, so it may be drawn as a hint and must
   * never be used to place the garden.
   */
  north: Vec2Schema.nullable(),
  /** Where on Earth, if the user said. Null means no solar claim, exactly as in the plan. */
  location: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
});

/**
 * A point the user can find in the real garden and tap during alignment. The house's corners are
 * the best: they are rigid, recognisable and already measured in the plan.
 */
export const ReferencePointSchema = z.object({
  id: z.string(),
  kind: z.enum(['house-corner', 'door-centre', 'door-jamb', 'boundary-corner', 'gate-centre']),
  label: z.string(),
  at: Vec2Schema,
});
export type ReferencePoint = z.infer<typeof ReferencePointSchema>;

export const ARMaterialSchema = z.object({
  id: z.string(),
  label: z.string(),
  baseColor: HexColourSchema,
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  /**
   * A seamless texture and how many metres one repeat covers. `key` names an image, not a URL —
   * which file it is (the plan's ground textures in `apps/web/public/assets/plan/textures` are the
   * obvious source) is the renderer's business.
   */
  texture: z.object({ key: z.string(), tileSizeM: z.number().positive() }).nullable(),
});
export type ARMaterial = z.infer<typeof ARMaterialSchema>;

const NodeBaseSchema = z.object({
  id: z.string(),
  /** What in the plan this came from: a `DesignElement` id, `'house'`, `'boundary:<vertexId>'`. */
  sourceId: z.string().nullable(),
  category: ARCategorySchema,
  name: z.string().optional(),
  /** Something already in the real garden (`status: 'keep'` or an existing feature). */
  existing: z.boolean(),
  visibleByDefault: z.boolean(),
});

/**
 * Flat ground cover — lawn, paving, gravel, a bed's soil, water, a path — at height `y`.
 *
 * **Surfaces at the same height never overlap.** The plan stacks them on purpose (a base fill is a
 * whole zone and a patio is drawn over it), which is right for a painter and flickers in a depth
 * buffer. The builder cuts each surface by everything above it, so the renderer never needs a
 * layering trick. `outline` is kept beside the mesh for highlighting and hit-testing.
 */
export const SurfaceNodeSchema = NodeBaseSchema.extend({
  kind: z.literal('surface'),
  y: z.number(),
  material: z.string(),
  outline: RingSchema,
  mesh: MeshSchema,
});

/**
 * Anything built with height whose shape comes from the plan's geometry: the house, fences,
 * walls and hedges, retaining faces, edging, steps, and the structures that are whatever rectangle
 * the placer gave them — pergolas, sheds, raised beds. Arrives already triangulated.
 */
export const SolidNodeSchema = NodeBaseSchema.extend({
  kind: z.literal('solid'),
  parts: z.array(z.object({ material: z.string(), mesh: MeshSchema })).min(1),
});

/**
 * A product drawn from a model file: furniture, play equipment, a light fitting, a tree.
 *
 * `size` is `[width, height, depth]` in metres and is **the geometry of record** — there is
 * deliberately no `scale`, because a scale only means something against one particular file. The
 * renderer divides `size` by the model's measured natural size:
 *
 * - `contain`: one uniform scale, fitted inside the footprint. Furniture — a table is never
 *   stretched to fill an odd rectangle.
 * - `stretch`: width, height and depth are all exact. Trees and shrubs, whose spread and height the
 *   plan states.
 *
 * `position` is the base centre. At `yaw` 0 the model's front faces +Z (plan +y), width runs
 * along X and depth along Z.
 */
export const ModelNodeSchema = NodeBaseSchema.extend({
  kind: z.literal('model'),
  model: ModelKeySchema,
  position: Vec3Schema,
  yaw: z.number(),
  size: Vec3Schema,
  fit: z.enum(['contain', 'stretch']),
  fallback: FallbackShapeSchema,
});

/**
 * The infill of a planting bed, as instances of one clump model. The builder samples them the way
 * the plan does and thins them to a budget, so the AR bed is a subset of the drawn one rather than
 * a different planting.
 */
export const PlantsNodeSchema = NodeBaseSchema.extend({
  kind: z.literal('plants'),
  plant: PlantKeySchema,
  material: z.string(),
  instances: z.array(
    z.object({
      at: Vec3Schema,
      yaw: z.number(),
      spread: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
});

export const ARNodeSchema = z.discriminatedUnion('kind', [
  SurfaceNodeSchema,
  SolidNodeSchema,
  ModelNodeSchema,
  PlantsNodeSchema,
]);
export type ARNode = z.infer<typeof ARNodeSchema>;
export type SurfaceNode = z.infer<typeof SurfaceNodeSchema>;
export type SolidNode = z.infer<typeof SolidNodeSchema>;
export type ModelNode = z.infer<typeof ModelNodeSchema>;
export type PlantsNode = z.infer<typeof PlantsNodeSchema>;

export const ARSceneSchema = z.object({
  format: z.literal(AR_SCENE_FORMAT),
  version: z.number().int().nonnegative(),
  minReaderVersion: z.number().int().nonnegative(),
  /** Where it came from, so a phone can say which design and which save it is showing. */
  source: z.object({
    projectId: z.string().nullable(),
    projectName: z.string(),
    revision: z.number().int().nullable(),
    documentVersion: z.number().int().nullable(),
    layoutFingerprint: z.string().nullable(),
    builderVersion: z.string(),
    generatedAt: z.string(),
  }),
  frame: SceneFrameSchema,
  bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
  /** Flat, and only flat, in this version — the plan has no ground model either. */
  ground: z.object({ kind: z.literal('flat'), boundary: RingSchema }),
  referencePoints: z.array(ReferencePointSchema),
  materials: z.record(z.string(), ARMaterialSchema),
  nodes: z.array(ARNodeSchema),
});
export type ARScene = z.infer<typeof ARSceneSchema>;

/** Thrown when a scene was written for a newer app than this one. */
export class UnsupportedSceneVersionError extends Error {
  constructor(readonly minReaderVersion: number) {
    super(
      `This scene needs version ${minReaderVersion} of the scene format; this app reads ${AR_SCENE_VERSION}. Update the app.`,
    );
    this.name = 'UnsupportedSceneVersionError';
  }
}

/**
 * The way to read a scene from anywhere — a bundled fixture, a downloaded file, the API.
 *
 * Refuses a scene this reader is too old for *before* validating it, so the user is told to update
 * the app rather than shown a schema error about a field they have never heard of. Then checks
 * that every node names a material the scene actually defines, which zod alone cannot express.
 */
export function readARScene(raw: unknown): ARScene {
  const declared = z.object({ minReaderVersion: z.number() }).safeParse(raw);
  if (declared.success && declared.data.minReaderVersion > AR_SCENE_VERSION) {
    throw new UnsupportedSceneVersionError(declared.data.minReaderVersion);
  }
  const scene = ARSceneSchema.parse(raw);
  for (const node of scene.nodes) {
    for (const material of materialsOf(node)) {
      if (!(material in scene.materials)) {
        throw new Error(
          `Node ${node.id} uses material "${material}", which the scene does not define.`,
        );
      }
    }
  }
  return scene;
}

function materialsOf(node: ARNode): string[] {
  switch (node.kind) {
    case 'surface':
    case 'plants':
      return [node.material];
    case 'solid':
      return node.parts.map((part) => part.material);
    case 'model':
      return [];
  }
}
