import { isTreeSymbol, resolveSymbol, type MaterialId, type SymbolId } from '@garden-studio/schema';
import { ASSET_IDS, type AssetId } from './asset-spec';
import { catalogueVariants } from './catalogue';
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
  'stone-setts': { face: 'face-stone-setts' },

  /* ---- edging and walling: no category, but real products with real faces ---- */
  'brick-edging': { face: 'face-edging-brick' },
  'concrete-kerb': { face: 'face-kerb-concrete' },
  'sett-edging': { face: 'face-edging-setts' },
  'timber-sleeper': { face: 'face-sleeper-timber' },
  'walling-stone': { face: 'face-walling-stone' },
  /* A brick is a brick: the walling course and the edging course draw the same photograph. */
  'brick-walling': { face: 'face-edging-brick' },
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
  // The only structure here: a hot tub is a product at a fixed size, not a placed rectangle.
  'hot-tub': 'feature-hot-tub',
  bench: 'furniture-bench',
  parasol: 'furniture-parasol',
  planter: 'furniture-planter',
  swing: 'play-swing',
  slide: 'play-slide',
  trampoline: 'play-trampoline',
  'raised-bed': 'play-raised-bed',
  'light-spike': 'light-spike',
  'light-bollard': 'light-bollard',
  'light-recessed': 'light-recessed',
  'light-wall': 'light-wall',
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

/* ================================================================ the elevated camera
 *
 * How Visualise reaches the 2.5D library, and why it is a *translation* rather than a second set of
 * queries.
 *
 * The obvious design is to give every query a camera and let Visualise ask for elevated art
 * directly. It is wrong in a way that is invisible until you look at a bed: a query is answered in
 * manifest order and the sampler picks from that list with a seeded index, so two queries returning
 * different-length lists put a *different plant* in each cell. The same garden would be planted
 * differently in the two views — same geometry, different species — and switching tabs would look
 * like the design had changed, which is the one thing §12 says must never happen.
 *
 * So resolution happens exactly once, in the plan camera, with the same query and the same seed it
 * always used, and the elevated view then swaps the family for its twin. Same cell, same species,
 * same variant, drawn from a different angle. That is what "two views of one plan" has to mean.
 *
 * It also gives the fallback for free, which matters more than it sounds: a family with no twin, or
 * a twin whose files have not been generated, keeps its plan sprite. So Visualise works with a
 * half-finished library and with **no library at all** — the no-key path this whole directory
 * exists to protect.
 * ================================================================ */

/**
 * The elevated twin of a plan-camera family, where one has been drawn.
 *
 * Deliberately many-to-one in places: `plant-grass` and `plant-grass-tall` share a twin, because the
 * elevated library is a foundation rather than a catalogue and a grass seen from twelve degrees off
 * vertical is a fountain of blades whichever species it is. Widening it is adding a row.
 *
 * Note there is no twin for anything drawn rather than photographed — no shed, pergola, gazebo or
 * fence — because those are extruded from their own outlines. A twin here would be a photograph of
 * a structure, which is the mistake the whole extrusion path exists to avoid.
 */
export const ELEVATED_TWINS: Partial<Record<AssetId, AssetId>> = {
  'plant-shrub': 'vis-shrub-evergreen',
  'plant-shrub-architectural': 'vis-shrub-evergreen',
  'plant-shrub-deciduous': 'vis-shrub-flowering',
  'plant-shrub-topiary': 'vis-shrub-evergreen',
  'plant-grass': 'vis-grass',
  'plant-grass-tall': 'vis-grass',
  'tree-canopy': 'vis-tree-deciduous',
  'tree-multistem': 'vis-tree-multistem',
  'furniture-dining-6': 'vis-dining-6',
  'furniture-dining-4': 'vis-dining-6',
  'furniture-sofa-set': 'vis-sofa-set',
  'furniture-lounger': 'vis-lounger',
  'furniture-bench': 'vis-bench',
  'furniture-bbq': 'vis-bbq',
  'furniture-fire-pit': 'vis-fire-pit',
  'furniture-parasol': 'vis-parasol',
  'furniture-planter': 'vis-planter',
  'play-raised-bed': 'vis-raised-bed',
  'play-swing': 'vis-swing',
  'play-slide': 'vis-slide',
  'play-trampoline': 'vis-trampoline',
};

/**
 * The family Visualise should draw instead, or `null` to keep the plan sprite.
 *
 * Catalogued rather than merely listed: a twin that has been *specified* but not yet *generated*
 * must fall back, or the elevated view would resolve to a family with no files and draw nothing at
 * all. That is the difference between a library arriving in batches and a garden with holes in it
 * while it does.
 *
 * The catalogue rather than the registry, deliberately — what has been *generated*, not what has
 * finished *loading*. Loading is asynchronous and per-wave, so keying on it would have a bed swap
 * species halfway through a preload; `assetVersion()` is already in the raster key for exactly that
 * reason and this must not introduce a second, subtler version of the same flicker.
 */
export function elevatedTwin(id: AssetId | null | undefined): AssetId | null {
  if (!id) return null;
  const twin = ELEVATED_TWINS[id];
  return twin && catalogueVariants(twin).length > 0 ? twin : null;
}

/**
 * The elevated family an element would draw as, or `null` to keep the plan drawing.
 *
 * The element side of `elevatedTwin`, and it resolves **through the plan camera first** for the
 * reason the twin table exists at all: a tree's species already chose a canopy family, and a
 * symbol already chose a sprite, so translating that choice keeps the two views drawing the same
 * plant rather than two different ones.
 *
 * A tree walks its species' canopy pool in order and takes the first family that has a twin, which
 * is what lets the library arrive one species at a time: an oak with no elevated twin keeps drawing
 * the canopy it always drew, beside a birch that has one.
 */
export function elevatedFamilyFor(element: {
  symbol?: string | undefined;
  plantId?: string | undefined;
}): AssetId | null {
  const symbol = resolveSymbol(element);
  if (!symbol) return null;

  if (isTreeSymbol(symbol)) {
    for (const id of canopiesForSymbol(symbol, element.plantId)) {
      const twin = elevatedTwin(id);
      if (twin) return twin;
    }
    return null;
  }

  return elevatedTwin(SYMBOL_SPRITES[symbol]);
}

/**
 * The material a visible vertical face is skinned with.
 *
 * Keyed by what the renderer already knows about the thing rather than by a new enum — a boundary
 * has a `BoundaryKind`, a roof has a `RoofMaterial` — so there is nothing here to keep in step with
 * anything. Absent is a real answer and the common one: a face with no skin is filled with its
 * palette tone shaded by its own normal, which is what every drawn structure does today.
 *
 * These are `texture` families and lit flat on purpose. The renderer shades a face from that face's
 * normal against the scene light; art with its own baked light would be shaded twice and the two
 * would disagree the moment the sun moved.
 */
export const BOUNDARY_SKINS: Partial<Record<string, AssetId>> = {
  fence: 'skin-fence-boards',
  wall: 'skin-render',
};

/** Every pitched roof in the library is slate today; the field exists so that can change. */
export const ROOF_SKINS: Partial<Record<string, AssetId>> = {
  slate: 'skin-roof-slate',
  'dark-tile': 'skin-roof-slate',
  'red-tile': 'skin-roof-slate',
};

/** A garden building's roof — felt rather than slate, which is what a shed actually has. */
export const OUTBUILDING_ROOF_SKIN: AssetId = 'skin-roof-felt';

/** The house's own walls. Render rather than brick: it is the commoner finish and the quieter one. */
export const HOUSE_WALL_SKIN: AssetId = 'skin-render';

/** Every skin, for preloading and for the audit sheet. */
export const SKIN_ASSETS: AssetId[] = [
  ...new Set<AssetId>([
    ...(Object.values(BOUNDARY_SKINS).filter(Boolean) as AssetId[]),
    ...(Object.values(ROOF_SKINS).filter(Boolean) as AssetId[]),
    OUTBUILDING_ROOF_SKIN,
    HOUSE_WALL_SKIN,
  ]),
];

/** The disc every sprite stands on. */
export const CONTACT_SHADOW_SPRITE: AssetId = 'fx-soft-shadow';

/** The pool of light a fitting throws after dark. Composited by `drawLighting`, not by a material. */
export const LIGHT_POOL_SPRITE: AssetId = 'fx-light-pool';

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
