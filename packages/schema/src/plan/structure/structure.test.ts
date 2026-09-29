import { describe, expect, it } from 'vitest';
import { DesignElementSchema, type DesignElement } from '../concepts.js';
import { PLAN_DOCUMENT_VERSION, readPlanDocument } from '../document.js';
import { heightFor } from '../heights.js';
import { mergeStructureConfig, STRUCTURE_SIDES } from './config.js';
import { resolveStructure, STRUCTURE_DEFINITIONS, structureDefinitionFor } from './definitions.js';
import { isStructureFinish, STRUCTURE_FINISHES } from './finishes.js';
import { partHeights, partPlanOutline, structureParts, type StructurePart } from './parts.js';
import { structureSymbolNamed } from '../symbols.js';

const pergola = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  name: 'Dining pergola',
  symbol: 'pergola',
  material: 'softwood',
  zone: 'back',
  height: 2.4,
  shape: { kind: 'rect', centre: { x: 10, y: 8 }, width: 3.6, depth: 3.6, rotation: 0 },
  ...over,
});

const gazebo = (over: Partial<DesignElement> = {}): DesignElement =>
  pergola({ id: 'g1', name: 'Gazebo', symbol: 'gazebo', height: 2.8, ...over });

const partsOf = (element: DesignElement): StructurePart[] =>
  structureParts(resolveStructure(element)!);

describe('which elements open in 3D', () => {
  it('opens a pergola and a gazebo', () => {
    expect(structureDefinitionFor(pergola())?.symbol).toBe('pergola');
    expect(structureDefinitionFor(gazebo())?.symbol).toBe('gazebo');
  });

  it('opens nothing else', () => {
    expect(structureDefinitionFor(pergola({ symbol: 'shed' }))).toBeNull();
    expect(structureDefinitionFor(pergola({ symbol: undefined }))).toBeNull();
    expect(
      structureDefinitionFor(pergola({ category: 'paved-area', symbol: undefined })),
    ).toBeNull();
    // A pergola symbol on the wrong category is not a pergola.
    expect(structureDefinitionFor(pergola({ category: 'furniture' }))).toBeNull();
  });
});

describe('resolveStructure', () => {
  /** The migration story: a structure stored before `structure` existed opens with the defaults. */
  it('gives an old pergola with no configuration valid defaults', () => {
    const resolved = resolveStructure(pergola())!;

    expect(resolved.preset).toBe('classic');
    expect(resolved.roof.kind).toBe('slatted');
    expect(resolved.lighting).toBe(false);
    for (const side of STRUCTURE_SIDES) expect(resolved.sides[side]).toBe('open');
    // The frame is the element's own material; the roof matches it until told otherwise.
    expect(resolved.frame).toBe('softwood');
    expect(resolved.roof.finish).toBe('softwood');
    expect(isStructureFinish(resolved.frame)).toBe(true);
  });

  it('gives an old gazebo a hipped roof', () => {
    expect(resolveStructure(gazebo())!.roof.kind).toBe('hipped');
  });

  it('reads its size from the rect and its height from the element, never from the configuration', () => {
    const resolved = resolveStructure(pergola({ height: 2.7 }))!;

    expect(resolved.width).toBe(3.6);
    expect(resolved.depth).toBe(3.6);
    expect(resolved.height).toBe(2.7);
    expect(resolveStructure(pergola({ height: undefined }))!.height).toBe(
      heightFor(pergola({ height: undefined })),
    );
  });

  /** A catalogue can change; a stored plan must still open, drawing the default instead. */
  it('falls back from a value the definition no longer offers rather than throwing', () => {
    const resolved = resolveStructure(
      pergola({
        material: 'reclaimed-oak',
        structure: {
          preset: 'baroque',
          roof: { kind: 'thatched', finish: 'gold-leaf' },
          sides: { left: 'glazed', right: 'slatted' },
          lighting: true,
        },
      }),
    )!;

    expect(resolved.preset).toBe('classic');
    expect(resolved.roof.kind).toBe('slatted');
    expect(resolved.frame).toBe(STRUCTURE_DEFINITIONS.pergola!.defaults.frame);
    expect(resolved.roof.finish).toBe(resolved.frame);
    expect(resolved.sides).toEqual({ left: 'open', right: 'slatted', rear: 'open' });
    expect(resolved.lighting).toBe(true);
  });

  it('refuses a roof kind this structure does not offer', () => {
    // A hipped pergola is a gazebo, and a slatted gazebo is a pergola.
    expect(resolveStructure(pergola({ structure: { roof: { kind: 'hipped' } } }))!.roof.kind).toBe(
      'slatted',
    );
    expect(resolveStructure(gazebo({ structure: { roof: { kind: 'slatted' } } }))!.roof.kind).toBe(
      'hipped',
    );
  });

  it('is null for anything that is not a configurable structure', () => {
    expect(resolveStructure(pergola({ symbol: 'shed' }))).toBeNull();
  });
});

describe('persistence', () => {
  const configured = pergola({
    material: 'aluminium-dark',
    structure: {
      preset: 'modern',
      roof: { kind: 'solid', finish: 'polycarbonate-opal' },
      sides: { left: 'slatted', right: 'open', rear: 'slatted' },
      lighting: true,
    },
  });

  it('survives the schema through JSON unchanged', () => {
    const parsed = DesignElementSchema.parse(JSON.parse(JSON.stringify(configured)));
    expect(parsed.structure).toEqual(configured.structure);
  });

  /** A strip-mode schema drops unknown keys silently; this is the field being known. */
  it('survives a whole stored document and reads back identically', () => {
    const stored = {
      version: PLAN_DOCUMENT_VERSION,
      layout: { elements: [configured], seededFrom: null, pristine: null },
    };
    const document = readPlanDocument(JSON.parse(JSON.stringify(stored)));
    expect(document.layout.elements[0]!.structure).toEqual(configured.structure);
    expect(readPlanDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });

  it('parses a stored element that has no structure at all', () => {
    expect(DesignElementSchema.parse(pergola()).structure).toBeUndefined();
  });
});

describe('structureParts', () => {
  /**
   * The drawing the plan has always had, preserved: four 150 mm posts and `max(2, ceil(w / 0.35))`
   * gaps of rafters running the full depth.
   */
  it('builds an unconfigured pergola as the posts and rafters it has always had', () => {
    const parts = partsOf(pergola());
    const posts = parts.filter((part) => part.group === 'post');
    const rafters = parts.filter((part) => part.group === 'rafter');

    expect(posts).toHaveLength(4);
    for (const post of posts) {
      if (post.shape.kind !== 'box') throw new Error('a post is a box');
      expect(post.shape.size[0]).toBeCloseTo(0.15, 9);
      expect(post.shape.size[2]).toBeCloseTo(0.15, 9);
    }
    expect(rafters).toHaveLength(Math.max(2, Math.ceil(3.6 / 0.35)) + 1);
    for (const rafter of rafters) {
      if (rafter.shape.kind !== 'box') throw new Error('a rafter is a box');
      expect(rafter.shape.size[2]).toBeCloseTo(3.6, 9);
    }
  });

  /**
   * The rule that stops the 3D model occupying different ground from the 2D element: every part, in
   * every configuration, lies within the rect's own width and depth and under its height.
   */
  it('keeps every part within the footprint and under the height, in every configuration', () => {
    const sizes = [
      [1.8, 1.8, 2.1],
      [3.6, 2.4, 2.4],
      [6, 4.2, 3.2],
      [2.2, 5, 2.8],
    ] as const;
    for (const symbol of ['pergola', 'gazebo'] as const) {
      const definition = STRUCTURE_DEFINITIONS[symbol]!;
      for (const [width, depth, height] of sizes) {
        for (const preset of definition.presets) {
          for (const { id: kind } of definition.roof!.kinds) {
            const element = pergola({
              symbol,
              height,
              shape: { kind: 'rect', centre: { x: 0, y: 0 }, width, depth, rotation: 0 },
              structure: {
                preset: preset.id,
                roof: { kind },
                sides: { left: 'slatted', right: 'slatted', rear: 'slatted' },
                lighting: true,
              },
            });
            for (const part of partsOf(element)) {
              const label = `${symbol} ${preset.id} ${kind} ${width}x${depth}x${height} ${part.id}`;
              const [halfW, halfD] =
                part.shape.kind === 'box'
                  ? [part.shape.size[0] / 2, part.shape.size[2] / 2]
                  : [part.shape.base[0] / 2, part.shape.base[1] / 2];
              const [x, , z] = part.shape.centre;
              expect(Math.abs(x) + halfW, label).toBeLessThanOrEqual(width / 2 + 1e-9);
              expect(Math.abs(z) + halfD, label).toBeLessThanOrEqual(depth / 2 + 1e-9);
              const { bottom, top } = partHeights(part);
              expect(bottom, label).toBeGreaterThanOrEqual(-1e-9);
              expect(top, label).toBeLessThanOrEqual(height + 1e-9);
            }
          }
        }
      }
    }
  });

  it('reaches exactly the height it was given', () => {
    for (const element of [
      pergola(),
      gazebo(),
      pergola({ structure: { preset: 'modern', roof: { kind: 'solid' } } }),
    ]) {
      const top = Math.max(...partsOf(element).map((part) => partHeights(part).top));
      expect(top).toBeCloseTo(heightFor(element), 9);
    }
  });

  /** Height is vertical information: it must never move a part across the ground. */
  it('changes nothing across the ground when only the height changes', () => {
    const footprints = (element: DesignElement) =>
      partsOf(element)
        .filter((part) => part.group === 'post' || part.group === 'rafter')
        .map((part) => partPlanOutline(part, { centre: { x: 10, y: 8 }, rotation: 0 }));

    expect(footprints(pergola({ height: 3 }))).toEqual(footprints(pergola({ height: 2.4 })));
  });

  it('adds boards on each screened side and nowhere else', () => {
    const open = partsOf(pergola());
    const screened = partsOf(
      pergola({ structure: { sides: { left: 'slatted', rear: 'slatted' } } }),
    );

    expect(open.some((part) => part.group.startsWith('side-'))).toBe(false);
    expect(screened.filter((part) => part.group === 'side-left').length).toBeGreaterThan(5);
    expect(screened.filter((part) => part.group === 'side-rear').length).toBeGreaterThan(5);
    expect(screened.some((part) => part.group === 'side-right')).toBe(false);
  });

  it('adds a warm strip when lit, and only then', () => {
    expect(partsOf(pergola()).some((part) => part.group === 'light')).toBe(false);
    const lit = partsOf(pergola({ structure: { lighting: true } })).filter(
      (part) => part.group === 'light',
    );
    expect(lit).toHaveLength(4);
    for (const part of lit) expect(part.finish).toBe('warm-led');
  });

  it('builds a hipped gazebo roof on the frame and a solid roof as a panel', () => {
    const hip = partsOf(gazebo()).find((part) => part.group === 'roof')!;
    expect(hip.shape.kind).toBe('pyramid');

    const panel = partsOf(
      pergola({ structure: { roof: { kind: 'solid', finish: 'polycarbonate-opal' } } }),
    );
    const roof = panel.filter((part) => part.group === 'roof');
    expect(roof).toHaveLength(1);
    expect(roof[0]!.finish).toBe('polycarbonate-opal');
    expect(panel.some((part) => part.group === 'rafter')).toBe(false);
  });

  it('finishes the frame in the element material and the roof in its own finish', () => {
    const parts = partsOf(
      pergola({ material: 'aluminium-light', structure: { roof: { finish: 'hardwood' } } }),
    );
    for (const part of parts.filter(
      (candidate) => candidate.group === 'post' || candidate.group === 'beam',
    )) {
      expect(part.finish).toBe('aluminium-light');
    }
    for (const part of parts.filter((candidate) => candidate.group === 'rafter')) {
      expect(part.finish).toBe('hardwood');
    }
  });

  it('is deterministic, with unique part ids', () => {
    const element = pergola({ structure: { sides: { left: 'slatted' }, lighting: true } });
    expect(partsOf(element)).toEqual(partsOf(element));
    const ids = partsOf(element).map((part) => part.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /** Placed through the same rotation every rect in the plan uses. */
  it('turns its plan outlines with the rect', () => {
    const post = partsOf(pergola()).find((part) => part.group === 'post')!;
    const straight = partPlanOutline(post, { centre: { x: 0, y: 0 }, rotation: 0 });
    const turned = partPlanOutline(post, { centre: { x: 0, y: 0 }, rotation: 90 });
    const centroid = (ring: { x: number; y: number }[]) => ({
      x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
      y: ring.reduce((sum, point) => sum + point.y, 0) / ring.length,
    });
    const a = centroid(straight);
    const b = centroid(turned);
    // A quarter turn clockwise in a y-down frame takes (x, y) to (−y, x).
    expect(b.x).toBeCloseTo(-a.y, 9);
    expect(b.y).toBeCloseTo(a.x, 9);
  });
});

describe('finishes', () => {
  it('describes every frame a definition offers', () => {
    for (const definition of Object.values(STRUCTURE_DEFINITIONS)) {
      for (const id of definition!.frameMaterials) expect(isStructureFinish(id), id).toBe(true);
      for (const id of definition!.roof?.finishes ?? [])
        expect(isStructureFinish(id), id).toBe(true);
    }
  });

  it('holds only plain data an AR scene material can be made from', () => {
    for (const [id, finish] of Object.entries(STRUCTURE_FINISHES)) {
      expect(finish.baseColor, id).toMatch(/^#[0-9a-f]{6}$/);
      expect(finish.roughness, id).toBeGreaterThanOrEqual(0);
      expect(finish.roughness, id).toBeLessThanOrEqual(1);
      expect(finish.metalness, id).toBeGreaterThanOrEqual(0);
      expect(finish.metalness, id).toBeLessThanOrEqual(1);
    }
  });
});

describe('mergeStructureConfig', () => {
  it('merges the roof and the sides key by key', () => {
    const merged = mergeStructureConfig(
      { roof: { kind: 'solid', finish: 'hardwood' }, sides: { left: 'slatted' } },
      { roof: { kind: 'open' }, sides: { rear: 'slatted' } },
    );
    expect(merged).toEqual({
      roof: { kind: 'open', finish: 'hardwood' },
      sides: { left: 'slatted', rear: 'slatted' },
    });
  });

  it('removes a key set to undefined, which is how "same as the frame" is said', () => {
    const merged = mergeStructureConfig(
      { roof: { finish: 'hardwood' }, lighting: true },
      {
        roof: { finish: undefined },
        lighting: undefined,
      },
    );
    expect(merged).toEqual({});
  });

  it('starts from nothing on an element that has never been configured', () => {
    expect(mergeStructureConfig(undefined, { preset: 'modern' })).toEqual({ preset: 'modern' });
  });
});

describe('structureSymbolNamed', () => {
  it('reads the structure a name says it is, whole words only', () => {
    expect(structureSymbolNamed('Pergola')).toBe('pergola');
    expect(structureSymbolNamed('Dining gazebo')).toBe('gazebo');
    expect(structureSymbolNamed('Garden shed')).toBe('shed');
    // The longer label wins, so a garden room is not mistaken for anything shorter.
    expect(structureSymbolNamed('Garden room office')).toBe('garden-room');
    expect(structureSymbolNamed('Raised bed')).toBe('raised-bed');
  });

  it('says nothing about a name that is no particular structure', () => {
    expect(structureSymbolNamed('Garden store')).toBeNull();
    expect(structureSymbolNamed('Sheds of light')).toBeNull();
    // A flight and a hot tub are never stamped on from a name.
    expect(structureSymbolNamed('Steps')).toBeNull();
    expect(structureSymbolNamed('Hot tub')).toBeNull();
  });
});
