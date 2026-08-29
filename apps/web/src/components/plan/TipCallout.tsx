'use client';

import { Lightbulb } from 'lucide-react';
import { useBoundaryStore } from '@/state/boundary-store';

export function TipCallout() {
  const mode = useBoundaryStore((state) => state.mode);
  const houseTool = useBoundaryStore((state) => state.houseTool);
  const boundaryTool = useBoundaryStore((state) => state.boundaryTool);
  const closed = useBoundaryStore((state) => state.present.closed);
  const hasHouse = useBoundaryStore((state) => state.present.house !== null);
  const corners = useBoundaryStore((state) => state.present.vertices.length);

  const tip = chooseTip({ mode, houseTool, boundaryTool, closed, hasHouse, corners });

  return (
    <section
      data-testid="tip-callout"
      className="rounded-xl border border-garden-line bg-garden-sage/50 p-3"
    >
      <div className="flex items-start gap-2.5">
        <Lightbulb aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />
        <div>
          <p className="text-[11px] leading-relaxed text-garden-muted">
            <span className="font-semibold text-garden-ink">Tip: </span>
            {tip}
          </p>
          <a
            href="/help/mapping"
            data-testid="tip-learn-more"
            className="mt-1.5 inline-block text-[11px] font-medium text-garden-green underline underline-offset-2 hover:text-garden-forest"
          >
            Learn more
          </a>
        </div>
      </div>
    </section>
  );
}

function chooseTip({
  mode,
  houseTool,
  boundaryTool,
  closed,
  hasHouse,
  corners,
}: {
  mode: string;
  houseTool: string;
  boundaryTool: string;
  closed: boolean;
  hasHouse: boolean;
  corners: number;
}): string {
  if (mode === 'house') {
    if (!hasHouse) {
      return houseTool === 'custom'
        ? 'Click each corner of the house, then close the outline. Follow the walls, not the guttering.'
        : 'Drag out a rectangle roughly where the house sits. You can adjust it afterwards.';
    }

    if (houseTool === 'rotate') {
      return 'Rotating the house rotates the garden areas with it — the front garden always stays in front.';
    }

    return 'Position the house where it sits on your site. The front, back and side gardens are worked out from it.';
  }

  if (corners === 0) return 'Start at any corner and work your way round in one direction.';
  if (!closed) {
    return corners >= 3
      ? 'Click back on point A, or use Close boundary, to finish the outline.'
      : 'Place a point at every corner, including shallow ones.';
  }
  if (boundaryTool === 'add-point') {
    return 'Click a side to add a corner part way along it. Everything after it is relettered.';
  }

  return 'Type a measured length beside any side and the connected corner moves to match.';
}
