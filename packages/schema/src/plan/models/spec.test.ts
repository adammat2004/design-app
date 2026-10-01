import { describe, expect, it } from 'vitest';
import type { DesignElement } from '../concepts.js';
import { applyStructurePreset } from '../structure/definitions.js';
import {
  canonicalSpec,
  composeReferencePrompt,
  MODEL_SPEC_VERSION,
  ModelAssetSpecSchema,
  referenceSubject,
  specForPreset,
  specFromElement,
} from './spec.js';

const gazebo = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'g1',
  category: 'structure',
  role: 'feature',
  symbol: 'gazebo',
  zone: 'back',
  height: 2.8,
  shape: { kind: 'rect', centre: { x: 10, y: 8 }, width: 3, depth: 3, rotation: 30 },
  ...over,
});

describe('specFromElement', () => {
  it('describes a gazebo by its resolved configuration and its own size', () => {
    const spec = specFromElement(gazebo())!;
    expect(spec.symbol).toBe('gazebo');
    expect(spec.material).toBeNull();
    // Nothing stored resolves to the definition's defaults.
    expect(spec.structure).toEqual({
      model: 'classic',
      roofKind: 'hipped',
      roofFinish: 'hardwood',
      frame: 'hardwood',
      sides: { left: 'open', right: 'open', rear: 'open' },
      lighting: false,
    });
    expect(spec.nominal).toEqual({ width: 3, depth: 3, height: 2.8 });
    expect(() => ModelAssetSpecSchema.parse(spec)).not.toThrow();
  });

  it('calls a stored preset and the same values left to resolve the same thing', () => {
    const bare = specFromElement(gazebo({ material: 'hardwood' }))!;
    const written = specFromElement(applyStructurePreset(gazebo(), 'classic'))!;
    expect(canonicalSpec(written)).toBe(canonicalSpec(bare));
  });

  it('describes something that is not configurable by its material', () => {
    const spec = specFromElement(gazebo({ symbol: 'shed', material: 'dark-stained-timber' }))!;
    expect(spec.structure).toBeNull();
    expect(spec.material).toBe('dark-stained-timber');
  });

  it('has nothing to say about an element with no symbol or no rectangle', () => {
    expect(specFromElement(gazebo({ symbol: undefined }))).toBeNull();
    expect(
      specFromElement(gazebo({ shape: { kind: 'point', at: { x: 1, y: 1 }, radius: 1 } })),
    ).toBeNull();
  });
});

describe('specForPreset', () => {
  it('agrees with a gazebo placed with that preset', () => {
    const placed = specFromElement(
      applyStructurePreset(
        gazebo({
          shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 3, depth: 3, rotation: 0 },
        }),
        'modern',
      ),
    )!;
    expect(canonicalSpec(specForPreset('gazebo', 'modern'))).toBe(canonicalSpec(placed));
  });

  it('takes a different frame and roof covering the structure offers', () => {
    const spec = specForPreset('gazebo', 'classic', {
      frame: 'dark-stained-timber',
      roofFinish: 'shingle-dark',
    });
    expect(spec.structure).toMatchObject({
      frame: 'dark-stained-timber',
      roofFinish: 'shingle-dark',
      roofKind: 'hipped',
    });
    expect(spec.nominal).toEqual({ width: 3, depth: 3, height: 2.8 });
  });

  it('refuses a choice no plan could ever ask for', () => {
    expect(() => specForPreset('gazebo', 'rustic')).toThrow(/no preset/);
    expect(() => specForPreset('shed', 'classic')).toThrow(/not a configurable/);
    expect(() => specForPreset('gazebo', 'classic', { roofFinish: 'warm-led' })).toThrow(
      /not offered/,
    );
  });
});

describe('canonicalSpec', () => {
  it('is the same string whatever order the fields were built in, and carries the version', () => {
    const spec = specForPreset('gazebo', 'classic');
    const shuffled = {
      notes: spec.notes,
      nominal: {
        height: spec.nominal.height,
        depth: spec.nominal.depth,
        width: spec.nominal.width,
      },
      style: spec.style,
      material: spec.material,
      structure: spec.structure,
      symbol: spec.symbol,
    };
    expect(canonicalSpec(shuffled)).toBe(canonicalSpec(spec));
    expect(canonicalSpec(spec).startsWith(`model-spec/${MODEL_SPEC_VERSION}:`)).toBe(true);
  });

  it('ignores differences under a millimetre and sees anything larger', () => {
    const spec = specForPreset('gazebo', 'classic');
    const nudged = { ...spec, nominal: { ...spec.nominal, width: 3.0000004 } };
    const wider = { ...spec, nominal: { ...spec.nominal, width: 3.01 } };
    expect(canonicalSpec(nudged)).toBe(canonicalSpec(spec));
    expect(canonicalSpec(wider)).not.toBe(canonicalSpec(spec));
  });
});

describe('the reference prompt', () => {
  it('says what the spec says and nothing it does not', () => {
    const spec = specForPreset('gazebo', 'classic', {
      frame: 'dark-stained-timber',
      roofFinish: 'shingle-dark',
    });
    const subject = referenceSubject(spec);
    expect(subject).toContain('dark-stained timber');
    expect(subject).toContain('covered in dark shingles');
    expect(subject).toContain('hipped roof');
    expect(subject).toContain('open on all four sides');
    expect(subject).toContain('about 3 metres by 3 metres');
    expect(subject).not.toContain('LED');
  });

  it('names the screens and the light where there are some', () => {
    const subject = referenceSubject(specForPreset('gazebo', 'modern'));
    expect(subject).toContain('slatted screen filling the rear side');
    expect(subject).toContain('LED strip');
    expect(subject).toContain('flat solid roof');
  });

  it('wraps the subject in the one template, which refuses a comparison', () => {
    const prompt = composeReferencePrompt(specForPreset('gazebo', 'classic'));
    expect(prompt).toMatch(/^A product photograph of a single garden gazebo/);
    expect(prompt).toContain('isolated on a plain pure white seamless background');
    expect(prompt).toContain('never a diptych');
  });
});
