import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DesignElement } from '@garden-studio/schema';
import { ScheduleTable } from './ScheduleTable';

/** A square of a given area, so the numbers can be reasoned about in whole metres. */
function surface(area: number, material: string, over: Partial<DesignElement> = {}): DesignElement {
  const side = Math.sqrt(area);

  return {
    id: `${material}-${over.fillKind ?? 'x'}`,
    category: 'paved-area',
    role: 'fill',
    fillKind: 'accent',
    shape: { kind: 'rect', centre: { x: 0, y: 0 }, width: side, depth: side, rotation: 0 },
    zone: 'back',
    material,
    ...over,
  };
}

describe('ScheduleTable', () => {
  it('says so plainly when there is nothing to list', () => {
    render(<ScheduleTable elements={[]} unit="m" />);

    expect(screen.getByTestId('schedule-empty')).toBeInTheDocument();
  });

  it('separates the ground from what is laid over it', () => {
    /*
     * The reason this grouping exists: these two areas overlap. A base fill is the whole zone and
     * the terrace sits on top of it, so a flat list inviting the reader to add 135 and 40 would
     * describe a garden bigger than the plot.
     */
    render(
      <ScheduleTable
        elements={[
          surface(135, 'standard-turf', { fillKind: 'base', category: 'lawn' }),
          surface(40, 'stone-pavers'),
        ]}
        unit="m"
      />,
    );

    expect(screen.getByText('Ground cover')).toBeInTheDocument();
    expect(screen.getByText('Laid over it')).toBeInTheDocument();
  });

  it('counts slabs but refuses to count plants', () => {
    render(
      <ScheduleTable
        elements={[
          surface(50, 'stone-pavers'),
          surface(30, 'shrubs', { category: 'planting-bed' }),
        ]}
        unit="m"
      />,
    );

    // Paving is a real product with quoted dimensions, so a count is honest.
    expect(
      within(screen.getByTestId('schedule-stone-pavers')).getByText(/slabs/),
    ).toBeInTheDocument();
    // Planting is drawn at a density chosen to read well; a count would be a shopping list.
    expect(within(screen.getByTestId('schedule-shrubs')).getByText('—')).toBeInTheDocument();
  });
});
