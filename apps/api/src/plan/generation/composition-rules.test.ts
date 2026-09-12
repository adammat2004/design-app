import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeZones,
  measureComposition,
  PlanDocumentSchema,
  type CompositionReport,
} from '@garden-studio/schema';
import { COMPOSITION_BANDS, compositionRules, describeComposition } from './composition-rules.js';

/*
 * Pure: a report is a plain object, so every band edge can be walked without a database. The
 * one file read is the traced target, which the bands were derived from and must pass.
 */

function report(overrides: Partial<CompositionReport> = {}): CompositionReport {
  return {
    sampledArea: 200,
    shares: { hard: 0.3, lawn: 0.35, planting: 0.3, water: 0, undesigned: 0.05, existing: 0 },
    terrace: { width: 6, depth: 3.6, minDimension: 3.6, rotation: 0 },
    panel: { category: 'lawn', area: 60, minDimension: 5 },
    lawn: { area: 60, minDimension: 5 },
    baseByZone: { back: 'lawn' },
    frontHasLawn: false,
    courtyard: false,
    ...overrides,
  };
}

const garden = { roomDepth: 12, lawnAllowed: true };

describe('compositionRules', () => {
  it('passes a composed garden', () => {
    expect(compositionRules(report(), garden)).toEqual([]);
  });

  it('names exactly one violation at each band edge', () => {
    const bands = COMPOSITION_BANDS.garden;
    for (const key of ['hard', 'lawn', 'planting', 'undesigned'] as const) {
      const below = report({ shares: { ...report().shares, [key]: bands[key].min - 0.01 } });
      const above = report({ shares: { ...report().shares, [key]: bands[key].max + 0.01 } });
      if (bands[key].min > 0) {
        const low = compositionRules(below, garden);
        expect(low).toHaveLength(1);
        expect(low[0]).toContain(`${key} share`);
      }
      const high = compositionRules(above, garden);
      expect(high).toHaveLength(1);
      expect(high[0]).toContain(`${key} share`);
    }
  });

  it('judges a courtyard and a no-lawn brief by the courtyard bands', () => {
    const paved = report({
      shares: { hard: 0.7, lawn: 0, planting: 0.25, water: 0, undesigned: 0.05, existing: 0 },
      panel: null,
      lawn: null,
      courtyard: true,
    });
    expect(compositionRules(paved, { roomDepth: 4, lawnAllowed: true })).toEqual([]);
    // The same shares on a garden would be far too hard.
    expect(compositionRules({ ...paved, courtyard: false }, garden).length).toBeGreaterThan(0);
    // A low-maintenance concept has a gravel panel and no lawn: judged as a courtyard.
    const gravel = report({
      shares: { hard: 0.6, lawn: 0, planting: 0.35, water: 0, undesigned: 0.05, existing: 0 },
      panel: { category: 'gravel-mulch', area: 40, minDimension: 4 },
      lawn: null,
    });
    expect(compositionRules(gravel, { roomDepth: 12, lawnAllowed: false })).toEqual([]);
  });

  it('holds the terrace to its floor, capped by the room, and notices a missing one', () => {
    const thin = report({ terrace: { width: 12, depth: 1, minDimension: 1, rotation: 0 } });
    expect(compositionRules(thin, garden)).toEqual([
      'terrace 12.0 × 1.0 m is under the 3.0 m floor',
    ]);
    // In a 2.5 m deep room a 2.5 m terrace is the whole room and is right.
    const shallow = report({ terrace: { width: 8, depth: 2.5, minDimension: 2.5, rotation: 0 } });
    expect(compositionRules(shallow, { roomDepth: 2.5, lawnAllowed: true })).toEqual([]);
    expect(compositionRules(report({ terrace: null }), garden)).toEqual(['no terrace']);
    // No room at all (no house): a missing terrace is not a fault.
    expect(compositionRules(report({ terrace: null }), { roomDepth: null, lawnAllowed: true })).toEqual([]);
  });

  it('holds the lawn to its floor, allowing for what clipping shaves off', () => {
    const strip = report({ lawn: { area: 30, minDimension: 2 } });
    expect(compositionRules(strip, garden)).toHaveLength(1);
    const rug = report({ lawn: { area: 9, minDimension: 3 } });
    expect(compositionRules(rug, garden)).toHaveLength(1);
    // 4 mm under, which is PostGIS clipping rather than a design fault.
    expect(compositionRules(report({ lawn: { area: 21, minDimension: 2.496 } }), garden)).toEqual([]);
    // 10 cm under is a fault.
    expect(compositionRules(report({ lawn: { area: 21, minDimension: 2.4 } }), garden)).toHaveLength(1);
  });

  it('refuses an empty report rather than passing it', () => {
    expect(compositionRules(report({ sampledArea: 0 }), garden)).toHaveLength(1);
  });

  it('is passed by the traced target the bands were derived from', () => {
    const document = PlanDocumentSchema.parse(
      JSON.parse(readFileSync(resolve('../web/scripts/fixtures/target.plan.json'), 'utf8')),
    );
    const zones = computeZones(document.site.vertices, document.site.house);
    const measured = measureComposition(document.layout.elements, zones);
    expect(compositionRules(measured, { roomDepth: 11.6, lawnAllowed: true })).toEqual([]);
    expect(measured.shares.undesigned).toBeLessThan(0.05);
    expect(describeComposition('target', measured)).toContain('hard');
  });
});
