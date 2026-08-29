import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Point } from '@garden-studio/schema';
import { rectangleHouse } from '@/lib/house';
import { computeZones } from '@/lib/zones';
import { PropertyThumbnail } from './PropertyThumbnail';

/**
 * Unlike the two Konva canvases, this one renders under jsdom — it is plain SVG, and never
 * touches a 2D context. That is what makes it worth asserting that the picture is derived
 * from step 1's real geometry rather than drawn by hand.
 */

const PLOT: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

const HOUSE = rectangleHouse({ x: 10, y: 8 }, 8, 6);
const ZONES = computeZones(PLOT, HOUSE);

describe('PropertyThumbnail', () => {
  it('asks for step 1 when there is no plot', () => {
    render(<PropertyThumbnail boundary={[]} house={null} zones={[]} selectedZoneIds={[]} />);

    expect(screen.getByTestId('thumbnail-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('property-thumbnail')).not.toBeInTheDocument();
  });

  it('draws the plot, the house and the chosen areas', () => {
    render(
      <PropertyThumbnail
        boundary={PLOT}
        house={HOUSE}
        zones={ZONES}
        selectedZoneIds={['front', 'back']}
      />,
    );

    const svg = screen.getByTestId('property-thumbnail');
    expect(svg).toBeInTheDocument();
    expect(screen.getByText('House')).toBeInTheDocument();
    expect(screen.getByText('Front')).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
    // Not selected, so not tinted and not labelled.
    expect(screen.queryByText('Left')).not.toBeInTheDocument();

    // Boundary + two zone tints + house.
    expect(svg.querySelectorAll('polygon')).toHaveLength(4);
  });

  it('follows the plot rather than drawing a fixed illustration', () => {
    const { rerender } = render(
      <PropertyThumbnail boundary={PLOT} house={null} zones={[]} selectedZoneIds={[]} />,
    );

    const square = screen
      .getByTestId('property-thumbnail')
      .querySelector('polygon')
      ?.getAttribute('points');

    const narrow: Point[] = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 24 },
      { x: 0, y: 24 },
    ];

    rerender(<PropertyThumbnail boundary={narrow} house={null} zones={[]} selectedZoneIds={[]} />);

    const strip = screen
      .getByTestId('property-thumbnail')
      .querySelector('polygon')
      ?.getAttribute('points');

    expect(strip).not.toBe(square);
  });

  it('omits the house label until step 1 places one', () => {
    render(<PropertyThumbnail boundary={PLOT} house={null} zones={[]} selectedZoneIds={[]} />);

    expect(screen.queryByText('House')).not.toBeInTheDocument();
  });
});
