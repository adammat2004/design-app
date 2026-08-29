'use client';

import type { Point } from '@garden-studio/schema';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { describeElement, elementAnchor, type DesignElement } from '@/lib/concepts';
import { stackLabels } from '@/lib/label-layout';
import { formatArea, type Unit } from '@/lib/units';
import type { GardenZone } from '@/lib/zones';

/**
 * Everything written on top of a generated plan: the name / size chip beside each feature, and
 * the name of each garden zone underneath them.
 *
 * **Only `role: 'feature'` elements get a chip.** Fill regions are ground cover, and labelling
 * every patch of lawn would bury the things the brief actually asked for under the background.
 * That distinction is the whole reason `role` exists on the element.
 *
 * Zone names go through the *same* collision pass rather than being drawn separately. Drawing
 * them independently is what let "Water feature" land exactly on top of "Front garden": two
 * label systems, each certain it had the space to itself. One pass over both is the only way
 * either can know about the other.
 */
export function ConceptLabels({
  elements,
  zones = [],
  detailed,
  transform,
  size,
  unit,
}: {
  elements: DesignElement[];
  /**
   * Omitted by the editor, on purpose.
   *
   * Zones are scaffolding — derived from the boundary and the house so the wizard can ask which
   * parts of the garden to design. That question is worth writing on the screens that ask it, and
   * step 4's comparison, where the reader is orienting themselves. By step 5 it has been answered,
   * and "Back garden ≈ 18 m²" across a finished design is a note about the tool rather than about
   * the garden. Leaving them out also frees the collision pass below to give the feature chips the
   * room they actually need.
   */
  zones?: GardenZone[];
  /** Zoomed in far enough for text. Below this the plan reads as colour alone. */
  detailed: boolean;
  transform: CanvasTransform;
  size: { width: number; height: number };
  unit: Unit;
}) {
  if (!detailed) return null;

  return (
    <>
      {layOutConceptLabels(elements, zones, transform, size).map((entry) =>
        entry.kind === 'element' ? (
          <span
            key={entry.element.id}
            data-testid={`element-label-${entry.element.id}`}
            style={{ left: entry.at.x, top: entry.at.y }}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-garden-line bg-white/90 px-1.5 py-0.5 text-center leading-tight whitespace-nowrap shadow-sm"
          >
            <span className="block text-[11px] font-semibold text-garden-ink">
              {entry.element.name}
            </span>
            {describeElement(entry.element, unit) ? (
              <span className="block text-[10px] text-garden-muted">
                {describeElement(entry.element, unit)}
              </span>
            ) : null}
          </span>
        ) : (
          <span
            key={entry.zone.id}
            data-testid={`zone-label-${entry.zone.id}`}
            style={{
              left: entry.at.x,
              top: entry.at.y,
              // A halo in the plan's own white, so a name over planting stays readable without
              // a background chip that would compete with the feature labels above it.
              textShadow: '0 0 4px #fff, 0 0 4px #fff, 0 0 4px #fff',
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center leading-tight whitespace-nowrap"
          >
            <span className="block text-[13px] font-semibold text-garden-forest">
              {entry.zone.label}
            </span>
            <span className="block text-[11px] text-garden-muted">
              ≈ {formatArea(entry.zone.area, unit)}
            </span>
          </span>
        ),
      )}
    </>
  );
}

type LabelEntry =
  | { kind: 'element'; element: DesignElement; at: Point; full: boolean }
  | { kind: 'zone'; zone: GardenZone; at: Point; full: boolean };

/**
 * Which labels get drawn and where — exported so the filtering and the collision pass can be
 * checked without standing up a canvas, the trick `FeatureLabels.test.ts` uses for `layOut`.
 *
 * Zones are laid out first so that when a zone name and a feature chip want the same spot, the
 * chip is the one that moves. The feature is the thing the user asked for; the zone name is
 * context, and context should not shove content around.
 */
export function layOutConceptLabels(
  elements: DesignElement[],
  zones: GardenZone[],
  transform: CanvasTransform,
  size: { width: number; height: number },
): LabelEntry[] {
  const zoneLabels: LabelEntry[] = zones.map((zone) => ({
    kind: 'zone' as const,
    zone,
    at: metresToPx(zone.centroid, transform),
    full: true,
  }));

  const elementLabels: LabelEntry[] = elements
    .filter((element) => element.role === 'feature' && element.name)
    .map((element) => ({
      kind: 'element' as const,
      element,
      at: metresToPx(elementAnchor(element), transform),
      full: true,
    }));

  return stackLabels([...zoneLabels, ...elementLabels], size);
}

/** The dot the legend and the compare pane headers use, one per category. */
export function CategorySwatch({
  category,
  className = 'h-3 w-5',
}: {
  category: DesignElement['category'];
  className?: string;
}) {
  const style = CATEGORY_COLOURS[category];

  return (
    <span
      aria-hidden
      style={{ background: style.fill, borderColor: style.stroke }}
      className={`shrink-0 rounded-sm border ${className}`}
    />
  );
}
