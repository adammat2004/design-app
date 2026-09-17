import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASSET_FAMILIES,
  ASSET_IDS,
  ELEVATED,
  elevatedAnchor,
  elevatedFrame,
  type AssetFamily,
  type AssetId,
} from './asset-spec';
import { RISE } from '../../render/camera';
import { extrude } from '../../render/projection';
import {
  elevatedPlacement,
  foldRotation,
  VEGETATION_MAX_ROTATION,
} from '../symbols/elevated';
import { ELEVATED_TWINS, SKIN_ASSETS, elevatedTwin } from './material-assets';
import { assetAnchor, assetsMatching, clearTaxonomyCache } from './taxonomy';

beforeEach(() => {
  clearTaxonomyCache();
});

const elevated = ASSET_IDS.filter((id) => (ASSET_FAMILIES[id] as AssetFamily).camera === 'elevated');
const elevatedSprites = elevated.filter((id) => (ASSET_FAMILIES[id] as AssetFamily).kind === 'sprite');

describe('the elevated library', () => {
  it('exists', () => {
    expect(elevatedSprites.length).toBeGreaterThan(0);
  });

  /**
   * The frame is derived from the footprint and the height, so a family that declares an output
   * size disagreeing with it would be padded to one aspect and drawn at another — every object
   * squashed or stretched by a few percent, which reads as "the assets are slightly wrong" and is
   * almost impossible to attribute by eye.
   */
  it('sizes every image to the frame its own footprint and height imply', () => {
    for (const id of elevatedSprites) {
      const family: AssetFamily = ASSET_FAMILIES[id];
      const frame = elevatedFrame(family);

      const declared = family.sizePx.w / family.sizePx.h;
      const implied = frame.w / frame.h;

      expect(Math.abs(declared - implied) / implied, `${id} frame aspect`).toBeLessThan(0.01);
    }
  });

  it('gives every elevated object a height, because that is what the frame is made of', () => {
    for (const id of elevatedSprites) {
      const family: AssetFamily = ASSET_FAMILIES[id];
      expect(family.heightMetres, id).toBeGreaterThan(0);
    }
  });

  /**
   * Elevated art carries its own light, and the tint is a proportional multiply — so tinting it
   * would darken it exactly where it is already shaded. The plan families were written flat and
   * neutral *so that* they could be tinted; these are the opposite bargain.
   */
  it('never claims to be recolourable', () => {
    for (const id of elevated) {
      expect((ASSET_FAMILIES[id] as AssetFamily).recolourable, id).not.toBe(true);
    }
  });

  /**
   * Every sentence in `ELEVATED` is load-bearing, and the two that matter most are the camera angle
   * — which is `RISE` stated in words — and the refusal of a ground shadow, which is what makes the
   * hybrid shadow model possible at all. A family that lost either would come back from the model
   * looking almost right and sit wrong against everything drawn beside it.
   */
  it('asks every asset for the same camera and the same shadow refusal', () => {
    /*
     * The whole preamble, as a prefix, rather than a handful of phrases from it.
     *
     * The phrase version failed the first time the preamble was reworded — which it was, after the
     * first trial came back at thirty degrees — and failing on a *deliberate* improvement to the
     * wording is the definition of a brittle test. The invariant worth holding is that every
     * elevated family carries the same contract, not that the contract contains any given sentence.
     */
    for (const id of elevatedSprites) {
      const { prompt } = ASSET_FAMILIES[id] as AssetFamily;
      expect(prompt.startsWith(ELEVATED), id).toBe(true);
    }

    // And the contract still says the five things it exists to say.
    expect(ELEVATED).toContain('twelve degrees off vertical');
    expect(ELEVATED).toContain('NOT foreshortened');
    expect(ELEVATED).toContain('No cast shadow on the ground');
    expect(ELEVATED).toContain('from the upper left');
    expect(ELEVATED).toContain('transparent background');

    /*
     * **Which way the object faces, and the reason this is asserted next to the geometry.**
     *
     * `extrude` shows the faces whose outward normal points down the screen, because that is the
     * way the camera is tilted — you see the front of a shed and not its back. A photographed
     * object has to agree, or a sprite would show its back beside a drawn thing showing its front,
     * and nothing downstream could detect it. The prompt's "front facing the bottom of the frame"
     * and `projection.ts`'s `normal.y > 0` are the same rule stated in two languages, so they are
     * checked together.
     */
    expect(ELEVATED).toContain('its front facing the bottom of the frame');
  });

  /**
   * The same rule, from the geometry's side, so a change to either one breaks this pair.
   *
   * Note what is *not* claimed here: that the baked light agrees with the scene's. It cannot — the
   * art is lit from the upper left and a located plan's sun moves through the day. See the style
   * doc on the hybrid shadow model for what that costs and why it is still the right trade.
   */
  it('faces the viewer from the same side the geometry does', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const { faces } = extrude(square, 2, { x: -Math.SQRT1_2, y: -Math.SQRT1_2 });

    expect(faces).toHaveLength(1);
    // The near edge — the one at the bottom of the drawing, which is the one an asset shows.
    expect(Math.min(faces[0]!.base[0].y, faces[0]!.base[1].y)).toBe(4);
  });

  /**
   * A skin goes on a face the renderer shades from that face's own normal. Baked light would be
   * light applied twice, and the two would disagree as soon as the sun moved.
   */
  it('asks for skins flat, not lit', () => {
    for (const id of SKIN_ASSETS) {
      const family: AssetFamily = ASSET_FAMILIES[id];
      expect(family.kind, id).toBe('texture');
      expect(family.prompt, id).toContain('no shadows');
      expect(family.prompt, id).not.toContain('twelve degrees from vertical');
    }
  });
});

describe('the two cameras stay apart', () => {
  /**
   * The guarantee that lets the elevated library be appended at all.
   *
   * A query is answered in manifest order and its consumers index into the result with a seeded
   * generator, so a query that returned more families would put a different plant in every cell of
   * every bed in every saved plan — and would put art from the wrong camera there.
   */
  it('keeps elevated families out of every query that does not ask for them', () => {
    const queries = [
      { group: 'vegetation' as const },
      { group: 'vegetation' as const, type: 'shrub' },
      { group: 'vegetation' as const, type: 'tree-deciduous' },
      { group: 'vegetation' as const, type: 'grass-ornamental' },
      { group: 'furniture' as const },
      { group: 'surface' as const },
    ];

    for (const query of queries) {
      for (const id of assetsMatching(query)) {
        expect((ASSET_FAMILIES[id] as AssetFamily).camera ?? 'plan', JSON.stringify(query)).toBe(
          'plan',
        );
      }
    }
  });

  it('finds them when they are asked for', () => {
    const found = assetsMatching({ group: 'vegetation', type: 'shrub', camera: 'elevated' });

    expect(found).toContain('vis-shrub-evergreen');
    expect(found).not.toContain('plant-shrub');
  });

  it('returns the same plan families in the same order as the manifest', () => {
    const found = assetsMatching({ group: 'vegetation', type: 'shrub' });
    const positions = found.map((id) => ASSET_IDS.indexOf(id));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(found).toContain('plant-shrub');
  });
});

describe('where an elevated asset stands', () => {
  /**
   * A plan sprite *is* its footprint, so its anchor is the middle of the image. An elevated one is
   * its footprint plus its height leaning up the screen, so its anchor is down in the footprint
   * band — and assuming otherwise floats every object half its own height off the ground.
   */
  it('stands in the footprint band, not in the middle of the picture', () => {
    for (const id of elevatedSprites) {
      const anchor = assetAnchor(id);

      expect(anchor.x, id).toBeCloseTo(0.5, 6);
      expect(anchor.y, id).toBeGreaterThan(0.5);
      expect(anchor.y, id).toBeLessThanOrEqual(1);
    }
  });

  it('leaves the plan camera centred', () => {
    expect(assetAnchor('plant-shrub')).toEqual({ x: 0.5, y: 0.5 });
    expect(assetAnchor('tree-canopy')).toEqual({ x: 0.5, y: 0.5 });
  });

  it('puts the anchor exactly half the footprint depth up from the bottom', () => {
    const family: AssetFamily = ASSET_FAMILIES['vis-shrub-evergreen'];
    const frame = elevatedFrame(family);

    expect(frame.h).toBeCloseTo(family.metres.h + family.heightMetres! * RISE, 10);
    expect(elevatedAnchor(family).y).toBeCloseTo(1 - family.metres.h / 2 / frame.h, 10);
  });
});

describe('placing an elevated sprite', () => {
  const ground = { x: 10, y: 20 };

  it('has no opinion about a plan-camera family', () => {
    expect(elevatedPlacement('plant-shrub', ground, { width: 1, depth: 1 })).toBeNull();
    expect(elevatedPlacement(null, ground, { width: 1, depth: 1 })).toBeNull();
  });

  /**
   * The one thing that has to be exactly right, and the thing a centred anchor gets exactly wrong.
   * An elevated image is taller than the ground it covers, so its middle is somewhere up the
   * object's height — put the middle on the ground point and every object in the garden floats.
   */
  it('puts the foot of the thing on the point it stands at', () => {
    const family: AssetFamily = ASSET_FAMILIES['vis-shrub-evergreen'];
    const placement = elevatedPlacement('vis-shrub-evergreen', ground, { width: 1, depth: 1 })!;
    const anchor = elevatedAnchor(family);

    expect(placement.pivot).toEqual(ground);
    expect(placement.x + anchor.x * placement.width).toBeCloseTo(ground.x, 9);
    expect(placement.y + anchor.y * placement.height).toBeCloseTo(ground.y, 9);
  });

  it('is taller than the ground it covers, by the height leaning up the screen', () => {
    const family: AssetFamily = ASSET_FAMILIES['vis-tree-deciduous'];
    const placement = elevatedPlacement('vis-tree-deciduous', ground, {
      width: family.metres.w,
      depth: family.metres.h,
    })!;

    expect(placement.width).toBeCloseTo(family.metres.w, 9);
    expect(placement.height).toBeCloseTo(family.metres.h + family.heightMetres! * RISE, 9);
    // The canopy reaches further above the trunk than below it.
    expect(ground.y - placement.y).toBeGreaterThan(placement.y + placement.height - ground.y);
  });

  /**
   * The geometry of record decides the size, never the asset. A shrub placed in a 2 m bay is drawn
   * 2 m across whatever the photograph's natural spread happens to be.
   */
  it('scales to the footprint the geometry gives it', () => {
    const one = elevatedPlacement('vis-shrub-evergreen', ground, { width: 1, depth: 1 })!;
    const two = elevatedPlacement('vis-shrub-evergreen', ground, { width: 2, depth: 2 })!;

    expect(two.width).toBeCloseTo(one.width * 2, 9);
    expect(two.height).toBeCloseTo(one.height * 2, 9);
  });

  /**
   * Contain, never cover — and never the quarter-turn `spriteBox` makes. A plan sprite has no front
   * so turning it to fill a rect the other way round is free; an elevated one would be laid on its
   * side.
   */
  it('sits smaller inside a rect whose proportions disagree, rather than being cropped', () => {
    const family: AssetFamily = ASSET_FAMILIES['vis-dining-6'];
    const narrow = elevatedPlacement('vis-dining-6', ground, { width: 3.2, depth: 1.2 })!;

    expect(narrow.width).toBeLessThan(family.metres.w);
    expect(narrow.width / narrow.height).toBeCloseTo(
      elevatedFrame(family).w / elevatedFrame(family).h,
      9,
    );
  });
});

describe('how far a plant may be turned', () => {
  it('stays inside the band whatever it is given', () => {
    for (let i = 0; i < 64; i += 1) {
      const folded = foldRotation((i / 64) * Math.PI * 2);
      expect(Math.abs(folded)).toBeLessThanOrEqual(VEGETATION_MAX_ROTATION + 1e-9);
    }
  });

  /**
   * A *fold*, not a clamp. Clamping would pile every plant onto one of the two limits and the bed
   * would read as two orientations; mapping keeps the spread the sampler drew, only narrower.
   */
  it('keeps the spread rather than piling onto the limits', () => {
    const folded = Array.from({ length: 16 }, (_, i) => foldRotation((i / 16) * Math.PI * 2));

    expect(new Set(folded.map((value) => value.toFixed(6))).size).toBe(16);
    expect(folded).toEqual([...folded].sort((a, b) => a - b));
  });

  it('is about fifteen degrees, which is small enough not to turn the sun with it', () => {
    expect((VEGETATION_MAX_ROTATION * 180) / Math.PI).toBeCloseTo(15, 9);
  });
});

describe('the twin table', () => {
  it('maps plan families onto elevated ones and never the reverse', () => {
    for (const [plan, twin] of Object.entries(ELEVATED_TWINS) as [AssetId, AssetId][]) {
      expect((ASSET_FAMILIES[plan] as AssetFamily).camera ?? 'plan', plan).toBe('plan');
      expect((ASSET_FAMILIES[twin] as AssetFamily).camera, twin).toBe('elevated');
    }
  });

  /**
   * The fallback, and the reason it is keyed on the catalogue rather than on the table.
   *
   * A twin that has been specified but not generated must keep drawing its plan sprite, or
   * Visualise would resolve to a family with no files and draw nothing. That is what lets the
   * library arrive in batches — and what keeps the whole thing working with no key at all.
   */
  it('falls back to the plan sprite until the twin has actually been generated', () => {
    for (const [plan, twin] of Object.entries(ELEVATED_TWINS) as [AssetId, AssetId][]) {
      const resolved = elevatedTwin(plan);
      expect(resolved === null || resolved === twin, plan).toBe(true);
    }
  });

  /*
   * `light-bollard` rather than a plant, and the choice is the point: every plant now has a twin,
   * so this used to name `plant-flower` and started failing the day the herbaceous layer was drawn.
   * The lighting families are the ones held back *deliberately* — a bollard is 120 mm and four
   * pixels at plan zoom, and what a reader sees is the pool it throws, not the fitting — so they
   * are the stable example of a family the twin table is expected to have no opinion about.
   */
  it('has no opinion about a family with no twin', () => {
    expect(elevatedTwin('light-bollard')).toBeNull();
    expect(elevatedTwin(null)).toBeNull();
    expect(elevatedTwin(undefined)).toBeNull();
  });

  /** Structures are extruded from their own outlines; a photograph of one is the mistake. */
  it('has no twin for anything that is drawn rather than photographed', () => {
    for (const id of Object.values(ELEVATED_TWINS)) {
      expect((ASSET_FAMILIES[id!] as AssetFamily).taxon.group, id).not.toBe('structure');
    }
  });
});
