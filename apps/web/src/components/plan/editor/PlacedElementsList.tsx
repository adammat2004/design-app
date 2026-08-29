'use client';

import { Eye, EyeOff, Lock } from 'lucide-react';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementArea, isLocked, type DesignElement } from '@/lib/concepts';
import { groupElements } from '@/lib/element-groups';
import { formatArea } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { EditorIcon } from './EditorIcon';

/**
 * Everything on the plan, grouped into hardscape / softscape / features.
 *
 * Two-way bound with the canvas the way step 2's `PlacedFeatureList` is: clicking a row selects
 * on the plan, and selecting on the plan highlights the row. Hidden elements stay listed —
 * the eye toggle means "not shown", not "gone", and a row that disappeared when you hid it would
 * leave no way to bring it back.
 */
export function PlacedElementsList() {
  const elements = usePlanEditorStore((state) => state.present.elements);
  const selectedId = usePlanEditorStore((state) => state.selectedId);
  const unit = useBoundaryStore((state) => state.unit);

  const groups = groupElements(elements);

  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Placed elements ({elements.length})</h2>

      {elements.length === 0 ? (
        <p
          data-testid="placed-elements-empty"
          className="mt-2 text-[11px] leading-relaxed text-garden-muted"
        >
          Nothing on the plan yet. Add a surface from the palette above.
        </p>
      ) : null}

      <div data-testid="placed-elements" className="mt-2 space-y-3">
        {groups.map((group) => (
          <div key={group.group}>
            <p className="text-[10px] font-semibold tracking-wide text-garden-muted uppercase">
              {group.label}
            </p>

            <ul className="mt-1 space-y-1">
              {group.elements.map((element) => (
                <ElementRow
                  key={element.id}
                  element={element}
                  selected={element.id === selectedId}
                  unit={unit}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Short zone names — the full labels are too long for a row this narrow. */
const SHORT_ZONE: Record<DesignElement['zone'], string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
};

/**
 * What to call a row.
 *
 * Fills carry no name — labelling every patch of ground on the plan would bury the features.
 * In a list, though, three rows all reading "Lawn" is useless, so the zone is appended to tell
 * one zone's ground apart from the next.
 */
function rowLabel(element: DesignElement): string {
  if (element.name) return element.name;

  const category = CATEGORY_COLOURS[element.category].label;
  return element.role === 'fill' ? `${category} · ${SHORT_ZONE[element.zone]}` : category;
}

function ElementRow({
  element,
  selected,
  unit,
}: {
  element: DesignElement;
  selected: boolean;
  unit: Parameters<typeof formatArea>[1];
}) {
  const select = usePlanEditorStore((state) => state.select);
  const toggleHidden = usePlanEditorStore((state) => state.toggleHidden);

  const area = elementArea(element);
  const locked = isLocked(element);

  return (
    <li
      data-testid={`placed-element-${element.id}`}
      data-selected={selected}
      className={[
        'flex items-center gap-1.5 rounded-lg border pr-1 transition-colors',
        selected
          ? 'border-garden-green bg-garden-sage/60'
          : 'border-transparent hover:bg-garden-sage/40',
      ].join(' ')}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => select(element.id)}
        className={[
          'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left',
          'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
          element.hidden ? 'opacity-45' : '',
        ].join(' ')}
      >
        <EditorIcon category={element.category} className="h-4 w-4 shrink-0 text-garden-muted" />
        <span className="min-w-0 flex-1 truncate text-xs text-garden-ink">{rowLabel(element)}</span>
        {area > 0 ? (
          <span className="shrink-0 text-[10px] text-garden-muted tabular-nums">
            {formatArea(area, unit)}
          </span>
        ) : null}
        {locked ? (
          <Lock
            aria-label="Ground layer — material only"
            className="h-3 w-3 shrink-0 text-garden-muted"
          />
        ) : null}
      </button>

      <button
        type="button"
        data-testid={`toggle-visible-${element.id}`}
        aria-pressed={!element.hidden}
        aria-label={element.hidden ? `Show ${rowLabel(element)}` : `Hide ${rowLabel(element)}`}
        title={element.hidden ? 'Show on the plan' : 'Hide from the plan'}
        onClick={() => toggleHidden(element.id)}
        className="shrink-0 rounded-md p-1 text-garden-muted hover:bg-garden-sage hover:text-garden-forest focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
      >
        {element.hidden ? (
          <EyeOff aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <Eye aria-hidden className="h-3.5 w-3.5" />
        )}
      </button>
    </li>
  );
}
