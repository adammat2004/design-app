import { beforeEach, describe, expect, it } from 'vitest';
import { ASSET_FAMILIES, ASSET_IDS, type AssetFamily, type AssetId } from './asset-spec';
import { TREE_SYMBOLS } from '@garden-studio/schema';
import {
  assetsForElements,
  canopiesForSymbol,
  CANOPY_SPRITES,
  CONTACT_SHADOW_SPRITE,
  ELEVATED_TWINS,
  LIGHT_POOL_SPRITE,
  materialAssets,
  MATERIAL_ASSETS,
  SKIN_ASSETS,
  SYMBOL_SPRITES,
} from './material-assets';
import { assetAnchor, assetsMatching, clearTaxonomyCache, isRecolourable } from './taxonomy';

beforeEach(() => {
  clearTaxonomyCache();
});

describe('the taxonomy', () => {
  /**
   * Total by construction, so classifying a new family is a compile error rather than something to
   * remember. An unclassified family is invisible to every query — it would be generated, checked
   * in, and never drawn, which is the exact failure the taxonomy exists to end.
   */
  it('classifies every family', () => {
    for (const id of ASSET_IDS) {
      const family: AssetFamily = ASSET_FAMILIES[id];
      expect(family.taxon.group, id).toBeTruthy();
      expect(family.taxon.type, id).toBeTruthy();
    }
  });

  it('narrows by group, type and tag', () => {
    /*
     * Exact for a closed group. Furniture is not open-ended — `dining-set` is two specific
     * products and a third would be a decision, not a variation — so an exact assertion here is a
     * real constraint rather than a brittle one.
     */
    expect(assetsMatching({ group: 'furniture', type: 'dining-set' })).toEqual([
      'furniture-dining-4',
      'furniture-dining-6',
    ]);
    expect(assetsMatching({ group: 'furniture', type: 'dining-set', tags: ['seats-6'] })).toEqual([
      'furniture-dining-6',
    ]);

    // Containment for an open one: the whole point of vegetation is that it keeps growing.
    expect(assetsMatching({ group: 'vegetation', type: 'shrub' })).toContain('plant-shrub');
    expect(assetsMatching({ group: 'vegetation', type: 'shrub' })).not.toContain('plant-grass');
  });

  it('takes several types at once', () => {
    const both = assetsMatching({ group: 'vegetation', type: ['perennial', 'shrub'] });

    expect(both).toContain('plant-shrub');
    expect(both).toContain('plant-perennial');
    expect(both).not.toContain('plant-grass');
  });

  it('requires every tag listed, not any of them', () => {
    expect(assetsMatching({ tags: ['bark', 'play'] })).toEqual(['tex-play-bark']);
    expect(assetsMatching({ tags: ['bark'] })).toEqual(['tex-bark-mulch', 'tex-play-bark']);
  });

  it('filters on the natural size, by the side a sprite is fitted by', () => {
    const small = assetsMatching({ group: 'vegetation', maxMetres: 1 });
    const large = assetsMatching({ group: 'vegetation', minMetres: 3 });

    expect(small).toContain('plant-shrub');
    expect(small).not.toContain('tree-canopy');
    expect(large).toContain('tree-canopy');
  });

  it('answers nothing rather than throwing for a query that matches no family', () => {
    expect(assetsMatching({ group: 'vegetation', type: 'not-a-plant' })).toEqual([]);
  });

  /**
   * Manifest order, always.
   *
   * Every consumer picks from this list with a generator seeded on a grid cell, so the order *is*
   * part of what a planted bed looks like. Sorting it — or letting it fall out of a `Set` — would
   * reshuffle every bed in every saved plan the next time somebody added an asset.
   */
  it('returns families in manifest order', () => {
    const found = assetsMatching({ group: 'vegetation' });
    const positions = found.map((id) => ASSET_IDS.indexOf(id));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('gives the same array on a repeat query, so the render path pays once', () => {
    const first = assetsMatching({ group: 'vegetation', type: 'shrub' });
    expect(assetsMatching({ group: 'vegetation', type: 'shrub' })).toBe(first);
  });
});

describe('recolourable and anchor', () => {
  /**
   * Not recolourable is the safe default, and it has to be: tinting a teak dining set towards a
   * planting palette would make it green. Plants and mass textures opt in, because that tint is the
   * only way `MATERIAL_TONES` reaches those pixels at all.
   */
  it('defaults to not recolourable', () => {
    expect(isRecolourable('furniture-dining-4')).toBe(false);
    expect(isRecolourable('plant-shrub')).toBe(true);
    expect(isRecolourable('tex-slate-chippings')).toBe(true);
  });

  it('centres a sprite that states no anchor, which is every one generated so far', () => {
    expect(assetAnchor('plant-shrub')).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('replacing the hand-written lists', () => {
  /**
   * What survived the refactor.
   *
   * `MATERIAL_ASSETS` used to name each material's sprites outright; they are resolved by query
   * now, and the library has since grown families the old table never listed. So the invariant is
   * **containment, in the original relative order** rather than equality: everything a material
   * used to draw with, it still draws with, and still in the same order among themselves.
   *
   * That order matters because the scatter picks by index. It is also why new families are
   * *appended* to `ASSET_FAMILIES` — see the note there.
   */
  const BEFORE: Record<string, string[]> = {
    wildflower: ['plant-flower'],
    'mixed-border': ['plant-perennial', 'plant-shrub'],
    shrubs: ['plant-shrub'],
    'ornamental-grasses': ['plant-grass'],
    'ground-cover': ['plant-ground-cover'],
  };

  it.each(Object.entries(BEFORE))('still resolves %s to everything it named', (material, was) => {
    const now = materialAssets(material)?.sprites ?? [];

    for (const id of was) expect(now, material).toContain(id);
    // The originals keep their relative order, whatever has been appended around them.
    expect(now.filter((id) => was.includes(id))).toEqual(was);
  });

  /**
   * Deciduous only, and deliberately.
   *
   * The library now holds ornamental, multi-stem and fruit canopies as well as the original, and a
   * garden drawing a mix of those is *right* — a real garden has several different trees. But
   * `tree-conifer` stays out: a conifer is a categorically different plant, choosing one is a
   * design decision, and nothing yet makes it. Phase F gives trees species symbols; that is where
   * an evergreen becomes something a plan can ask for rather than something it lands on.
   */
  it('draws on every deciduous canopy and no evergreen one', () => {
    expect(CANOPY_SPRITES).toContain('tree-canopy');
    expect(CANOPY_SPRITES.length).toBeGreaterThan(1);
    expect(CANOPY_SPRITES).not.toContain('tree-conifer');
  });
});

describe('assetsForElements', () => {
  /**
   * The input to the preload's first wave. At forty-three assets loading everything at once was
   * free; at the several hundred this library is heading for it is a large first paint spent mostly
   * on textures the open plan does not use.
   */
  it('names what a plan draws with and nothing else', () => {
    const found = assetsForElements([
      { material: 'stone-pavers' },
      { material: 'standard-turf' },
      { symbol: 'dining-set-6' },
    ]);

    expect(found).toContain('face-stone-paver');
    expect(found).toContain('tex-standard-turf');
    expect(found).toContain('furniture-dining-6');

    // Nothing this plan has no use for.
    expect(found).not.toContain('tex-pool-water');
    expect(found).not.toContain('play-trampoline');
  });

  /**
   * Generous at the edges on purpose: every sprite stands on the contact shadow, and a tree is the
   * most conspicuous thing on a plan. The cheapest mistake here is one file too many.
   */
  it('always includes the contact shadow and the canopies', () => {
    const bare = assetsForElements([]);

    expect(bare).toContain('fx-soft-shadow');
    for (const canopy of CANOPY_SPRITES) expect(bare).toContain(canopy);
  });

  it('resolves a planting bed through its query', () => {
    const found = assetsForElements([{ material: 'mixed-border' }]);

    expect(found).toContain('tex-soil');
    expect(found).toContain('plant-perennial');
    expect(found).toContain('plant-shrub');
    expect(found).toContain('plant-flower');
  });

  it('ignores a material or symbol it does not know', () => {
    expect(() =>
      assetsForElements([{ material: 'not-a-material', symbol: 'not-a-symbol' }]),
    ).not.toThrow();
  });

  it('lists in manifest order and never repeats', () => {
    const found = assetsForElements([
      { material: 'mixed-border' },
      { material: 'mixed-border' },
      { material: 'shrubs' },
    ]);

    expect(new Set(found).size).toBe(found.length);
    const positions = found.map((id) => ASSET_IDS.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('every generated asset is reachable', () => {
  /**
   * The promise Phase D was built on, made checkable.
   *
   * The failure it guards against is specific and has already happened twice: `tree-conifer` sat in
   * the manifest for a whole phase without ever being drawn, and `hedge-crown-beech`/`-yew` were
   * generated — paid for, post-processed, checked in — before anything consumed them. Nothing
   * warned, because an unreferenced asset is silent by construction: no error, no blank surface,
   * just a file nobody reads.
   *
   * So every family must be reachable by *some* consumer, and the exceptions must be written down
   * here with a reason. Adding an unused asset then costs one deliberate line rather than nothing,
   * which is the whole difference.
   */
  const AWAITING_A_CONSUMER: Partial<Record<AssetId, string>> = {
    'tex-house-floor':
      'Retired in Phase B: the house is drawn as a plain interior now, because a pale oak floor ' +
      'read as a very large deck. The files stay so the manifest and catalogue agree.',
  };

  it('has a consumer for every family, or a written reason', () => {
    const reachable = new Set<AssetId>([
      CONTACT_SHADOW_SPRITE,
      LIGHT_POOL_SPRITE,
      ...CANOPY_SPRITES,
      /*
       * The elevated library reaches the drawing by two routes, and both are tables rather than
       * queries: a sprite family is swapped for its twin when Visualise draws it, and a skin is
       * named by the face it goes on. So reachability here is the same question it is for the plan
       * camera — is anything going to ask for this file — asked of the two tables that ask.
       */
      ...(Object.values(ELEVATED_TWINS) as AssetId[]),
      ...SKIN_ASSETS,
    ]);
    // Trees resolve per species now, so the general canopy pool is no longer the whole story.
    for (const symbol of TREE_SYMBOLS) for (const id of canopiesForSymbol(symbol)) reachable.add(id);

    for (const material of Object.keys(MATERIAL_ASSETS)) {
      const assets = materialAssets(material);
      if (!assets) continue;
      if (assets.face) reachable.add(assets.face);
      if (assets.texture) reachable.add(assets.texture);
      for (const sprite of assets.sprites ?? []) reachable.add(sprite);
      if (assets.flowers) reachable.add(assets.flowers.sprite);
    }
    for (const symbol of Object.values(SYMBOL_SPRITES)) reachable.add(symbol);

    const orphans = ASSET_IDS.filter(
      (id) => !reachable.has(id) && !(id in AWAITING_A_CONSUMER),
    );

    expect(orphans, 'generated but drawn by nothing — wire it up or record why not').toEqual([]);
  });

  /** And the reverse: a reason left behind for an asset that *is* now drawn is stale. */
  it('has no stale exemptions', () => {
    const reachable = new Set<AssetId>([
      CONTACT_SHADOW_SPRITE,
      LIGHT_POOL_SPRITE,
      ...CANOPY_SPRITES,
      /*
       * The elevated library reaches the drawing by two routes, and both are tables rather than
       * queries: a sprite family is swapped for its twin when Visualise draws it, and a skin is
       * named by the face it goes on. So reachability here is the same question it is for the plan
       * camera — is anything going to ask for this file — asked of the two tables that ask.
       */
      ...(Object.values(ELEVATED_TWINS) as AssetId[]),
      ...SKIN_ASSETS,
    ]);
    for (const symbol of TREE_SYMBOLS) for (const id of canopiesForSymbol(symbol)) reachable.add(id);
    for (const material of Object.keys(MATERIAL_ASSETS)) {
      for (const sprite of materialAssets(material)?.sprites ?? []) reachable.add(sprite);
    }

    for (const id of Object.keys(AWAITING_A_CONSUMER) as AssetId[]) {
      expect(reachable.has(id), `${id} is drawn now — drop its exemption`).toBe(false);
    }
  });
});

describe('trees by species', () => {
  /**
   * What giving trees species symbols is *for*: a plan now chooses rather than lands on one.
   *
   * `tree-conifer` was generated in Phase D and deliberately kept out of the general canopy pool
   * for a whole phase, because with nothing choosing, a garden would have got a random mix of
   * broadleaf and conifer — and a random mix is not a design. An evergreen is now something a plan
   * asks for.
   */
  it('gives each species its own canopies', () => {
    expect(canopiesForSymbol('tree-evergreen')).toContain('tree-conifer');
    expect(canopiesForSymbol('tree-ornamental')).toContain('tree-ornamental');
    expect(canopiesForSymbol('tree-fruit')).toContain('tree-fruit');
  });

  it('keeps an evergreen out of the deciduous species', () => {
    for (const symbol of ['tree-deciduous', 'tree-ornamental', 'tree-fruit', 'tree-multistem']) {
      expect(canopiesForSymbol(symbol), symbol).not.toContain('tree-conifer');
    }
  });

  /** Total: an old plan whose trees carry no symbol still draws a canopy. */
  it('falls back to the general pool for a tree with no species', () => {
    expect(canopiesForSymbol(undefined)).toEqual(CANOPY_SPRITES);
    expect(canopiesForSymbol('not-a-tree')).toEqual(CANOPY_SPRITES);
  });

  it('finds a canopy for every species, so none draws as a bare ring', () => {
    for (const symbol of TREE_SYMBOLS) {
      expect(canopiesForSymbol(symbol), symbol).not.toHaveLength(0);
    }
  });
});
