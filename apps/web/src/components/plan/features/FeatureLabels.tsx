'use client';

import { Fragment } from 'react';
import { metresToPx, type CanvasTransform } from '@/lib/canvas-transform';
import { STATUS_COLOURS } from '@/lib/feature-colours';
import { featureAnchor, featureArea, polylineLength, type PlacedFeature } from '@/lib/features';
import { LABEL_MAX_WIDTH, stackLabels, type Stacked } from '@/lib/label-layout';
import { LabelLeader } from '../LabelLeader';
import { formatArea, formatLength, type Unit } from '@/lib/units';
import { FeatureIcon } from './FeatureIcon';
import { StatusPill } from './StatusPill';

/**
 * The name / size / status chip that hangs beside each feature.
 *
 * The stacking rule that keeps these off each other lives in `lib/label-layout.ts`, shared
 * with step 4's concept labels. The selected feature is exempt from the zoom threshold: if the
 * user has picked it, it stays readable however far out they are.
 */
export function FeatureLabels({
  features,
  selectedIds,
  detailed,
  transform,
  size,
  unit,
}: {
  features: PlacedFeature[];
  selectedIds: string[];
  /** Zoomed in far enough for text; below this everything unselected collapses to a chip. */
  detailed: boolean;
  transform: CanvasTransform;
  size: { width: number; height: number };
  unit: Unit;
}) {
  const placed = layOut(features, selectedIds, detailed, transform, size);

  return (
    <>
      {placed.map(({ feature, at, full, anchor, displaced }) =>
        full ? (
          <Fragment key={feature.id}>
            {/* A pushed label points at nothing without this. See `LabelLeader`. */}
            {displaced ? <LabelLeader anchor={anchor} at={at} /> : null}
            <span
              data-testid={`feature-label-${feature.id}`}
              style={{ left: at.x, top: at.y }}
              className="absolute -translate-x-1/2 text-center leading-tight whitespace-nowrap"
            >
              <span
                title={feature.name}
                style={{ maxWidth: LABEL_MAX_WIDTH }}
                className="block truncate text-[11px] font-semibold text-garden-ink"
              >
                {feature.name}
              </span>
              {describeSize(feature, unit) ? (
                <span className="block text-[10px] text-garden-muted">
                  {describeSize(feature, unit)}
                </span>
              ) : null}
              <StatusPill status={feature.status} size="xs" />
            </span>
          </Fragment>
        ) : (
          /*
           * Zoomed out, the name and the pill are what collide, not the shapes — so the text
           * collapses to its icon, ringed in the status colour, and the footprint underneath
           * carries on drawing at its true size.
           */
          <span
            key={feature.id}
            data-testid={`feature-chip-${feature.id}`}
            title={`${feature.name} — ${STATUS_COLOURS[feature.status].label}`}
            style={{
              left: at.x,
              top: at.y,
              borderColor: STATUS_COLOURS[feature.status].stroke,
              color: STATUS_COLOURS[feature.status].stroke,
              background: STATUS_COLOURS[feature.status].tint,
            }}
            className="absolute flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border shadow-sm"
          >
            <FeatureIcon kind={feature.kind} className="h-3 w-3" />
          </span>
        ),
      )}
    </>
  );
}

/** Area for shapes, run length for lines, nothing at all for a point. */
function describeSize(feature: PlacedFeature, unit: Unit): string | null {
  if (feature.geometry.kind === 'point') return null;

  if (feature.geometry.kind === 'polyline') {
    return `${formatLength(polylineLength(feature.geometry.points), unit)} · ${formatArea(
      featureArea(feature),
      unit,
    )}`;
  }

  return formatArea(featureArea(feature), unit);
}

/**
 * Which labels get drawn, in what form, and where — exported so the level-of-detail rules and
 * the collision pass can be tested without standing up a canvas.
 */
export function layOut(
  features: PlacedFeature[],
  selectedIds: string[],
  detailed: boolean,
  transform: CanvasTransform,
  size: { width: number; height: number },
): Stacked<{ feature: PlacedFeature; at: { x: number; y: number }; full: boolean }>[] {
  return stackLabels(
    features.map((feature) => ({
      feature,
      at: metresToPx(featureAnchor(feature), transform),
      // Picking something out is an explicit request to see it, whatever the zoom.
      full: detailed || selectedIds.includes(feature.id),
    })),
    size,
  );
}
