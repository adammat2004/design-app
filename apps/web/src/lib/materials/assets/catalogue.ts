import { z } from 'zod';
import { ASSET_FAMILIES, type AssetId } from './asset-spec';
import raw from './catalogue.json';

/**
 * What `tools/assets` wrote: one entry per generated file, with the numbers the renderer reads.
 *
 * Parsed at import so a hand-edited or half-written catalogue fails at startup with a Zod error
 * naming the field, rather than as a texture that quietly never appears. Entries whose id is not a
 * family in `asset-spec.ts` are dropped rather than refused — a family renamed after generation
 * leaves an orphan file, and an orphan is not a reason to stop drawing everything else.
 */
export const CatalogueEntrySchema = z.object({
  id: z.string(),
  variant: z.number().int().positive(),
  /** Relative to `public/assets/`. */
  file: z.string(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  meanColour: z.string().regex(/^#[0-9a-f]{6}$/),
  opaqueRadiusRatio: z.number().nonnegative().optional(),
  /** Edge mismatch ÷ interior grain: about 1 for a seamless tile. See the tool's `SEAM_THRESHOLD`. */
  seamScore: z.number().nonnegative().optional(),
  /**
   * Where the opaque pixels actually are, as fractions of the image. Elevated sprites only.
   *
   * `opaqueRadiusRatio` is the plan camera's question — how far the foliage reaches from the middle,
   * so a canopy can be inscribed in the circle the placer eroded by. It is the wrong measure for an
   * elevated sprite, which is framed from its *foot* rather than its centre and is deliberately not
   * square: a tree's opaque pixels reach much further up than down, and one radius cannot say that.
   *
   * A box can. It is what the QA pass checks the framing against — an object that fills its frame,
   * touches no edge, and leaves the bottom margin clear of anything that is not its footprint.
   */
  opaqueBounds: z
    .object({
      minX: z.number(),
      minY: z.number(),
      maxX: z.number(),
      maxY: z.number(),
    })
    .optional(),
  /**
   * How much of the frame's bottom edge band is opaque, 0-1. Elevated sprites only.
   *
   * The ground-plane detector. The single most common way a model ignores "no ground, no shadow" is
   * to return the object standing on a patch of grass or a soft grey ellipse, and that patch reaches
   * the bottom of the frame right across its width. A sofa's own legs touch the bottom too, but they
   * are a few percent of it; a ground plane is most of it.
   */
  footAlpha: z.number().min(0).max(1).optional(),
  /**
   * Where this file came from.
   *
   * Optional, so the 43 families generated before it existed still parse — and that is also the
   * point of recording it from here on. The library is going to become mixed-vintage the first
   * time a better image model appears, and without this there is no way to ask "which of these were
   * made by the old model" or "which would change if I edited this prompt". Both are questions a
   * selective regeneration needs answered, and neither can be reconstructed after the fact.
   *
   * `promptHash` rather than the prompt itself: the prompt already lives in `asset-spec.ts`, which
   * is the specification, and copying it here would give it two homes that can disagree. The hash
   * only has to answer "is this file still the one that sentence describes".
   */
  provenance: z
    .object({
      model: z.string(),
      generatedAt: z.string(),
      promptHash: z.string(),
    })
    .optional(),
});
export type CatalogueEntry = z.infer<typeof CatalogueEntrySchema> & { id: AssetId };

const CatalogueSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  assets: z.array(CatalogueEntrySchema),
});

const parsed = CatalogueSchema.parse(raw);

function isAssetId(id: string): id is AssetId {
  return Object.prototype.hasOwnProperty.call(ASSET_FAMILIES, id);
}

/** Hash of the generated files. `'none'` before anything was ever generated. */
export const CATALOGUE_VERSION: string = parsed.assets.length > 0 ? parsed.version : 'none';

const ENTRIES: CatalogueEntry[] = parsed.assets.filter((entry): entry is CatalogueEntry =>
  isAssetId(entry.id),
);

const BY_ID = new Map<AssetId, CatalogueEntry[]>();
for (const entry of ENTRIES) {
  const list = BY_ID.get(entry.id) ?? [];
  list.push(entry);
  list.sort((a, b) => a.variant - b.variant);
  BY_ID.set(entry.id, list);
}

/** Every generated variant of a family, in variant order. Empty when none was generated. */
export function catalogueVariants(id: AssetId): CatalogueEntry[] {
  return BY_ID.get(id) ?? [];
}

export function catalogueEntry(id: AssetId, variant: number): CatalogueEntry | null {
  return BY_ID.get(id)?.find((entry) => entry.variant === variant) ?? null;
}

export function catalogueEntries(): CatalogueEntry[] {
  return ENTRIES;
}
