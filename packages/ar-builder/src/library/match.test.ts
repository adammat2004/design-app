import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ModelLibrarySchema,
  type ModelLibrary,
  type ModelLibraryEntry,
} from '@garden-studio/ar-contract';
import { mergeStructureConfig, type DesignElement } from '@garden-studio/schema';
import { matchLibraryAsset, type LibraryOutcome } from './match.js';

/** The library actually checked in — so this suite also proves the published file parses. */
const PUBLISHED: ModelLibrary = ModelLibrarySchema.parse(
  JSON.parse(
    readFileSync(
      join(__dirname, '../../../../apps/web/public/models/library/library.json'),
      'utf8',
    ),
  ),
);
const GAZEBO_ID = 'gazebo-classic-dark-stained-3x3';
const published = PUBLISHED.entries.find((entry) => entry.id === GAZEBO_ID)!;

/** A gazebo configured as the published model depicts: dark-stained frame, dark shingles. */
function gazebo(
  over: Partial<DesignElement> & { width?: number; depth?: number } = {},
): DesignElement {
  const { width = 3, depth = 3, ...rest } = over;
  return {
    id: 'g1',
    category: 'structure',
    role: 'feature',
    symbol: 'gazebo',
    zone: 'back',
    material: 'dark-stained-timber',
    height: 2.8,
    shape: { kind: 'rect', centre: { x: 4, y: 6 }, width, depth, rotation: 0 },
    structure: { preset: 'classic', roof: { kind: 'hipped', finish: 'shingle-dark' } },
    ...rest,
  };
}

/** A copy of the published entry with a different id, size or style. */
function variant(over: Partial<ModelLibraryEntry>): ModelLibraryEntry {
  return { ...published, ...over };
}

const library = (...entries: ModelLibraryEntry[]): ModelLibrary => ({ version: 1, entries });

function modelOf(outcome: LibraryOutcome) {
  expect(outcome.kind).toBe('model');
  return outcome.kind === 'model' ? outcome.match : null!;
}

describe('the published gazebo', () => {
  it('is in the library at its real size', () => {
    expect(published).toBeDefined();
    expect(published.naturalSize[0]).toBeCloseTo(3, 2);
    expect(published.naturalSize[2]).toBeCloseTo(3, 2);
    expect(published.depicts.structure).toMatchObject({
      frame: 'dark-stained-timber',
      roofFinish: 'shingle-dark',
      roofKind: 'hipped',
    });
  });

  it('draws a gazebo configured as it depicts, scaled to exactly the element', () => {
    const match = modelOf(matchLibraryAsset(gazebo(), PUBLISHED));
    expect(match.entry.id).toBe(GAZEBO_ID);
    expect(match.size).toEqual([3, 2.8, 3]);
    expect(match.stretch[0]).toBeCloseTo(3 / published.naturalSize[0], 9);
    expect(match.stretch[1]).toBeCloseTo(2.8 / published.naturalSize[1], 9);
  });
});

describe('what it depicts must be what the plan says', () => {
  it('draws the parts for a default gazebo, whose roof is timber rather than shingles', () => {
    const plain = gazebo({ material: undefined, structure: undefined });
    expect(matchLibraryAsset(plain, PUBLISHED)).toEqual({
      kind: 'procedural',
      reason: 'no-model-depicts',
    });
  });

  it('refuses on any one hard fact: the frame, a side, the light', () => {
    const changes: Partial<DesignElement>[] = [
      { material: 'aluminium-dark' },
      { structure: { ...gazebo().structure, sides: { rear: 'slatted' } } },
      { structure: { ...gazebo().structure, lighting: true } },
      { structure: { ...gazebo().structure, roof: { kind: 'solid', finish: 'shingle-dark' } } },
    ];
    for (const change of changes) {
      expect(matchLibraryAsset(gazebo(change), PUBLISHED).kind, JSON.stringify(change)).toBe(
        'procedural',
      );
    }
  });

  it('never draws one symbol with another symbol’s model', () => {
    expect(matchLibraryAsset(gazebo({ symbol: 'pergola' }), PUBLISHED).kind).toBe('procedural');
  });

  it('has nothing to say about an element no model could stand in for', () => {
    const point: DesignElement = {
      ...gazebo(),
      shape: { kind: 'point', at: { x: 1, y: 1 }, radius: 1 },
    };
    expect(matchLibraryAsset(point, PUBLISHED)).toEqual({
      kind: 'procedural',
      reason: 'not-modelled',
    });
    expect(matchLibraryAsset(gazebo(), null)).toEqual({ kind: 'procedural', reason: 'no-library' });
    expect(matchLibraryAsset(gazebo(), library())).toEqual({
      kind: 'procedural',
      reason: 'no-library',
    });
  });
});

describe('it must fit without visible stretch', () => {
  // A model exactly 3 × 2.8 × 3, so the band's edges are round numbers: 1.15 and 1/1.15.
  const exact = variant({ id: 'exact', naturalSize: [3, 2.8, 3] });

  it('fits up to 15% larger and 15% smaller on each axis, and no further', () => {
    expect(matchLibraryAsset(gazebo({ width: 3 * 1.15 }), library(exact)).kind).toBe('model');
    expect(matchLibraryAsset(gazebo({ width: 3 * 1.16 }), library(exact))).toEqual({
      kind: 'procedural',
      reason: 'no-model-fits',
    });
    expect(matchLibraryAsset(gazebo({ depth: 3 / 1.15 }), library(exact)).kind).toBe('model');
    expect(matchLibraryAsset(gazebo({ depth: 3 / 1.16 }), library(exact)).kind).toBe('procedural');
  });

  it('holds the height to the band as well, not only the plan', () => {
    expect(matchLibraryAsset(gazebo({ height: 2.8 * 1.15 }), library(exact)).kind).toBe('model');
    expect(matchLibraryAsset(gazebo({ height: 2.4 }), library(exact)).kind).toBe('procedural');
  });

  it('turns a model that may be turned, and draws it in its own frame', () => {
    const long = variant({
      id: 'long',
      naturalSize: [3, 2.8, 2],
      fit: { tolerance: 0.15, turnable: true },
    });
    const match = modelOf(matchLibraryAsset(gazebo({ width: 2, depth: 3 }), library(long)));
    expect(match.turned).toBe(true);
    expect(match.size).toEqual([3, 2.8, 2]);
    const fixed = { ...long, fit: { tolerance: 0.15, turnable: false } };
    expect(matchLibraryAsset(gazebo({ width: 2, depth: 3 }), library(fixed)).kind).toBe(
      'procedural',
    );
  });

  it('takes the model that is stretched least, whatever order the library lists them in', () => {
    const small = variant({ id: 'b-small', naturalSize: [2.8, 2.8, 2.8] });
    const large = variant({ id: 'a-large', naturalSize: [3.4, 2.8, 3.4] });
    expect(
      modelOf(matchLibraryAsset(gazebo({ width: 2.9, depth: 2.9 }), library(large, small))).entry
        .id,
    ).toBe('b-small');
    expect(
      modelOf(matchLibraryAsset(gazebo({ width: 3.3, depth: 3.3 }), library(small, large))).entry
        .id,
    ).toBe('a-large');
  });

  it('breaks an exact tie by id, so the same plan always draws the same model', () => {
    const one = variant({ id: 'twin-b', naturalSize: [3, 2.8, 3] });
    const two = variant({ id: 'twin-a', naturalSize: [3, 2.8, 3] });
    expect(modelOf(matchLibraryAsset(gazebo(), library(one, two))).entry.id).toBe('twin-a');
    expect(modelOf(matchLibraryAsset(gazebo(), library(two, one))).entry.id).toBe('twin-a');
  });

  it('prefers the brief’s style among models that all fit, and never requires it', () => {
    const plain = variant({ id: 'a-plain', naturalSize: [3, 2.8, 3] });
    const cottage = variant({
      id: 'b-cottage',
      naturalSize: [3.1, 2.8, 3.1],
      depicts: { ...published.depicts, style: 'cottage' },
    });
    expect(
      modelOf(matchLibraryAsset(gazebo(), library(plain, cottage), { style: 'cottage' })).entry.id,
    ).toBe('b-cottage');
    expect(
      modelOf(matchLibraryAsset(gazebo(), library(plain, cottage), { style: 'modern' })).entry.id,
    ).toBe('a-plain');
  });
});

describe('the user’s choice', () => {
  const pin = (element: DesignElement, look: string): DesignElement => ({
    ...element,
    structure: mergeStructureConfig(element.structure, { look }),
  });

  it('draws the parts when the user chose the parts, whatever the library has', () => {
    expect(matchLibraryAsset(pin(gazebo(), 'procedural'), PUBLISHED)).toEqual({
      kind: 'procedural',
      reason: 'chosen',
    });
  });

  it('treats auto as no choice', () => {
    expect(matchLibraryAsset(pin(gazebo(), 'auto'), PUBLISHED).kind).toBe('model');
  });

  it('keeps a pinned model over a better-fitting one', () => {
    const better = variant({ id: 'a-better', naturalSize: [3, 2.8, 3] });
    const outcome = matchLibraryAsset(pin(gazebo(), GAZEBO_ID), library(better, published));
    expect(modelOf(outcome).entry.id).toBe(GAZEBO_ID);
    expect(outcome.kind === 'model' && outcome.pinned).toBe(true);
  });

  it('draws the parts, and says why, when the pin no longer holds', () => {
    expect(matchLibraryAsset(pin(gazebo(), 'gone-from-the-library'), PUBLISHED)).toEqual({
      kind: 'procedural',
      reason: 'pin-missing',
    });
    expect(matchLibraryAsset(pin(gazebo({ material: 'hardwood' }), GAZEBO_ID), PUBLISHED)).toEqual({
      kind: 'procedural',
      reason: 'pin-depicts-other',
    });
    expect(matchLibraryAsset(pin(gazebo({ width: 4.5 }), GAZEBO_ID), PUBLISHED)).toEqual({
      kind: 'procedural',
      reason: 'pin-does-not-fit',
    });
  });
});
