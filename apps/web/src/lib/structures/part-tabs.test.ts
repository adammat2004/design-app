import { describe, expect, it } from 'vitest';
import { resolveStructure, structureParts, type DesignElement } from '@garden-studio/schema';
import { tabForPart, type StructureTab } from './part-tabs';

const ALL: StructureTab[] = ['style', 'roof', 'sides', 'finish', 'lighting', 'inside', 'size'];

const pergola: DesignElement = {
  id: 'p',
  category: 'structure',
  role: 'feature',
  zone: 'back',
  symbol: 'pergola',
  shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 3, depth: 3, rotation: 0 },
  structure: { sides: { left: 'slatted' }, lighting: true },
};

describe('tabForPart', () => {
  it('opens the tab that edits what was clicked', () => {
    expect(tabForPart('roof', ALL)).toBe('roof');
    expect(tabForPart('rafter', ALL)).toBe('roof');
    expect(tabForPart('side-left', ALL)).toBe('sides');
    expect(tabForPart('post', ALL)).toBe('finish');
    expect(tabForPart('light', ALL)).toBe('lighting');
  });

  it('falls back to Style, then the first tab, rather than opening nothing', () => {
    expect(tabForPart('side-rear', ['style', 'size'])).toBe('style');
    expect(tabForPart('light', ['size'])).toBe('size');
  });

  // Every part a real structure is drawn from lands on a tab it actually has.
  it('maps every part of a configured pergola to one of its tabs', () => {
    const structure = resolveStructure(pergola)!;
    const tabs: StructureTab[] = ['style', 'roof', 'sides', 'finish', 'lighting', 'size'];
    for (const part of structureParts(structure))
      expect(tabs).toContain(tabForPart(part.group, tabs));
  });
});
