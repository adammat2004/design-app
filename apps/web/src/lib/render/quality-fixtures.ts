import { boundaryPolygon, readPlanDocument, type PlanDocument } from '@garden-studio/schema';
import target from '../../../scripts/fixtures/target.plan.json';
import naturalistic from '../../../scripts/fixtures/naturalistic.plan.json';
import formal from '../../../scripts/fixtures/formal.plan.json';
import courtyard from '../../../scripts/fixtures/courtyard.plan.json';
import narrow from '../../../scripts/fixtures/narrow.plan.json';
import reference from '../../../scripts/fixtures/reference.plan.json';
import type { PlanScene } from './build-scene';
import { courseFixtureElements } from './course-fixtures';

/** Fixed inputs for the dev lab, image regressions and performance measurements. Never saved. */
export const QUALITY_FIXTURES = ['target', 'naturalistic', 'formal', 'courtyard', 'narrow', 'levels', 'dense', 'reference', 'courses'] as const;
export type QualityFixture = typeof QUALITY_FIXTURES[number];
const documents: Record<string, unknown> = { target, naturalistic, formal, courtyard, narrow, reference };
export function qualityDocument(name: QualityFixture): PlanDocument {
  const document = readPlanDocument(structuredClone(documents[name] ?? target));
  if (name === 'courses') {
    document.site.vertices = [{ id: 'v0', x: 0, y: 0 }, { id: 'v1', x: 14, y: 0 },
      { id: 'v2', x: 14, y: 15 }, { id: 'v3', x: 0, y: 15 }];
    document.site.house = null;
    document.site.boundaryStyles = [];
    document.site.gates = [];
    document.layout.elements = courseFixtureElements();
  }
  if (name === 'levels') {
    const terrace = document.layout.elements.find((element) => element.category === 'paved-area' && element.role === 'feature');
    if (terrace) { terrace.elevation = 0.45; terrace.retaining = 'walling-stone'; terrace.edging = 'brick-edging'; }
  }
  if (name === 'dense') {
    document.layout.elements.push({ id: 'dense-bed', category: 'planting-bed', role: 'fill', fillKind: 'accent',
      zone: 'back', material: 'mixed-border', shape: { kind: 'rect', centre: { x: 11, y: 6 }, width: 16, depth: 7, rotation: 0 } });
  }
  return document;
}
export function qualityScene(name: QualityFixture): PlanScene {
  const document = qualityDocument(name);
  return { boundary: boundaryPolygon(document.site), house: document.site.house,
    elements: document.layout.elements, site: document.site };
}
