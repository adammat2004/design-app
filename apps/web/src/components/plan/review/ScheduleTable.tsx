'use client';

import { Fragment } from 'react';
import { planSchedule, type DesignElement, type ScheduleLine } from '@garden-studio/schema';
import { formatArea, type Unit } from '@/lib/units';

/**
 * What the garden is made of, counted.
 *
 * Every number here falls out of geometry the validator already checked — nothing on this screen
 * measures anything. That is the whole argument for the plan being real polygons rather than a
 * generated picture, and this table is the first place in the app where the argument pays.
 *
 * **Units appear only where a count is honest.** Paving and decking are modular products with real
 * quoted dimensions, so slabs and boards can be counted. Planting cannot: `material-patterns.ts`
 * says plainly that scatter densities are *drawn* densities, chosen so a bed reads as planting at a
 * glance, and a border really planted at one would close up in a season. So a bed gets its area and
 * a dash, and the dash is the honest answer rather than a gap in the work.
 */
export function ScheduleTable({ elements, unit }: { elements: DesignElement[]; unit: Unit }) {
  const lines = planSchedule(elements);

  if (lines.length === 0) {
    return (
      <p data-testid="schedule-empty" className="text-xs text-garden-muted">
        Nothing placed yet. Generate a concept on step 4 and the materials will be listed here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table data-testid="schedule" className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-garden-line">
            <Th>Material</Th>
            <Th align="right">Area</Th>
            <Th align="right">Quantity</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <Fragment key={line.materialId}>
              {/*
                A heading at the seam rather than two tables, so the columns stay aligned and the
                stacking is readable in one pass: ground first, then what is laid over it.
              */}
              {line.layer === 'over' && lines[index - 1]?.layer !== 'over' ? (
                <tr>
                  <td colSpan={3} className="pt-3 pb-1">
                    <span className="text-[10px] font-semibold tracking-wide text-garden-muted uppercase">
                      Laid over it
                    </span>
                  </td>
                </tr>
              ) : null}
              {index === 0 && line.layer === 'ground' ? (
                <tr>
                  <td colSpan={3} className="pb-1">
                    <span className="text-[10px] font-semibold tracking-wide text-garden-muted uppercase">
                      Ground cover
                    </span>
                  </td>
                </tr>
              ) : null}
              <ScheduleRow line={line} unit={unit} />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleRow({ line, unit }: { line: ScheduleLine; unit: Unit }) {
  return (
    <tr
      data-testid={`schedule-${line.materialId}`}
      className="border-b border-garden-line/60 last:border-0"
    >
      <td className="py-1.5 pr-3">
        <span className="block text-xs font-medium text-garden-ink">{line.label}</span>
        <span className="block text-[10px] text-garden-muted">
          {line.elementCount === 1 ? '1 area' : `${line.elementCount} areas`}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-right text-xs whitespace-nowrap text-garden-ink">
        {line.areaSqm > 0 ? formatArea(line.areaSqm, unit) : '\u2014'}
      </td>
      <td className="py-1.5 text-right text-xs whitespace-nowrap text-garden-muted">
        {line.units === null ? (
          <span title="Planting is drawn at a density chosen to read well, not to be ordered from">
            {'\u2014'}
          </span>
        ) : (
          `${line.units.toLocaleString('en-GB')} ${line.unitLabel}`
        )}
      </td>
    </tr>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`pb-1.5 text-[10px] font-semibold tracking-wide text-garden-muted uppercase ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}
