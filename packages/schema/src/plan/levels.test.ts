import { describe, expect, it } from 'vitest';
import { levelBands, MIN_LEVEL_CHANGE, RISER_TARGET, stepFlight } from './levels.js';
import type { DesignElement } from './concepts.js';

function terrace(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 't1',
    category: 'paved-area',
    role: 'feature',
    name: 'Seating patio',
    material: 'stone-pavers',
    zone: 'back',
    elevation: 0.45,
    shape: {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        { x: 10, y: 9 },
        { x: 5, y: 9 },
      ],
    },
    ...over,
  } as DesignElement;
}

const total = (bands: { length: number }[]) => bands.reduce((sum, band) => sum + band.length, 0);

describe('levelBands', () => {
  it('retains every free side of a raised surface', () => {
    const bands = levelBands([terrace()]);

    // One continuous face right round: the ground drops away on all four sides.
    expect(bands).toHaveLength(1);
    expect(total(bands)).toBeCloseTo(18, 6);
    expect(bands[0]!.rise).toBeCloseTo(0.45, 6);
    expect(bands[0]!.sunken).toBe(false);
    // Retained in what it is paved with, which is what a raised terrace actually is.
    expect(bands[0]!.material).toBe('stone-pavers');
    // No walling chosen: a plain upstand in the host's own paving is the default and a real answer.
    expect(bands[0]!.walling).toBeNull();
  });

  it('leaves the side against the house unretained', () => {
    /*
     * The one exclusion, and it is physical rather than tidy: the ground drops away on every free
     * edge of a raised terrace, but where it meets the building there is no drop and no upstand,
     * only floor meeting wall.
     */
    const house = [
      { x: 5, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
    ];

    const bands = levelBands([terrace()], { house });

    expect(bands).toHaveLength(1);
    expect(total(bands)).toBeCloseTo(13, 6);
  });

  it('retains a raised terrace against the fence too', () => {
    /*
     * Deliberately unlike edging, which leaves bare the boundary side. A terrace raised against the
     * fence really does need holding up there — the fence is not doing it — so the boundary is not
     * an exclusion here. Getting this wrong would draw a terrace floating at one edge.
     */
    const againstFence = terrace({
      shape: {
        kind: 'polygon',
        cornerRadius: 0,
        points: [
          { x: 0, y: 5 },
          { x: 5, y: 5 },
          { x: 5, y: 9 },
          { x: 0, y: 9 },
        ],
      },
    } as Partial<DesignElement>);

    expect(total(levelBands([againstFence]))).toBeCloseTo(18, 6);
  });

  it('reports a sunken area as a face with the ground above it', () => {
    const sunken = terrace({ elevation: -0.6 });
    const bands = levelBands([sunken]);

    expect(bands[0]!.rise).toBeCloseTo(0.6, 6);
    expect(bands[0]!.sunken).toBe(true);
  });

  it('ignores a change too small to be a step', () => {
    // Below this an upstand is a line a pixel wide and reads as an edging course, which is a
    // different thing the user may already have asked for on the same element.
    expect(levelBands([terrace({ elevation: MIN_LEVEL_CHANGE / 2 })])).toEqual([]);
    expect(levelBands([terrace({ elevation: 0 })])).toEqual([]);
    expect(levelBands([terrace({ elevation: undefined })])).toEqual([]);
  });

  it('gives a point no plinth of its own', () => {
    /*
     * A tree standing in a raised bed is carried up by the bed. Retaining it separately would draw
     * a ring round every shrub on a terrace.
     */
    const tree = terrace({
      shape: { kind: 'point', at: { x: 7, y: 7 }, radius: 1.5 },
    } as Partial<DesignElement>);

    expect(levelBands([tree])).toEqual([]);
  });

  it('carries a chosen walling material, and refuses one that is not walling', () => {
    /*
     * `retaining` is a plain string like `material`, so a stored plan cannot fail to parse — which
     * means a nonsense value has to be refused here rather than by the schema. Falling back to the
     * plain upstand is the right refusal: it is what the element would have drawn anyway.
     */
    expect(levelBands([terrace({ retaining: 'walling-stone' })])[0]!.walling).toBe('walling-stone');
    expect(levelBands([terrace({ retaining: 'standard-turf' })])[0]!.walling).toBeNull();
    expect(levelBands([terrace({ retaining: 'brick-edging' })])[0]!.walling).toBeNull();
  });

  it('does not retain a flight of steps', () => {
    /*
     * A flight carries an elevation — its nosings are counted from it — but it is the thing that
     * *resolves* a level change rather than one that needs holding back. Retaining it draws a wall
     * round the very route down off the terrace, which is the one place a reader's eye goes.
     */
    const flight = terrace({ symbol: 'steps' });

    expect(levelBands([flight])).toEqual([]);
  });

  it('ignores a hidden element', () => {
    expect(levelBands([terrace({ hidden: true })])).toEqual([]);
  });

  it('is a pure function of its input', () => {
    const elements = [terrace()];
    const before = structuredClone(elements);

    expect(levelBands(elements)).toEqual(levelBands(elements));
    expect(elements).toEqual(before);
  });
});

describe('stepFlight', () => {
  it('divides the rise into whole risers near the target', () => {
    const flight = stepFlight(0.45)!;

    expect(flight.risers).toBe(3);
    expect(flight.riserHeight).toBeCloseTo(0.15, 6);
    // The whole point: the risers multiply back to exactly the rise they climb.
    expect(flight.risers * flight.riserHeight).toBeCloseTo(0.45, 9);
  });

  it('never builds a fraction of a step, whatever the rise', () => {
    /*
     * The property rather than a table of cases. Every riser is equal, every count is whole, and
     * the flight climbs exactly what it was asked to — which is what stops a drawn flight
     * disagreeing with the level change it serves.
     */
    for (let rise = 0.1; rise <= 2; rise += 0.01) {
      const flight = stepFlight(rise)!;

      expect(Number.isInteger(flight.risers)).toBe(true);
      expect(flight.risers).toBeGreaterThanOrEqual(1);
      expect(flight.risers * flight.riserHeight).toBeCloseTo(rise, 9);
      /*
       * At or below the target, never above it. `ceil` is what guarantees the upper bound — with
       * `round` a 230 mm rise came back as one 230 mm riser, steeper than a private stair is
       * allowed to be. A flight may err shallow; it may not err steep.
       */
      expect(flight.riserHeight).toBeGreaterThan(0.08);
      expect(flight.riserHeight).toBeLessThanOrEqual(RISER_TARGET + 1e-9);
    }
  });

  it('climbs a fall the same way it climbs a rise', () => {
    expect(stepFlight(-0.45)).toEqual(stepFlight(0.45));
  });

  it('refuses a change too small to be a flight', () => {
    expect(stepFlight(0)).toBeNull();
    expect(stepFlight(MIN_LEVEL_CHANGE / 2)).toBeNull();
  });

  it('lands one riser near the target for a single step', () => {
    const flight = stepFlight(RISER_TARGET)!;

    expect(flight.risers).toBe(1);
    expect(flight.riserHeight).toBeCloseTo(RISER_TARGET, 9);
  });
});
