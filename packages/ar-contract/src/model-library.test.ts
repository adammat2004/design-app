import {
  ModelStructureFactsSchema,
  specForPreset,
  STRUCTURE_DEFINITIONS,
  SymbolIdSchema,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MODEL_LIBRARY,
  libraryEntry,
  ModelDepictsSchema,
  ModelLibraryEntrySchema,
  ModelLibrarySchema,
  type ModelLibraryEntry,
} from './model-library.js';
import { AssetRefSchema, SolidNodeSchema } from './scene.js';

const HASH = 'a'.repeat(64);

function entry(over: Partial<ModelLibraryEntry> = {}): ModelLibraryEntry {
  const spec = specForPreset('gazebo', 'classic', {
    frame: 'dark-stained-timber',
    roofFinish: 'shingle-dark',
  });
  return {
    id: 'gazebo-classic-dark-stained-3x3',
    file: 'models/library/gazebo-classic-dark-stained-3x3.glb',
    thumbnail: null,
    bytes: 2_500_000,
    sha256: HASH,
    triangles: 12_383,
    maxTexturePx: 1024,
    depicts: { symbol: spec.symbol, structure: spec.structure, material: null, style: null },
    naturalSize: [3, 2.9, 3],
    pivot: 'base-centre',
    up: '+y',
    front: '+z',
    fit: { tolerance: 0.15, turnable: true },
    familyId: 'gazebo-classic-3x3',
    source: {
      provider: 'meshy',
      endpoint: 'image-to-3d',
      taskId: 'task',
      aiModel: 'meshy-7.1',
      credits: 30,
      specHash: HASH,
      specVersion: '1.0',
      referenceSha256: HASH,
      generatedAt: '2026-09-30T21:27:40.000Z',
    },
    licence: 'meshy-paid-private',
    approvedAt: '2026-09-30T22:00:00.000Z',
    ...over,
  };
}

describe('the library entry', () => {
  it('parses a complete entry', () => {
    expect(() => ModelLibraryEntrySchema.parse(entry())).not.toThrow();
  });

  it('refuses an id that could not be a file stem', () => {
    for (const id of ['Gazebo', 'gazebo classic', '../gazebo', '-gazebo', '']) {
      expect(ModelLibraryEntrySchema.safeParse(entry({ id })).success, id).toBe(false);
    }
  });

  it('promises the scene convention and nothing else', () => {
    expect(ModelLibraryEntrySchema.safeParse({ ...entry(), pivot: 'centre' }).success).toBe(false);
    expect(ModelLibraryEntrySchema.safeParse({ ...entry(), up: '+z' }).success).toBe(false);
  });

  it('refuses two entries with one id, which would make a lookup depend on file order', () => {
    const library = { version: 1, entries: [entry(), entry()] };
    expect(ModelLibrarySchema.safeParse(library).success).toBe(false);
    expect(ModelLibrarySchema.parse(EMPTY_MODEL_LIBRARY).entries).toEqual([]);
  });

  it('finds an entry by id, and nothing for an id it does not have', () => {
    const library = ModelLibrarySchema.parse({ version: 1, entries: [entry()] });
    expect(libraryEntry(library, 'gazebo-classic-dark-stained-3x3')?.triangles).toBe(12_383);
    expect(libraryEntry(library, 'gazebo-modern')).toBeNull();
  });
});

/**
 * `depicts` is the contract's own copy of the schema's spec, so the phone never imports the schema.
 * This is the check the copy has not drifted, the one `vocabulary.test.ts` makes for `ModelKey`.
 */
describe('depicts', () => {
  it('holds exactly what the schema says a structure is', () => {
    const contract = Object.keys(ModelDepictsSchema.shape.structure.unwrap().shape).sort();
    const schema = Object.keys(ModelStructureFactsSchema.shape).sort();
    expect(contract).toEqual(schema);
  });

  it('accepts every preset of every configurable structure, as the schema resolves it', () => {
    for (const [symbol, definition] of Object.entries(STRUCTURE_DEFINITIONS)) {
      for (const preset of definition!.presets) {
        const spec = specForPreset(SymbolIdSchema.parse(symbol), preset.id);
        const depicts = { symbol, structure: spec.structure, material: null, style: null };
        expect(ModelDepictsSchema.safeParse(depicts).success, `${symbol}/${preset.id}`).toBe(true);
      }
    }
  });
});

describe('AssetRef on a node', () => {
  it('is optional on a solid, so a 0.0.2 solid still parses', () => {
    const solid = {
      id: 's',
      sourceId: 'g1',
      category: 'structure',
      existing: false,
      visibleByDefault: true,
      kind: 'solid',
      parts: [
        {
          material: 'm',
          mesh: {
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            normals: [],
            uvs: [],
            indices: [0, 1, 2],
          },
        },
      ],
    };
    expect(SolidNodeSchema.safeParse(solid).success).toBe(true);
    const withAsset = {
      ...solid,
      asset: {
        id: 'gazebo-classic-dark-stained-3x3',
        position: [1, 0, 2],
        yaw: 0.5,
        size: [3, 2.8, 3],
      },
    };
    expect(SolidNodeSchema.parse(withAsset).asset?.size).toEqual([3, 2.8, 3]);
  });

  it('carries a size and never a scale', () => {
    expect(Object.keys(AssetRefSchema.shape).sort()).toEqual(['id', 'position', 'size', 'yaw']);
  });
});
