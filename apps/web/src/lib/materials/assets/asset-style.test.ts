import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_FAMILIES, ASSET_IDS, type AssetFamily } from './asset-spec';
import { ASSET_SPEC_VERSION, composePrompt, STYLE } from './asset-style';

/**
 * The specification is one module and every prompt is composed from it. These tests hold the
 * families to the specification's shape — a subject per variant, the camera left to the template.
 */

const families = ASSET_IDS.map((id) => [id, ASSET_FAMILIES[id] as AssetFamily] as const);

describe('every family fits the specification', () => {
  it('names one subject per variant, or none at all', () => {
    for (const [id, family] of families) {
      if (family.variantSubjects) {
        expect(family.variantSubjects.length, id).toBe(family.variants);
        for (const subject of family.variantSubjects)
          expect(subject.trim().length, id).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The subject is the one thing an author writes, and the one place the shared system can be
   * contradicted. A subject that names the background or the light restates the template at best
   * and disagrees with it at worst — so the words that belong to the template are refused here.
   */
  it('leaves the camera, the light and the background to the template', () => {
    for (const [id, family] of families) {
      if (family.template === 'procedural') continue;
      const subject = family.subject.toLowerCase();
      expect(subject, id).not.toContain('transparent background');
      expect(subject, id).not.toContain('watermark');
      expect(subject, id).not.toContain('degrees');
      expect(subject, id).not.toContain('cast shadow');
    }
  });

  it('procedural families need no prompt', () => {
    for (const [id, family] of families) {
      if (family.procedural) expect(family.template, id).toBe('procedural');
      if (family.template === 'procedural') expect(family.procedural, id).toBeDefined();
    }
  });
});

describe('the camera', () => {
  it('every sprite template begins with it', () => {
    for (const [name, text] of Object.entries(STYLE.template)) {
      if (name === 'procedural' || name === 'face' || name === 'tile' || name === 'skin') continue;
      expect(text.startsWith(STYLE.camera), name).toBe(true);
    }
  });
});

describe('composePrompt', () => {
  const base = {
    kind: 'sprite' as const,
    variants: 1,
    template: 'sprite' as const,
    subject: 'A slatted teak garden bench.',
  };

  it('is template, subject, then the global exclusions for a sprite', () => {
    expect(composePrompt(base, 1)).toBe(
      `${STYLE.template.sprite} ${base.subject} ${STYLE.exclusions}`,
    );
  });

  it('names the variant when the family names them, and asks for a different draw when it does not', () => {
    const named = { ...base, variants: 2, variantSubjects: ['teak', 'grey rattan'] };
    expect(composePrompt(named, 2)).toContain(' Specifically: grey rattan. ');
    expect(composePrompt(named, 2)).not.toContain('Variant 2 of 2');

    const generic = { ...base, variants: 3 };
    expect(composePrompt(generic, 2)).toContain(
      ' Variant 2 of 3, differing in arrangement and detail from the others. ',
    );
  });

  it('tints only a recolourable sprite', () => {
    const plant = { ...base, template: 'plant' as const, recolourable: true };
    expect(composePrompt(plant, 1)).toContain(STYLE.tintable);

    const furniture = { ...base, recolourable: false };
    expect(composePrompt(furniture, 1)).not.toContain(STYLE.tintable);
  });

  /**
   * Opaque materials are lit by the renderer and were kept from the previous library, so their
   * prompts are exactly the sentence their files were generated from: no clause is appended.
   */
  it('appends nothing to an opaque material', () => {
    const face = { ...base, kind: 'face' as const, template: 'face' as const, recolourable: true };
    expect(composePrompt(face, 1)).toBe(`${STYLE.template.face} ${base.subject}`);
    const tile = { ...base, kind: 'texture' as const, template: 'tile' as const };
    expect(composePrompt(tile, 1)).not.toContain(STYLE.exclusions);
  });

  it('hands a procedural family its own description back', () => {
    const drawn = {
      ...base,
      template: 'procedural' as const,
      subject: 'A radial soft black disc.',
    };
    expect(composePrompt(drawn, 1)).toBe('A radial soft black disc.');
  });
});

describe('the written contract', () => {
  it('carries the version the code is at', () => {
    const doc = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'asset-style.md'),
      'utf8',
    );
    expect(doc).toContain(`ASSET_SPEC_VERSION = '${ASSET_SPEC_VERSION}'`);
  });
});
