import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASSET_FAMILIES, ASSET_IDS, type AssetFamily } from './asset-spec';
import {
  ASSET_SPEC_VERSION,
  composePrompt,
  ELEVATED,
  SHARED_RULES,
  STYLE,
  TEMPLATE_CAMERA,
} from './asset-style';

/**
 * The specification is one module and every prompt is composed from it. These tests hold the
 * families to the specification's shape — the right camera, a subject per variant — and hold the
 * two cameras to each other, so a rewording of one cannot quietly leave the other behind.
 */

const families = ASSET_IDS.map((id) => [id, ASSET_FAMILIES[id] as AssetFamily] as const);

describe('every family fits the specification', () => {
  it('draws with a template of its own camera', () => {
    for (const [id, family] of families) {
      expect(TEMPLATE_CAMERA[family.template], id).toBe(family.camera ?? 'plan');
    }
  });

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

describe('the two cameras share one visual system', () => {
  it('say the shared rules in the same words', () => {
    for (const rule of SHARED_RULES) {
      expect(STYLE.camera.plan.toLowerCase(), rule).toContain(rule.toLowerCase());
      expect(STYLE.camera.elevated.toLowerCase(), rule).toContain(rule.toLowerCase());
    }
  });

  it('every sprite template begins with its camera', () => {
    for (const [name, text] of Object.entries(STYLE.template)) {
      const camera = TEMPLATE_CAMERA[name as keyof typeof STYLE.template];
      if (name === 'procedural' || name === 'face' || name === 'tile' || name === 'skin') continue;
      expect(text.startsWith(STYLE.camera[camera]), name).toBe(true);
    }
    expect(ELEVATED).toBe(STYLE.camera.elevated);
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

  it('tints only a recolourable plan sprite', () => {
    const plant = { ...base, template: 'plant' as const, recolourable: true };
    expect(composePrompt(plant, 1)).toContain(STYLE.tintable);

    const elevated = { ...plant, camera: 'elevated' as const, template: 'elevated-shrub' as const };
    expect(composePrompt(elevated, 1)).not.toContain(STYLE.tintable);

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
      join(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'visualise-asset-style.md'),
      'utf8',
    );
    expect(doc).toContain(`ASSET_SPEC_VERSION = '${ASSET_SPEC_VERSION}'`);
  });
});
