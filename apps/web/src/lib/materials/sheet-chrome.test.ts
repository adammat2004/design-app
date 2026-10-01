import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { DesignElement } from '@garden-studio/schema';
import { drawSheetFooter, legendEntries, scaleBarFor } from './sheet-chrome';

function element(over: Partial<DesignElement> & { id: string }): DesignElement {
  return {
    category: 'paved-area',
    role: 'feature',
    shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 4, depth: 3, rotation: 0 },
    zone: 'back',
    ...over,
  };
}

describe('scaleBarFor', () => {
  it('takes the longest round length that fits', () => {
    // 40 px a metre and 300 px of room: 5 m is 200 px, 10 m would be 400.
    expect(scaleBarFor(40, 300, 'm')).toEqual({ length: 5, px: 200, unit: 'm' });
  });

  it('measures in feet when the plan does', () => {
    const bar = scaleBarFor(40, 300, 'ft');
    expect(bar.unit).toBe('ft');
    expect(bar.px).toBeLessThanOrEqual(300);
    expect(bar.px).toBeCloseTo(bar.length * 0.3048 * 40, 6);
  });
});

describe('legendEntries', () => {
  it('lists each material once, the most ground first and counted things last', () => {
    const legend = legendEntries([
      element({ id: 'a', material: 'porcelain' }),
      element({
        id: 'b',
        category: 'lawn',
        material: 'lawn',
        shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: 10, depth: 8, rotation: 0 },
      }),
      element({ id: 'c', material: 'porcelain' }),
      element({ id: 'd', category: 'furniture', symbol: 'bench' }),
    ]);

    const labels = legend.map((entry) => entry.label);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/lawn|turf/i);
    expect(labels[1]).toMatch(/porcelain/i);
    expect(legend.every((entry) => /^#|^rgb/.test(entry.colour))).toBe(true);
  });

  it('leaves out what the user has hidden, and stops at the limit', () => {
    expect(legendEntries([element({ id: 'a', hidden: true })])).toEqual([]);
    const many = ['porcelain', 'concrete', 'stone-pavers', 'stone-setts'].map((material, index) =>
      element({ id: `e${index}`, material }),
    );
    expect(legendEntries(many, 2)).toHaveLength(2);
  });
});

describe('drawSheetFooter', () => {
  it('paints the strip and nothing above it', () => {
    const canvas = createCanvas(1200, 400);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 1200, 400);

    drawSheetFooter(
      context as unknown as CanvasRenderingContext2D,
      { left: 0, top: 250, width: 1200, height: 150 },
      {
        title: 'The Old Rectory',
        date: '29 September 2026',
        unit: 'm',
        pxPerMetre: 40,
        orientation: 30,
        legend: [{ label: 'Porcelain paving', colour: '#b9b4aa' }],
      },
      1,
    );

    const above = context.getImageData(600, 240, 1, 1).data;
    expect([above[0], above[1], above[2]]).toEqual([255, 0, 0]);

    // The strip is painted: a corner of it is no longer the red underneath.
    const strip = context.getImageData(1190, 390, 1, 1).data;
    expect([strip[0], strip[1], strip[2]]).not.toEqual([255, 0, 0]);
  });
});
