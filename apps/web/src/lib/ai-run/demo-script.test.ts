import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boundaryPolygon,
  geometryIsLegal,
  isLocked,
  leavesOf,
  readPlanDocument,
  type DesignElement,
  type PlanDocument,
  type SiteSection,
} from '@garden-studio/schema';
import { buildDemoRun } from './demo-script';
import { prepareRun } from './prepare';

/**
 * The demonstration is written against a real generated garden, not a toy one.
 *
 * `entertaining.plan.json` is one of the fixtures the judging sheets are drawn from: fifty
 * elements, a terrace hard against the house, four straight paths, seven beds and sixteen shrubs.
 * If a script written from predicates works on that, it works on what the generator produces.
 */
function fixture(name: string): PlanDocument {
  return readPlanDocument(
    JSON.parse(readFileSync(resolve(`scripts/fixtures/${name}.plan.json`), 'utf8')),
  );
}

function prepared(document: PlanDocument) {
  const built = buildDemoRun(document.layout.elements, document.site);
  if (!built.ok) throw new Error(built.reason);

  let counter = 0;
  return prepareRun(built.run, document.layout.elements, {
    boundary: boundaryPolygon(document.site),
    allocateId: () => `e-${(counter += 1)}`,
  });
}

describe('the demonstration run', () => {
  it('builds a redesign for a generated garden', () => {
    const document = fixture('entertaining');
    const built = buildDemoRun(document.layout.elements, document.site);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // Every stage of a redesign is represented, which is what the panel narrates.
    const phases = new Set(built.run.operations.map((operation) => operation.phase));
    expect([...phases]).toEqual(expect.arrayContaining(['analyse', 'layout', 'planting', 'review']));
    expect(built.run.summary).toContain('lawn');
  });

  it('is accepted in full: nothing it scripts would be refused', () => {
    for (const name of ['entertaining', 'suburban', 'formal', 'l-shape', 'narrow']) {
      const run = prepared(fixture(name));
      expect(run.refused, `${name} refused: ${JSON.stringify(run.refused)}`).toEqual([]);
      expect(run.operations.length).toBeGreaterThan(3);
    }
  });

  it('leaves every element on the plan legal', () => {
    const document = fixture('entertaining');
    const boundary = boundaryPolygon(document.site);

    for (const element of prepared(document).result)
      expect(geometryIsLegal(element.shape, boundary), `${element.id} left the plot`).toBe(true);
  });

  it('never touches the ground layer of a zone', () => {
    const document = fixture('entertaining');
    const locked = new Set(
      document.layout.elements.filter(isLocked).map((element) => element.id),
    );

    const run = prepared(document);
    for (const operation of run.operations)
      for (const leaf of leavesOf(operation.operation))
        if ('elementId' in leaf) expect(locked.has(leaf.elementId)).toBe(false);
  });

  it('actually changes the garden, and says how much', () => {
    const document = fixture('entertaining');
    const run = prepared(document);

    expect(run.result).not.toBe(run.initial);
    // A bigger terrace, furniture that went with it, and lights that were not there before.
    expect(run.result.length).toBeGreaterThan(run.initial.length);
  });

  it('grows the terrace away from the house, leaving the wall edge where it was', () => {
    const document = fixture('entertaining');
    const before = terraceOf(document.layout.elements);
    const after = terraceOf(prepared(document).result);

    if (before.shape.kind !== 'rect' || after.shape.kind !== 'rect') throw new Error('expected rects');
    expect(after.shape.depth).toBeGreaterThan(before.shape.depth);

    // The house is at the high-y end of this fixture, so the terrace's own high-y edge must not move.
    expect(before.shape.centre.y + before.shape.depth / 2).toBeCloseTo(
      after.shape.centre.y + after.shape.depth / 2,
      6,
    );
  });

  it('keeps the furniture on the terrace it was standing on', () => {
    const document = fixture('entertaining');
    const run = prepared(document);
    const terrace = terraceOf(run.result);

    const lounge = run.result.find((element) => element.symbol === 'sofa-set')!;
    if (terrace.shape.kind !== 'rect' || lounge.shape.kind !== 'rect') throw new Error('expected rects');

    expect(Math.abs(lounge.shape.centre.y - terrace.shape.centre.y)).toBeLessThan(
      terrace.shape.depth / 2,
    );
  });

  it('says why rather than half-playing a plan it cannot work with', () => {
    const document = fixture('entertaining');
    const site: SiteSection = document.site;

    const bare = buildDemoRun([], site);
    expect(bare).toEqual({
      ok: false,
      reason: 'This plan has no paved terrace for the designers to work from.',
    });
  });

  it('declines a plot with no boundary at all', () => {
    const document = fixture('entertaining');
    const built = buildDemoRun(document.layout.elements, {
      ...document.site,
      vertices: [],
      closed: false,
    });

    expect(built).toEqual({ ok: false, reason: 'Draw the property boundary first.' });
  });
});

function terraceOf(elements: DesignElement[]): DesignElement {
  return elements.find((element) => element.name === 'Seating patio')!;
}
