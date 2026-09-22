import { describe, expect, it } from 'vitest';
import type { DesignElement } from '@garden-studio/schema';
import { quickCommandsFor, suggestionsFor } from './smart-suggestions';

function patio(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-1',
    category: 'paved-area',
    role: 'feature',
    name: 'Seating patio',
    zone: 'back',
    material: 'concrete',
    shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 4, depth: 3, rotation: 0 },
    ...over,
  } as DesignElement;
}

const light: DesignElement = {
  id: 'l-1',
  category: 'lighting',
  role: 'feature',
  zone: 'back',
  symbol: 'light-spike',
  shape: { kind: 'point', at: { x: 2, y: 2 }, radius: 0.06 },
} as DesignElement;

const pergola: DesignElement = {
  id: 's-1',
  category: 'structure',
  role: 'feature',
  zone: 'back',
  symbol: 'pergola',
  material: 'softwood',
  shape: { kind: 'rect', centre: { x: 4, y: 4 }, width: 3, depth: 3, rotation: 0 },
} as DesignElement;

/**
 * A suggestion is an action on the subject, and the list mixes a direct edit with requests to
 * the designer without distinguishing them — that mix is what the section exists to show.
 */
describe('suggestions for a selected patio', () => {
  it('offers porcelain as a direct material change, and lighting and a pergola as requests', () => {
    const list = suggestionsFor({ kind: 'element', element: patio() }, { elements: [patio()] });

    expect(list.map((s) => s.action.kind)).toEqual(['material', 'request', 'request']);
    expect(list[0]!.action).toEqual({ kind: 'material', material: 'porcelain' });
    expect(list[1]!.title).toBe('Add outdoor lighting');
    expect(list[2]!.title).toBe('Add a pergola');
  });

  /* A card that suggests what is already there is a card that does nothing. */
  it('does not suggest the material it already has', () => {
    const list = suggestionsFor(
      { kind: 'element', element: patio({ material: 'porcelain' }) },
      { elements: [patio({ material: 'porcelain' })] },
    );

    expect(list[0]!.action).toEqual({ kind: 'material', material: 'stone-pavers' });
  });

  it('reads the plan: no lighting suggestion once the garden is lit, no pergola once it has one', () => {
    const list = suggestionsFor(
      { kind: 'element', element: patio() },
      { elements: [patio(), light, pergola] },
    );

    const titles = list.map((s) => s.title);
    expect(titles).not.toContain('Add outdoor lighting');
    expect(titles).not.toContain('Add a pergola');
  });

  /* The sentence names the element, so it reads the same whether or not it is still selected. */
  it('names the element in the request it sends', () => {
    const list = suggestionsFor({ kind: 'element', element: patio() }, { elements: [patio()] });
    const lighting = list.find((s) => s.id === 'lighting')!;

    expect(lighting.action).toEqual({ kind: 'request', text: 'Add lighting around Seating patio' });
  });
});

describe('suggestions for the garden', () => {
  it('offers a seating area only while the garden has no paved feature', () => {
    const empty = suggestionsFor({ kind: 'garden' }, { elements: [] });
    const withPatio = suggestionsFor({ kind: 'garden' }, { elements: [patio()] });

    expect(empty.map((s) => s.id)).toContain('seating');
    expect(withPatio.map((s) => s.id)).not.toContain('seating');
    expect(withPatio.map((s) => s.id)).toContain('lighting');
  });

  /* The reviewer needs a plan to read; on an empty one the card would answer nothing. */
  it('offers a review only once there is something to review', () => {
    expect(suggestionsFor({ kind: 'garden' }, { elements: [] }).some((s) => s.action.kind === 'review')).toBe(false);
    expect(suggestionsFor({ kind: 'garden' }, { elements: [patio()] }).some((s) => s.action.kind === 'review')).toBe(true);
  });
});

describe('quick commands', () => {
  it('are written about "it", which the selection resolves', () => {
    const commands = quickCommandsFor({ kind: 'element', element: patio() });

    expect(commands.map((c) => c.label)).toEqual([
      'Make it bigger',
      'Darker material',
      'Add lighting',
      'Add a pergola',
    ]);
    expect(commands.every((c) => /\bit\b/.test(c.text))).toBe(true);
  });

  it('differ between a bed and a single plant', () => {
    const bed = quickCommandsFor({
      kind: 'element',
      element: patio({ category: 'planting-bed', material: 'mixed-border' }),
    });
    const tree = quickCommandsFor({
      kind: 'element',
      element: patio({
        category: 'planting-bed',
        symbol: 'tree-deciduous',
        shape: { kind: 'point', at: { x: 1, y: 1 }, radius: 2 },
      }),
    });

    expect(bed.map((c) => c.label)).toContain('Deeper border');
    expect(tree.map((c) => c.label)).toContain('Bigger canopy');
  });

  /* The garden's chips are the server's suggestions, not a static table. */
  it('are empty for the garden', () => {
    expect(quickCommandsFor({ kind: 'garden' })).toEqual([]);
  });
});
