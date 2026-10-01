import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Color, MeshStandardMaterial } from 'three';
import {
  STRUCTURE_DEFINITIONS,
  STRUCTURE_FINISHES,
  structureFinish,
  type StructureFinishId,
} from '@garden-studio/schema';
import { PBR_CATALOGUE } from './pbr/catalogue';
import { PBR_BYTE_BUDGET, PBR_SETS } from './pbr/pbr-spec';
import { CUSHION_SET, FLOOR_DETAIL, FURNITURE_SETS, NORMAL_SCALE, PANEL_SET } from './pbr-library';
import { calibratedColour, calibratedRoughness, materialForFinish } from './materials-3d';

const PUBLIC_ASSETS = resolve(__dirname, '../../../public/assets');
const catalogued = (key: string) => PBR_CATALOGUE.sets[key];

describe('the 3D material library', () => {
  it('has packed every set the spec names, at the size the spec asks for', () => {
    for (const spec of PBR_SETS) {
      const entry = catalogued(spec.id);
      expect(entry, spec.id).toBeDefined();
      expect(entry!.tileSizeM, spec.id).toBe(spec.tileSizeM);
      expect(entry!.licence, spec.id).toBe('CC0-1.0');
      expect(entry!.px, spec.id).toBeLessThanOrEqual(1024);
      // A detail-only set carries no colour; every other set does, with its measured mean.
      expect(entry!.files.albedo === null, spec.id).toBe(spec.detailOnly === true);
      expect(entry!.meanLinearColour === null, spec.id).toBe(spec.detailOnly === true);
    }
  });

  it('ships every file it catalogues, byte for byte, and fits its budget with the sky', () => {
    let total = PBR_CATALOGUE.hdri?.bytes ?? 0;
    for (const entry of Object.values(PBR_CATALOGUE.sets)) {
      for (const file of Object.values(entry.files)) {
        if (!file) continue;
        const path = resolve(PUBLIC_ASSETS, file.file);
        expect(existsSync(path), file.file).toBe(true);
        expect(readFileSync(path).length, file.file).toBe(file.bytes);
        total += file.bytes;
      }
    }
    expect(total).toBeLessThanOrEqual(PBR_BYTE_BUDGET);
  });

  it('resolves every set a finish, a piece of furniture, a cushion, a panel or a floor asks for', () => {
    for (const id of Object.keys(STRUCTURE_FINISHES) as StructureFinishId[]) {
      const texture = structureFinish(id).texture;
      if (!texture) continue;
      const entry = catalogued(texture.key);
      expect(entry, id).toBeDefined();
      // The finish tells AR how big one repeat is; it has to be the size the set was packed at.
      expect(entry!.tileSizeM, id).toBe(texture.tileSizeM);
      expect(entry!.files.albedo, id).not.toBeNull();
    }
    for (const key of [...Object.values(FURNITURE_SETS), CUSHION_SET, PANEL_SET]) {
      expect(catalogued(key), key).toBeDefined();
    }
    for (const [floor, detail] of Object.entries(FLOOR_DETAIL)) {
      if (detail.set) expect(catalogued(detail.set), floor).toBeDefined();
    }
    for (const spec of PBR_SETS) expect(NORMAL_SCALE[spec.id], spec.id).toBeGreaterThan(0);
  });

  it('says how every floor a structure offers is finished', () => {
    for (const definition of Object.values(STRUCTURE_DEFINITIONS)) {
      for (const floor of definition!.floors ?? [])
        expect(FLOOR_DETAIL[floor], floor).toBeDefined();
    }
  });
});

describe('calibration', () => {
  it('makes the textured surface average to the swatch', () => {
    const swatch = new Color('#9a6b43');
    const mean = catalogued('timber-oak')!.meanLinearColour!;
    const factor = calibratedColour(swatch, mean);
    expect(factor.r * mean[0]).toBeCloseTo(swatch.r, 6);
    expect(factor.g * mean[1]).toBeCloseTo(swatch.g, 6);
    expect(factor.b * mean[2]).toBeCloseTo(swatch.b, 6);
  });

  it('keeps the factor near one for every finish, because the albedos were packed to a known mean', () => {
    for (const id of Object.keys(STRUCTURE_FINISHES) as StructureFinishId[]) {
      const finish = structureFinish(id);
      if (!finish.texture) continue;
      const factor = calibratedColour(
        new Color(finish.baseColor),
        catalogued(finish.texture.key)!.meanLinearColour!,
      );
      for (const channel of [factor.r, factor.g, factor.b]) {
        expect(channel, id).toBeGreaterThan(0.02);
        expect(channel, id).toBeLessThan(4);
      }
      const roughness = calibratedRoughness(
        finish.roughness,
        catalogued(finish.texture.key)!.meanRoughness,
      );
      expect(roughness * catalogued(finish.texture.key)!.meanRoughness, id).toBeCloseTo(
        finish.roughness,
        6,
      );
    }
  });

  it('hands out a flat material at once, and never waits for a texture', () => {
    const material = materialForFinish('hardwood') as MeshStandardMaterial;
    expect(material).toBeInstanceOf(MeshStandardMaterial);
    expect(material.map).toBeNull();
    expect(material.color.getHexString()).toBe('9a6b43');
    expect(materialForFinish('hardwood', { detail: false })).not.toBe(material);
  });
});
