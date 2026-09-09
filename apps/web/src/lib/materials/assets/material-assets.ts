import type { MaterialId, SymbolId } from '@garden-studio/schema';
import { ASSET_IDS, type AssetId } from './asset-spec';
import { assetsMatching, type TaxonQuery } from './taxonomy';

/**
 * Which asset each material draws with.
 *
 * `Partial`, matching `MATERIAL_PATTERNS` and for the same reason: a material without an asset is
 * a legitimate answer, and means "the procedural pattern, exactly as before". A material listed
 * here whose files were never generated gets the same treatment at runtime, because the registry
 * answers `null` for it.
 *
 * `face` is painted per module by the grid and board painters; `texture` is tiled in pattern
 * space; `sprites` are the units the scatter painter places, chosen per unit by the same seeded
 * generator that places them. A planting material has a texture *and* sprites: the texture is the
 * soil the plants sit on.
 */
export interface MaterialAssets {
  face?: AssetId;
  texture?: AssetId;
  sprites?: AssetId[];
  /** Roughly what share of scatter units carry a flower sprite on top. */
  flowers?: { sprite: AssetId; share: number };
}

/**
 * What a material draws with, as written by hand.
 *
 * The difference from `MaterialAssets` is `sprites`, which is a **query** rather than a list. That
 * is the whole of the change: a mixed border asks for perennials and shrubs, and every family that
 * classifies itself that way joins — so adding a plant is a manifest entry plus a tool run, with no
 * table anywhere else to remember to edit.
 *
 * `face` and `texture` stay named on purpose. The photograph of a porcelain tile *is* the
 * photograph of that product, and letting `porcelain` pick up a limestone face by family
 * resemblance would be a worse lookup table rather than a better one. See `taxonomy.ts`.
 */
export interface MaterialAssetSpec {
  face?: AssetId;
  texture?: AssetId;
  sprites?: TaxonQuery;
  flowers?: { sprite: AssetId; share: number };
}

export const MATERIAL_ASSETS: Partial<Record<MaterialId, MaterialAssetSpec>> = {
  /* ---- paved-area ---- */
  'stone-pavers': { face: 'face-stone-paver' },
  concrete: { face: 'face-concrete-slab' },
  porcelain: { face: 'face-porcelain-tile' },
  'stepping-stones': { face: 'face-stepping-stone', texture: 'tex-standard-turf' },
  'timber-decking': { face: 'face-decking-wood' },
  'gravel-paving': { texture: 'tex-gravel-paving' },

  /* ---- lawn ---- */
  'standard-turf': { texture: 'tex-standard-turf' },
  'hardwearing-turf': { texture: 'tex-hardwearing-turf' },
  'artificial-turf': { texture: 'tex-artificial-turf' },
  wildflower: {
    texture: 'tex-meadow-grass',
    sprites: { group: 'vegetation', type: 'flower' },
  },

  /* ---- planting-bed ---- */
  /*
   * The one bed that asks for two things. A mixed border *is* the mixture, so it takes every
   * perennial and every shrub in the library rather than a chosen pair — which is exactly the case
   * the query exists for: the more plants the library grows, the better this bed gets, for free.
   */
  'mixed-border': {
    texture: 'tex-soil',
    sprites: { group: 'vegetation', type: ['perennial', 'shrub'] },
    flowers: { sprite: 'plant-flower', share: 0.25 },
  },
  shrubs: { texture: 'tex-soil', sprites: { group: 'vegetation', type: 'shrub' } },
  'ornamental-grasses': {
    texture: 'tex-soil',
    sprites: { group: 'vegetation', type: 'grass-ornamental' },
  },
  /*
   * Crowns as sprites now, on the hedge-top texture as their ground. The crown families were
   * generated in Phase D and drawn by nothing until the run painter existed — one of the four
   * exemptions `AWAITING_A_CONSUMER` was holding.
   */
  hedging: {
    texture: 'tex-hedge-top',
    sprites: { group: 'vegetation', type: 'hedge-crown' },
  },
  'ground-cover': { texture: 'tex-soil', sprites: { group: 'vegetation', type: 'ground-cover' } },

  /* ---- gravel-mulch ---- */
  'bark-mulch': { texture: 'tex-bark-mulch' },
  'decorative-gravel': { texture: 'tex-decorative-gravel' },
  'play-bark': { texture: 'tex-play-bark' },
  'slate-chippings': { texture: 'tex-slate-chippings' },

  /* ---- structure ---- */
  softwood: { face: 'face-softwood' },
  'painted-timber': { face: 'face-painted-timber' },
  hardwood: { face: 'face-hardwood' },

  /* ---- water-feature ---- */
  'naturalistic-pond': { texture: 'tex-pond-water' },
  'formal-pool': { texture: 'tex-pool-water' },
  rill: { texture: 'tex-pool-water' },
  'water-bowl': { texture: 'tex-pool-water' },
};

/** The canopies a tree point is drawn with. */
/**
 * The canopies a tree may be drawn with.
 *
 * A query, so every tree family added later joins without touching this file — which is the point,
 * because trees are the group most obviously short of variety today (one canopy for every tree in
 * every plan).
 *
 * **Deciduous only, for now, and deliberately.** `tree-conifer` exists in the manifest and has
 * never been drawn — exactly the dead asset the taxonomy is meant to stop happening. Widening this
 * to include it would fix that and make it worse at the same time: nothing yet *chooses* between a
 * broadleaf and a conifer, so a garden would get a random mix, and a random mix is not a design.
 * Phase F gives trees their own species symbols; that is where this opens up, per species.
 */
export const CANOPY_QUERY: TaxonQuery = { group: 'vegetation', type: 'tree-deciduous' };

/**
 * Which canopies each tree symbol draws from.
 *
 * The point of giving trees species symbols: a plan now *chooses* rather than lands on one. That is
 * what finally lets the conifer be drawn — it has been in the library since Phase D and was
 * deliberately kept out of the general canopy pool, because with nothing choosing, a garden would
 * have got a random mix of broadleaf and conifer and a random mix is not a design.
 *
 * A query rather than a family per symbol, so a second cherry or a third birch joins the tree it
 * belongs to without touching this file.
 */
export const TREE_CANOPY_QUERIES: Record<string, TaxonQuery> = {
  'tree-deciduous': { group: 'vegetation', type: 'tree-deciduous', tags: ['broadleaf'] },
  'tree-ornamental': { group: 'vegetation', type: 'tree-deciduous', tags: ['ornamental'] },
  'tree-evergreen': { group: 'vegetation', type: 'tree-evergreen' },
  'tree-multistem': { group: 'vegetation', type: 'tree-deciduous', tags: ['multi-stem'] },
  'tree-fruit': { group: 'vegetation', type: 'tree-deciduous', tags: ['fruit'] },
};

/**
 * The canopies a tree symbol may draw with, falling back to the general pool.
 *
 * Total by construction: a tree whose symbol names no query — an old plan, or a point element with
 * no symbol at all — still gets a canopy, which is what every tree got before species existed.
 */
export function canopiesForSymbol(symbol: string | undefined, plantId?: string): AssetId[] {
  if (plantId === 'acer-palmatum-red') return ['tree-japanese-maple'];
  const query = symbol ? TREE_CANOPY_QUERIES[symbol] : undefined;
  const found = query ? assetsMatching(query) : [];
  return found.length > 0 ? found : CANOPY_SPRITES;
}

/** Resolved once. Kept as a name because two renderers and a test read it. */
export const CANOPY_SPRITES: AssetId[] = assetsMatching(CANOPY_QUERY);

/**
 * Which sprite family draws each symbol. Absent means the symbol is *drawn* — a pergola is posts
 * and beams at whatever size the placer gave it, which no photograph could be stretched into.
 */
export const SYMBOL_SPRITES: Partial<Record<SymbolId, AssetId>> = {
  'dining-set-4': 'furniture-dining-4',
  'dining-set-6': 'furniture-dining-6',
  'sofa-set': 'furniture-sofa-set',
  lounger: 'furniture-lounger',
  bbq: 'furniture-bbq',
  'fire-pit': 'furniture-fire-pit',
  bench: 'furniture-bench',
  parasol: 'furniture-parasol',
  planter: 'furniture-planter',
  swing: 'play-swing',
  slide: 'play-slide',
  trampoline: 'play-trampoline',
  'raised-bed': 'play-raised-bed',
  specimen: 'plant-shrub',
  /*
   * The three structural shrubs, mapped to the families Phase D generated for them. Architectural
   * gets its own; the other two share the general shrub families, which is honest — a photograph of
   * an evergreen mound and one of a flowering shrub in leaf are not reliably different from above,
   * and the palette's tint is what carries the distinction.
   */
  'shrub-evergreen': 'plant-shrub',
  'shrub-flowering': 'plant-shrub-deciduous',
  'shrub-architectural': 'plant-shrub-architectural',
};

/** The disc every sprite stands on. */
export const CONTACT_SHADOW_SPRITE: AssetId = 'fx-soft-shadow';

/**
 * What this material draws with, sprites resolved.
 *
 * The one place a query becomes a list. `assetsMatching` is memoised on the query's shape and
 * `ASSET_FAMILIES` is a compile-time constant, so this stays cheap enough to sit in the render
 * path — which it does: `resolveAssets` calls it once per surface per layer.
 */
export function materialAssets(materialId: string | undefined): MaterialAssets | null {
  if (!materialId) return null;

  const spec = MATERIAL_ASSETS[materialId as MaterialId];
  if (!spec) return null;

  return {
    face: spec.face,
    texture: spec.texture,
    sprites: spec.sprites ? assetsMatching(spec.sprites) : undefined,
    flowers: spec.flowers,
  };
}

/**
 * Every asset family a given plan actually draws with.
 *
 * The input to `preloadAssets`' first wave. A plan with no water needs none of the water tiles and
 * a plan with no play area needs no trampoline, so naming what it *does* need is what lets the
 * visible drawing texture quickly while the rest of the library follows.
 *
 * Deliberately generous at the edges. The contact shadow is always included because every sprite
 * stands on one; canopies are included whenever anything is a point feature, because a tree is the
 * most conspicuous thing on a plan and the cheapest mistake here is loading one file too many.
 *
 * A plain function of the elements, not a hook and not a store read — the same rule the rest of
 * this directory follows, and it is what lets the node-side tools call it too.
 */
export function assetsForElements(elements: { material?: string; symbol?: string }[]): AssetId[] {
  const wanted = new Set<AssetId>([CONTACT_SHADOW_SPRITE, ...CANOPY_SPRITES]);

  for (const element of elements) {
    const assets = materialAssets(element.material);
    if (assets) {
      if (assets.face) wanted.add(assets.face);
      if (assets.texture) wanted.add(assets.texture);
      for (const sprite of assets.sprites ?? []) wanted.add(sprite);
      if (assets.flowers) wanted.add(assets.flowers.sprite);
    }

    const symbol = element.symbol ? SYMBOL_SPRITES[element.symbol as SymbolId] : undefined;
    if (symbol) wanted.add(symbol);
  }

  // Manifest order, for the reason `assetsMatching` returns it: stable and inspectable.
  return ASSET_IDS.filter((id) => wanted.has(id));
}
