import { z } from 'zod';
import raw from './pbr-catalogue.json';

/**
 * What `tools/assets fetch:pbr` wrote. Parsed at import, so a hand-edited catalogue fails loudly with
 * a Zod error naming the field rather than as a sky that quietly never loads.
 */
export const PbrFileSchema = z.object({
  /** Relative to `public/assets/`. */
  file: z.string(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const HdriEntrySchema = PbrFileSchema.extend({
  id: z.string(),
  source: z.literal('polyhaven'),
  asset: z.string(),
  resolution: z.string(),
  licence: z.literal('CC0-1.0'),
  author: z.string(),
  page: z.string().url(),
  fetchedAt: z.string(),
});

export const PbrSetEntrySchema = z.object({
  id: z.string(),
  source: z.enum(['polyhaven', 'ambientcg', 'generated']),
  asset: z.string().nullable(),
  author: z.string(),
  page: z.string().nullable(),
  licence: z.literal('CC0-1.0'),
  tileSizeM: z.number().positive(),
  px: z.number().int().positive(),
  files: z.object({
    albedo: PbrFileSchema.nullable(),
    normal: PbrFileSchema,
    orm: PbrFileSchema,
  }),
  /** The packed albedo's mean, in linear RGB: what a finish's colour is divided by. */
  meanLinearColour: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  /** The roughness channel's mean: what a finish's roughness is divided by. */
  meanRoughness: z.number().positive().max(1),
  fetchedAt: z.string(),
});

export const PbrCatalogueSchema = z.object({
  version: z.literal(1),
  hdri: HdriEntrySchema.nullable(),
  sets: z.record(PbrSetEntrySchema).default({}),
});

export type PbrCatalogue = z.infer<typeof PbrCatalogueSchema>;
export type HdriEntry = z.infer<typeof HdriEntrySchema>;
export type PbrSetEntry = z.infer<typeof PbrSetEntrySchema>;

export const PBR_CATALOGUE: PbrCatalogue = PbrCatalogueSchema.parse(raw);
