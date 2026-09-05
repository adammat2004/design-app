import { ASSET_FAMILIES, ASSET_IDS, type AssetFamily, type AssetGroup, type AssetId } from './asset-spec';

/**
 * Asking for an asset instead of naming one.
 *
 * ## Why
 *
 * `MATERIAL_ASSETS` listed each material's sprites by family id. That is fine at forty-three
 * assets and impossible at four hundred: adding one perennial meant remembering to edit a table in
 * another file, and forgetting meant generating an image the app never drew. Worse, the table is
 * the thing a *user-facing* palette would have to grow alongside, which is exactly the coupling the
 * plan set out to remove — "hundreds of assets without hardcoding them into UI components".
 *
 * With a query, a mixed border asks for perennials and shrubs, and any family that classifies
 * itself that way joins. Adding a plant becomes one manifest entry plus a tool run.
 *
 * ## Where it deliberately does not apply
 *
 * Faces and textures stay named. The photograph of a porcelain tile *is* the photograph of that
 * product, and letting `porcelain` pick up a limestone face by family resemblance would be a worse
 * lookup table, not a better one. A symbol is the same: `dining-set-6` is one specific thing, and
 * its variety belongs in `variants`, not in the resolution.
 *
 * So the query exists for **vegetation**, which is where the hundreds of assets are going and what
 * the planting engine needs.
 *
 * ## Determinism
 *
 * A query returns families in **manifest order**, always. Every consumer downstream picks from that
 * list with a seeded generator keyed on a grid cell, so the list's order is part of what a bed
 * looks like — sorting it by anything computed, or by insertion into a `Set`, would reshuffle every
 * planted bed in every saved plan the next time somebody added an asset. Manifest order is stable,
 * inspectable and under the author's control, which is what that job needs.
 *
 * ## What appending does and does not buy
 *
 * Be precise about this, because the obvious claim is wrong. `pick` indexes by
 * `floor(random × length)`, so **growing a group changes what every existing plan draws from it**,
 * appended or not — a bed that chose between one shrub now chooses between three, and chooses
 * differently. Appending does not prevent that and nothing short of freezing the library would.
 *
 * What appending buys is narrower and still worth having: an id already in the list keeps its
 * position, so a change is confined to the group that grew rather than shuffling every group that
 * happens to sort after it. Insert into the middle and unrelated materials move too.
 *
 * The change itself is acceptable, and the alternative is worse. A plan's value here is its
 * geometry, which is untouched: the bed is the same shape, the same area and the same schedule
 * line, and what changed is which photograph of a shrub is in it. Freezing instead would mean every
 * asset generated from now on reaches only new plans, which is not a library at all.
 */

export interface TaxonQuery {
  group?: AssetGroup;
  /** One type, or any of several. Absent matches every type in the group. */
  type?: string | readonly string[];
  /** Every tag listed must be present. Absent matches regardless of tags. */
  tags?: readonly string[];
  /** Metres. Families whose natural size falls outside are skipped. */
  minMetres?: number;
  maxMetres?: number;
}

function matches(family: AssetFamily, query: TaxonQuery): boolean {
  const { taxon } = family;

  if (query.group && taxon.group !== query.group) return false;

  if (query.type) {
    const wanted = typeof query.type === 'string' ? [query.type] : query.type;
    if (!wanted.includes(taxon.type)) return false;
  }

  if (query.tags && query.tags.length > 0) {
    const has = taxon.tags ?? [];
    if (!query.tags.every((tag) => has.includes(tag))) return false;
  }

  if (query.minMetres !== undefined || query.maxMetres !== undefined) {
    // The larger side, because that is what a sprite is fitted by — see `spriteBox`.
    const size = Math.max(family.metres.w, family.metres.h);
    if (query.minMetres !== undefined && size < query.minMetres) return false;
    if (query.maxMetres !== undefined && size > query.maxMetres) return false;
  }

  return true;
}

/**
 * Memoised on the query's own shape.
 *
 * `ASSET_FAMILIES` is a compile-time constant, so a query's answer can never change within a
 * session — and the callers are inside the render loop, where a linear scan of every family per
 * surface per frame would be real waste for an answer that is the same every time.
 */
const cache = new Map<string, AssetId[]>();

export function assetsMatching(query: TaxonQuery): AssetId[] {
  const key = JSON.stringify([
    query.group ?? '',
    query.type ?? '',
    query.tags ?? '',
    query.minMetres ?? '',
    query.maxMetres ?? '',
  ]);

  const held = cache.get(key);
  if (held) return held;

  // Manifest order — see the note above about why this must not be sorted.
  const found = ASSET_IDS.filter((id) => matches(ASSET_FAMILIES[id] as AssetFamily, query));
  cache.set(key, found);

  return found;
}

/** Whether an asset may be carried towards a material's palette. Absent means no. */
export function isRecolourable(id: AssetId): boolean {
  // Read through `AssetFamily`: the manifest is `as const`, so a literal that omits an optional
  // field narrows to a type that does not have it at all.
  const family: AssetFamily = ASSET_FAMILIES[id];
  return family.recolourable === true;
}

/**
 * Where the thing stands inside its own image, as a fraction. Centred unless the family says
 * otherwise, which is what every asset generated so far is — the sprite prompt says "centred".
 */
export function assetAnchor(id: AssetId): { x: number; y: number } {
  const family: AssetFamily = ASSET_FAMILIES[id];
  return family.anchor ?? { x: 0.5, y: 0.5 };
}

/* ---------------------------------------------------------------- test seams */

export function clearTaxonomyCache(): void {
  cache.clear();
}
