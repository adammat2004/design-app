import { z } from 'zod';
import raw from './furniture-models.json';

/**
 * What `tools/assets fetch:models` wrote. Shaped like the AR document's `ModelSpec` — pivot, front,
 * natural size, triangles, texture ceiling, licence, source — so the phone's model manifest can be the
 * same file. Parsed at import, so a hand-edited manifest fails loudly rather than as a model that
 * quietly never draws.
 */
export const FurnitureModelEntrySchema = z.object({
  key: z.string(),
  /** Relative to `public/`. */
  file: z.string(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  triangles: z.number().int().positive(),
  naturalSize: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  pivot: z.literal('base-centre'),
  front: z.literal('+z'),
  slots: z.array(z.literal('finish')),
  maxTexturePx: z.number().int().nonnegative(),
  licence: z.literal('CC0-1.0'),
  sources: z.array(
    z.object({ asset: z.string(), author: z.string(), page: z.string().url(), md5: z.string() }),
  ),
  fetchedAt: z.string(),
});

export const FurnitureManifestSchema = z.object({
  version: z.literal(1),
  models: z.record(FurnitureModelEntrySchema),
});

export type FurnitureModelEntry = z.infer<typeof FurnitureModelEntrySchema>;

export const FURNITURE_MANIFEST = FurnitureManifestSchema.parse(raw);
