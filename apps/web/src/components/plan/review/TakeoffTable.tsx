'use client';

import { Fragment } from 'react';
import {
  housePolygon,
  planTakeoff,
  type DesignElement,
  type HouseFootprint,
  type SiteForBoundaries,
  type TakeoffGroup,
  type TakeoffLine,
} from '@garden-studio/schema';
import { formatArea, formatLength, type Unit } from '@/lib/units';

const GROUP_HEADINGS: Record<TakeoffGroup, string> = {
  planting: 'Plants to order',
  enclosure: 'New fences, walls and screens',
  boundary: 'Boundaries, as mapped',
  levels: 'Changes of level',
  lighting: 'Light fittings',
};

/**
 * The plan's lengths and counts, beside the schedule's areas: which plants to order and how many,
 * how long the fences are, how much retaining wall a raised terrace needs, how many steps and how
 * many of each light fitting.
 *
 * Every row comes from `planTakeoff`, which reads the same resolvers the drawing uses. A group with
 * nothing in it is left out rather than shown empty — "Changes of level: none" on a flat garden is
 * a line about the tool.
 */
export function TakeoffTable({
  elements,
  site,
  house,
  unit,
}: {
  elements: DesignElement[];
  site: SiteForBoundaries;
  house: HouseFootprint | null;
  unit: Unit;
}) {
  const lines = planTakeoff({
    elements,
    site,
    ...(house ? { house: housePolygon(house) } : {}),
  });
  if (lines.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table data-testid="takeoff" className="w-full border-collapse text-left">
        <tbody>
          {lines.map((line, index) => (
            <Fragment key={`${line.group}-${line.label}-${line.detail ?? ''}`}>
              {lines[index - 1]?.group !== line.group ? (
                <tr>
                  <td colSpan={2} className={index === 0 ? 'pb-1' : 'pt-3 pb-1'}>
                    <span className="text-[10px] font-semibold tracking-wide text-garden-muted uppercase">
                      {GROUP_HEADINGS[line.group]}
                    </span>
                  </td>
                </tr>
              ) : null}
              <TakeoffRow line={line} unit={unit} />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TakeoffRow({ line, unit }: { line: TakeoffLine; unit: Unit }) {
  const quantity =
    line.lengthM !== null
      ? formatLength(line.lengthM, unit)
      : line.count !== null
        ? line.label === 'Steps'
          ? `${line.count} ${line.count === 1 ? 'riser' : 'risers'}`
          : line.group === 'planting'
            ? line.count.toLocaleString('en-GB')
            : `${line.count} ${line.count === 1 ? 'item' : 'items'}`
        : '—';

  return (
    <tr
      data-testid={`takeoff-${line.group}`}
      className="border-b border-garden-line/60 last:border-0"
    >
      <td className="py-1.5 pr-3">
        <span className="block text-xs font-medium text-garden-ink">{line.label}</span>
        {line.detail || line.areaSqm !== null ? (
          <span className="block text-[10px] text-garden-muted">
            {[line.detail, line.areaSqm !== null ? `${formatArea(line.areaSqm, unit)} of face` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}
      </td>
      <td className="py-1.5 text-right text-xs whitespace-nowrap text-garden-ink">{quantity}</td>
    </tr>
  );
}
