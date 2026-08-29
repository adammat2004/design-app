'use client';

import type { Point } from '@garden-studio/schema';
import { COLOUR } from '@/lib/canvas-colours';
import { fitTransform, metresToPx } from '@/lib/canvas-transform';
import { housePolygon, type HouseFootprint } from '@/lib/house';
import { zoneFill } from '@/lib/zone-colours';
import type { GardenZone, ZoneId } from '@/lib/zones';
import { ZONE_ORDER } from '@/lib/zones';

/**
 * The property as step 1 left it, at postage-stamp size.
 *
 * Inline SVG rather than Konva on purpose. Konva has to come through
 * `dynamic(..., { ssr: false })` — its Node build requires the native `canvas` package and
 * breaks `next build` — which would mean a loading skeleton flashing inside a sidebar card for
 * a picture nobody clicks. SVG renders on the server, needs no loader, and works under jsdom.
 *
 * It still projects through the same helpers the two canvases use, so if the boundary editor
 * changes how a plot is derived this tile follows rather than drifting into a pretty lie.
 */

/** Fixed viewBox units; CSS scales the finished picture to whatever the card is wide. */
const VIEW = { width: 240, height: 150, padding: 14 };

/** Short forms, because the full zone labels do not fit inside a zone at this size. */
const SHORT_LABELS: Record<ZoneId, string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
};

/**
 * The pixel geometry the SVG draws, or null when step 1 has not been done.
 *
 * Pure and exported so the projection can be tested without mounting anything — the trick
 * `FeatureLabels.test.ts` uses for `layOut`, since jsdom has no canvas to measure against.
 */
export function thumbnailGeometry(
  boundary: Point[],
  house: HouseFootprint | null,
  zones: GardenZone[],
  selectedZoneIds: ZoneId[],
) {
  if (boundary.length < 3) return null;

  const transform = fitTransform(boundary, VIEW);
  const project = (ring: Point[]) =>
    ring
      .map((point) => {
        const at = metresToPx(point, transform);
        return `${at.x.toFixed(1)},${at.y.toFixed(1)}`;
      })
      .join(' ');

  return {
    outline: project(boundary),
    house: house ? project(housePolygon(house)) : null,
    houseAt: house ? metresToPx(house.centre, transform) : null,
    // Plan order rather than click order, so the tile matches the Design areas list.
    zones: ZONE_ORDER.flatMap((id) => {
      if (!selectedZoneIds.includes(id)) return [];
      const zone = zones.find((candidate) => candidate.id === id);
      if (!zone) return [];

      return [
        {
          id,
          label: SHORT_LABELS[id],
          points: project(zone.polygon),
          at: metresToPx(zone.centroid, transform),
        },
      ];
    }),
  };
}

export function PropertyThumbnail({
  boundary,
  house,
  zones,
  selectedZoneIds,
}: {
  boundary: Point[];
  house: HouseFootprint | null;
  zones: GardenZone[];
  /**
   * Pass `effectiveZoneIds(draft, zones)`, not the raw ticks — moving the house can dissolve a
   * zone whose tick stays in the draft, and this must not draw an area that no longer exists.
   */
  selectedZoneIds: ZoneId[];
}) {
  const plan = thumbnailGeometry(boundary, house, zones, selectedZoneIds);

  if (!plan) {
    return (
      <p
        data-testid="thumbnail-empty"
        className="flex h-24 items-center justify-center rounded-lg border border-dashed border-garden-line bg-white px-4 text-center text-[11px] leading-relaxed text-garden-muted"
      >
        Map your outdoor space in step 1 to see it here.
      </p>
    );
  }

  return (
    <svg
      data-testid="property-thumbnail"
      role="img"
      aria-label="Your property, with the areas you chose to redesign"
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      className="h-auto w-full rounded-lg border border-garden-line bg-white"
    >
      {/* Tints under the outline, the same order the Konva layers stack in. */}
      {plan.zones.map((zone) => (
        <polygon key={zone.id} points={zone.points} fill={zoneFill(zone.id)} />
      ))}

      <polygon
        points={plan.outline}
        fill={plan.zones.length > 0 ? 'none' : COLOUR.fill}
        stroke={COLOUR.stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {plan.house ? (
        <polygon
          points={plan.house}
          fill={COLOUR.houseFill}
          stroke={COLOUR.houseStroke}
          strokeWidth={1}
        />
      ) : null}

      {plan.zones.map((zone) => (
        <text
          key={zone.id}
          x={zone.at.x}
          y={zone.at.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={8}
          fontWeight={600}
          fill={COLOUR.handle}
          /* A halo in the card's own white, so a label over a tint stays readable without a
             background rect that would have to be measured. */
          stroke="#ffffff"
          strokeWidth={2.5}
          paintOrder="stroke"
        >
          {zone.label}
        </text>
      ))}

      {plan.houseAt ? (
        <text
          x={plan.houseAt.x}
          y={plan.houseAt.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={8}
          fontWeight={600}
          fill={COLOUR.houseInk}
        >
          House
        </text>
      ) : null}
    </svg>
  );
}
