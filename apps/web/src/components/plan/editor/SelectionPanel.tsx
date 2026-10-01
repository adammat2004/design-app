'use client';

import { Copy, Lock, LockOpen, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { elementArea, isGroundLayer, isUserLocked } from '@garden-studio/schema';
import { elementLabel } from '@/lib/concept-colours';
import { materialsFor } from '@/lib/materials';
import { formatArea } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { Caption, Pill } from './Pill';

/**
 * The inspector when several things are selected: what is in the selection, and the edits that mean
 * the same thing for all of them.
 *
 * Only those. A material is offered when every one is the same kind of thing — three beds can all
 * become a shade border, a bed and a bench cannot share a material — and a lock, a copy and a delete
 * are one gesture and one undo entry for the whole group. Sizes, rotations and edges stay per element:
 * "make these 3 m wide" has no single honest answer, and asking the designer is the way to say it.
 */
export function SelectionPanel() {
  const ids = usePlanEditorStore((state) => state.selectedIds);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const unit = useBoundaryStore((state) => state.unit);
  const store = usePlanEditorStore.getState;

  const selected = useMemo(() => elements.filter((element) => ids.includes(element.id)), [elements, ids]);
  if (selected.length === 0) return null;

  const category = selected[0]!.category;
  const shared = selected.every((element) => element.category === category);
  const material = shared && selected.every((element) => element.material === selected[0]!.material)
    ? (selected[0]!.material ?? '')
    : '';
  const area = selected.reduce((sum, element) => sum + elementArea(element), 0);
  const lockable = selected.filter((element) => !isGroundLayer(element));
  const allLocked = lockable.length > 0 && lockable.every(isUserLocked);

  return (
    <div data-testid="selection-panel" className="space-y-4 px-4 py-3">
      <p className="text-xs text-garden-muted">
        <span className="tabular-nums" data-testid="selection-area">
          {formatArea(area, unit)}
        </span>{' '}
        between them.
      </p>

      {shared ? (
        <label className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] text-garden-muted">Material</span>
          <select
            data-testid="selection-material"
            aria-label="Material for all selected"
            value={material}
            onChange={(event) => store().setMaterialForSelection(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-garden-line bg-white px-2 py-1 text-xs text-garden-ink focus-visible:border-garden-green focus-visible:outline-none"
          >
            {material === '' ? <option value="">Mixed</option> : null}
            {materialsFor(category).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[11px] leading-relaxed text-garden-muted">
          A material is shared only by things of one kind. Select just the beds, or just the paving, to
          change them together.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {lockable.length > 0 ? (
          <Pill
            testId="selection-lock"
            icon={allLocked ? <LockOpen aria-hidden className="h-3.5 w-3.5" /> : <Lock aria-hidden className="h-3.5 w-3.5" />}
            onClick={() => store().toggleLocked(ids)}
          >
            {allLocked ? 'Unlock all' : 'Lock all'}
          </Pill>
        ) : null}
        <Pill testId="selection-duplicate" icon={<Copy aria-hidden className="h-3.5 w-3.5" />} onClick={() => store().duplicateSelection()}>
          Duplicate
        </Pill>
        <Pill
          testId="selection-delete"
          tone="danger"
          icon={<Trash2 aria-hidden className="h-3.5 w-3.5" />}
          onClick={() => store().deleteSelection()}
        >
          Delete
        </Pill>
      </div>

      <div>
        <Caption>In the selection</Caption>
        <ul className="mt-1 space-y-0.5">
          {selected.map((element) => (
            <li key={element.id} className="flex items-center gap-2 text-xs text-garden-ink">
              <span className="min-w-0 flex-1 truncate">{elementLabel(element)}</span>
              {isUserLocked(element) ? <Lock aria-label="Locked" className="h-3 w-3 text-garden-muted" /> : null}
              <button
                type="button"
                data-testid={`selection-remove-${element.id}`}
                onClick={() => store().select(element.id, { additive: true })}
                className="rounded px-1 text-[11px] text-garden-muted hover:bg-garden-sage hover:text-garden-ink"
                aria-label={`Take ${elementLabel(element)} out of the selection`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
