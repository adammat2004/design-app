import { z } from 'zod';

/**
 * The model library: 3D models of garden products, generated once, reviewed by a person, checked
 * in, and drawn in place of a node's own geometry where one fits. (Added in 0.0.3.)
 *
 * ## Why this is in the contract
 *
 * The web preview and the phone both have to answer "which file draws library model
 * `gazebo-classic-dark-stained-3x3`, and what size is it in that file". Two readers of one
 * manifest should parse it with one schema, and the phone imports this package and nothing else.
 * The scene still names no file: a node carries an `AssetRef` whose `id` is looked up here.
 *
 * ## What an entry promises
 *
 * - **Metres, +Y up, the base centred on the origin, the front towards +Z** — the scene's own
 *   convention, applied when the model was published, so a renderer applies no correction of its
 *   own. `naturalSize` is measured on the published file.
 * - **Immutable once published.** A regenerated model is a new id. A phone holding an older copy
 *   of the library must never draw a different file under the same name, because the builder chose
 *   that id against *its* measurements.
 * - **Self-contained**: one GLB, textures embedded, core metallic-roughness PBR only.
 *
 * `depicts` is what the model is of, in the plan's vocabulary but as plain strings — the same
 * trade `ModelKey` makes, so the phone never imports the schema. It is what a builder matches an
 * element against; a renderer never reads it.
 */

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Lower-case words joined by hyphens: `gazebo-classic-dark-stained-3x3`. Also the file stem. */
export const ModelAssetIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9.]+)*$/)
  .max(80);

export const ModelDepictsSchema = z.object({
  /** A `SymbolId`. */
  symbol: z.string(),
  /** A configurable structure's resolved hard facts, or `null` for anything else. */
  structure: z
    .object({
      model: z.string(),
      roofKind: z.string(),
      roofFinish: z.string(),
      frame: z.string(),
      sides: z.object({ left: z.string(), right: z.string(), rear: z.string() }),
      lighting: z.boolean(),
    })
    .nullable(),
  /** A `MaterialId`, for something that is not a configurable structure. */
  material: z.string().nullable(),
  /** A `StyleDirection`, or `null`. Flavour, never a hard match. */
  style: z.string().nullable(),
});
export type ModelDepicts = z.infer<typeof ModelDepictsSchema>;

export const ModelLibraryEntrySchema = z.object({
  id: ModelAssetIdSchema,
  /** Relative to the web app's public root, e.g. `models/library/<id>.glb`. */
  file: z.string(),
  /** A small picture for a chooser, beside the file, or `null`. */
  thumbnail: z.string().nullable(),
  bytes: z.number().int().positive(),
  sha256: Sha256Schema,
  triangles: z.number().int().positive(),
  /** The largest texture's longer side, in pixels. */
  maxTexturePx: z.number().int().nonnegative(),
  depicts: ModelDepictsSchema,
  /** Width (X), height (Y) and depth (Z) of the published file's bounding box, in metres. */
  naturalSize: Vec3Schema,
  pivot: z.literal('base-centre'),
  up: z.literal('+y'),
  front: z.literal('+z'),
  fit: z.object({
    /**
     * How far each axis may be stretched or squashed to fit an element, as a fraction: 0.15 lets a
     * 3 m model draw a 2.6–3.45 m element. Beyond it the model is the wrong size for the element
     * and the node's own geometry draws instead.
     */
    tolerance: z.number().min(0).max(0.5),
    /** Square enough, and symmetric enough, to be turned a quarter to fit. */
    turnable: z.boolean(),
  }),
  /** Models of one geometry in different finishes share a family (a retexture keeps the family). */
  familyId: z.string(),
  /**
   * How far the published file was stretched upright from the proportions Meshy gave it, where a
   * reviewer chose to fit its height. Absent means 1: uniform scale only. Provenance — a renderer
   * never reads it; `naturalSize` is already the stretched size.
   */
  heightStretch: z.number().positive().optional(),
  source: z.object({
    provider: z.literal('meshy'),
    endpoint: z.string(),
    taskId: z.string(),
    aiModel: z.string(),
    credits: z.number().int().nonnegative(),
    /** sha256 of the spec's canonical form, and the spec version it was written under. */
    specHash: Sha256Schema,
    specVersion: z.string(),
    /** sha256 of the reference image the model was generated from. */
    referenceSha256: Sha256Schema,
    generatedAt: z.string().datetime(),
  }),
  /** Meshy's paid plans give private ownership of the output; free-plan output is CC BY 4.0. */
  licence: z.string(),
  approvedAt: z.string().datetime(),
});
export type ModelLibraryEntry = z.infer<typeof ModelLibraryEntrySchema>;

export const MODEL_LIBRARY_VERSION = 1;

export const ModelLibrarySchema = z
  .object({
    version: z.literal(MODEL_LIBRARY_VERSION),
    entries: z.array(ModelLibraryEntrySchema),
  })
  .superRefine((library, context) => {
    const seen = new Set<string>();
    for (const [index, entry] of library.entries.entries()) {
      if (seen.has(entry.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'id'],
          message: `duplicate library id ${entry.id}`,
        });
      }
      seen.add(entry.id);
    }
  });
export type ModelLibrary = z.infer<typeof ModelLibrarySchema>;

/** The library with nothing in it: what a renderer has before `library.json` loads, or without it. */
export const EMPTY_MODEL_LIBRARY: ModelLibrary = { version: MODEL_LIBRARY_VERSION, entries: [] };

/** One entry by id, or `null`. */
export function libraryEntry(library: ModelLibrary, id: string): ModelLibraryEntry | null {
  return library.entries.find((entry) => entry.id === id) ?? null;
}
