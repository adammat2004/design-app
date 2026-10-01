import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Box3, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SUITABLE_PIECES, SYMBOLS, type SymbolId } from '@garden-studio/schema';
import { FURNITURE_MANIFEST } from './furniture/manifest';
import {
  FURNITURE_MODELS,
  FURNITURE_TRIANGLE_BUDGET,
  furnitureModelFile,
} from './furniture/model-spec';
import { FIT_BAND } from './model-fit';

const PUBLIC = resolve(__dirname, '../../../public');
const entries = Object.values(FURNITURE_MANIFEST.models);

describe('the furniture models', () => {
  it('has built every model the spec composes, and nothing else', () => {
    expect(Object.keys(FURNITURE_MANIFEST.models).sort()).toEqual(
      Object.keys(FURNITURE_MODELS).sort(),
    );
    for (const entry of entries)
      expect(entry.file).toBe(furnitureModelFile(entry.key as keyof typeof FURNITURE_MODELS));
  });

  it('ships each file byte for byte, CC0, within the AR budget, untextured', () => {
    for (const entry of entries) {
      const path = resolve(PUBLIC, entry.file);
      expect(existsSync(path), entry.file).toBe(true);
      const bytes = readFileSync(path);
      expect(createHash('sha256').update(bytes).digest('hex'), entry.file).toBe(entry.sha256);
      expect(entry.triangles, entry.key).toBeLessThanOrEqual(FURNITURE_TRIANGLE_BUDGET);
      expect(entry.licence).toBe('CC0-1.0');
      expect(entry.maxTexturePx, entry.key).toBe(0);
      for (const source of entry.sources)
        expect(source.page).toMatch(/^https:\/\/polyhaven\.com\/a\//);
    }
  });

  it('fits every model into its symbol’s own footprint at a scale the band accepts', () => {
    for (const entry of entries) {
      const footprint = SYMBOLS[entry.key as SymbolId].footprint;
      expect(footprint.kind, entry.key).toBe('rect');
      if (footprint.kind !== 'rect') continue;
      const scale = Math.min(
        footprint.width / entry.naturalSize[0],
        footprint.depth / entry.naturalSize[2],
      );
      expect(scale, entry.key).toBeGreaterThanOrEqual(FIT_BAND.min);
      expect(scale, entry.key).toBeLessThanOrEqual(FIT_BAND.max);
    }
  });

  it('only models furniture a structure can hold', () => {
    const offered = new Set(Object.values(SUITABLE_PIECES).flat());
    for (const key of Object.keys(FURNITURE_MODELS))
      expect(offered.has(key as SymbolId), key).toBe(true);
  });

  it('decodes each GLB to one mesh, base-centred, inside the size the manifest claims', async () => {
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    for (const entry of entries) {
      const bytes = readFileSync(resolve(PUBLIC, entry.file));
      // A fresh buffer from this realm: the loader checks `instanceof ArrayBuffer`, and Node's differs.
      const data = new ArrayBuffer(bytes.length);
      new Uint8Array(data).set(bytes);
      const gltf = await loader.parseAsync(data, '');
      gltf.scene.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh) meshes.push(object);
      });
      expect(meshes.length, entry.key).toBe(1);
      const box = new Box3().setFromObject(gltf.scene);
      const [w, h, d] = entry.naturalSize;
      // Stood on the ground at its pivot, and within what it was composed to fill (quantisation slack).
      expect(box.min.y, entry.key).toBeCloseTo(0, 2);
      expect(box.max.y, entry.key).toBeLessThanOrEqual(h + 0.01);
      expect(box.min.x, entry.key).toBeGreaterThanOrEqual(-w / 2 - 0.01);
      expect(box.max.x, entry.key).toBeLessThanOrEqual(w / 2 + 0.01);
      expect(box.min.z, entry.key).toBeGreaterThanOrEqual(-d / 2 - 0.01);
      expect(box.max.z, entry.key).toBeLessThanOrEqual(d / 2 + 0.01);
    }
  });
});
