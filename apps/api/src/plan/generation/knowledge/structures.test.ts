import {
  FURNISH_MARGIN,
  sizeForSeats,
  STRUCTURE_DEFINITIONS,
  type DesignElement,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../archetypes.js';
import { resolveConstraints } from '../constraints.js';
import { identifyFeatures } from '../design/adapters.js';
import { furnishRoom, hostFloor, MARGIN } from '../furnish.js';
import { GAZEBO_PLAN_NAME, hostChoice } from './structures.js';

const constraints = resolveConstraints(
  {
    purpose: '',
    desiredFeatures: ['pergola'],
    featuresOther: '',
    budget: 'high',
    maintenance: 'medium',
    style: 'cottage',
    styleOther: '',
  },
  ARCHETYPES[0]!,
  180,
);

const boundary = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 30 },
  { x: 0, y: 30 },
];

const host = (symbol: string, width = 3.6): DesignElement => ({
  id: 'host',
  category: 'structure',
  role: 'feature',
  name: symbol === 'gazebo' ? GAZEBO_PLAN_NAME : 'Dining pergola',
  zone: 'back',
  symbol,
  shape: { kind: 'rect', centre: { x: 15, y: 15 }, width, depth: width, rotation: 0 },
});

const furnishingsOf = (element: DesignElement, diningElsewhere: boolean) =>
  furnishRoom(element, 'pergola', {
    index: 0,
    rng: () => 0.5,
    constraints,
    houseRing: null,
    boundary,
    nextId: (() => {
      let n = 0;
      return () => `f${(n += 1)}`;
    })(),
    diningElsewhere,
  }).map((item) => item.symbol);

describe('hostChoice — a pergola at the far end of a traditional or natural garden is a gazebo', () => {
  it.each([
    ['far-room', 'cottage', 'gazebo'],
    ['axis-end', 'formal', 'gazebo'],
    ['terrace-end', 'cottage', undefined],
    ['beside-terrace', 'formal', undefined],
    ['far-room', 'modern', undefined],
    ['far-room', 'lowMaintenance', undefined],
    ['far-room', null, undefined],
  ] as const)('%s on a %s brief → %s', (slot, style, symbol) => {
    expect(hostChoice('pergola', slot, style).symbol).toBe(symbol);
  });

  it('never turns anything else into a gazebo', () => {
    expect(hostChoice('seating', 'far-room', 'cottage')).toEqual({});
    expect(hostChoice('pergola', null, 'cottage')).toEqual({});
  });

  /** The scorer, the explanation and the eval harness must still count it as the pergola asked for. */
  it('is still identified as the pergola the brief asked for', () => {
    expect(identifyFeatures([host('gazebo')]).get('host')).toBe('pergola');
  });
});

describe('what goes in a gazebo', () => {
  it('seats people at a table when the garden has none by the house', () => {
    expect(furnishingsOf(host('gazebo'), false)).toEqual(['dining-set-4']);
  });

  it('is somewhere to sit when the table is already by the house', () => {
    expect(furnishingsOf(host('gazebo'), true)).toEqual(['sofa-set']);
  });

  it('sets nothing round its edge, unlike a pergola off the terrace', () => {
    expect(furnishingsOf(host('pergola', 4.4), false)).toContain('planter');
    expect(furnishingsOf(host('gazebo', 4.4), false)).not.toContain('planter');
  });
});

describe('the pergola floor did not move', () => {
  /** `hostFloor('pergola')` sizes the terrace-end bay in every composition. */
  it('is still the four-seater plus the furnishing margin, the smallest dining pergola', () => {
    expect(MARGIN).toBe(FURNISH_MARGIN);
    expect(hostFloor('pergola', 'smallest')).toEqual({ width: 3, depth: 3 });
    const four = sizeForSeats(STRUCTURE_DEFINITIONS.pergola!, 4);
    expect([four.long, four.short]).toEqual([3, 3]);
  });
});
