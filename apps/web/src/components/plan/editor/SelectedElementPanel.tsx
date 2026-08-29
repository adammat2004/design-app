'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Lock, MousePointer2, Palette, Trash2 } from 'lucide-react';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementArea, isLocked, type DesignElement } from '@/lib/concepts';
import { materialsFor } from '@/lib/materials';
import { formatArea } from '@/lib/units';
import { ZONE_ORDER } from '@/lib/zones';
import { useBoundaryStore } from '@/state/boundary-store';
import { selectedElement, usePlanEditorStore } from '@/state/plan-editor-store';
import { LengthInput } from '../SideLengthsPanel';
import { ElementThumbnail } from './ElementThumbnail';

/** Zone labels, matching `computeZones` without needing a live zone list to read them from. */
const ZONE_LABELS: Record<(typeof ZONE_ORDER)[number], string> = {
  front: 'Front garden',
  back: 'Back garden',
  left: 'Left side',
  right: 'Right side',
};

/**
 * Everything about the one element that is selected, and the only place some of it can be
 * changed.
 *
 * Dimensions are two-way bound: dragging a handle updates the fields, typing in a field moves the
 * shape. Both go through the same `resizeElementLive`, so neither can produce a size the other
 * would have refused.
 *
 * A locked base fill still gets the full panel — hiding it would leave the user unable to see the
 * ground layer's area or change its material. The controls it cannot accept are disabled with the
 * reason spelled out, rather than silently inert.
 */
export function SelectedElementPanel() {
  const element = usePlanEditorStore(selectedElement);
  const unit = useBoundaryStore((state) => state.unit);

  return (
    <section
      data-testid="selected-element"
      className="rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <h2 className="text-xs font-semibold text-garden-ink">Selected feature</h2>

      {element ? (
        <ElementDetails key={element.id} element={element} unit={unit} />
      ) : (
        <p
          data-testid="selected-none"
          className="mt-3 text-[11px] leading-relaxed text-garden-muted"
        >
          <MousePointer2 aria-hidden className="mr-1 inline h-3.5 w-3.5" />
          Select a feature on the plan to see its details and change it.
        </p>
      )}
    </section>
  );
}

function ElementDetails({
  element,
  unit,
}: {
  element: DesignElement;
  unit: Parameters<typeof formatArea>[1];
}) {
  const store = usePlanEditorStore;
  const locked = isLocked(element);
  const rect = element.shape.kind === 'rect' ? element.shape : null;
  const materialRef = useRef<HTMLSelectElement>(null);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-start gap-2.5">
        <ElementThumbnail element={element} />

        <div className="min-w-0 flex-1">
          <NameField
            name={element.name ?? CATEGORY_COLOURS[element.category].label}
            onCommit={(name) => store.getState().renameElement(element.id, name)}
          />

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              data-testid="element-category"
              style={{
                background: CATEGORY_COLOURS[element.category].fill,
                borderColor: CATEGORY_COLOURS[element.category].stroke,
              }}
              className="inline-flex items-center rounded-full border px-1.5 py-px text-[9px] font-semibold text-garden-ink"
            >
              {CATEGORY_COLOURS[element.category].label}
            </span>
            {locked ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-garden-line px-1.5 py-px text-[9px] font-medium text-garden-muted">
                <Lock aria-hidden className="h-2.5 w-2.5" />
                Ground layer
              </span>
            ) : null}
          </div>

          <p
            data-testid="element-id"
            className="mt-1 truncate font-mono text-[10px] text-garden-muted"
          >
            {element.id}
          </p>
        </div>
      </div>

      {locked ? (
        <p
          data-testid="locked-reason"
          className="rounded-lg border border-dashed border-garden-line bg-garden-sage/40 px-2.5 py-2 text-[10px] leading-relaxed text-garden-muted"
        >
          This is the ground layer for its zone. It keeps the garden fully covered, so its shape is
          fixed — but you can change what it is made of.
        </p>
      ) : null}

      <Field label="Area">
        <span data-testid="element-area" className="block py-1 text-right text-sm text-garden-ink">
          {formatArea(elementArea(element), unit)}
        </span>
      </Field>

      {rect ? (
        <>
          <Field label="Width">
            <LengthInput
              testId="element-width"
              label="Element width"
              metres={rect.width}
              unit={unit}
              onCommit={(width) => {
                store.getState().beginGesture();
                store.getState().resizeElementLive(element.id, { width });
                store.getState().endGesture();
              }}
            />
          </Field>

          <Field label="Depth">
            <LengthInput
              testId="element-depth"
              label="Element depth"
              metres={rect.depth}
              unit={unit}
              onCommit={(depth) => {
                store.getState().beginGesture();
                store.getState().resizeElementLive(element.id, { depth });
                store.getState().endGesture();
              }}
            />
          </Field>
        </>
      ) : (
        <p className="text-[10px] leading-relaxed text-garden-muted">
          Free-form shapes are resized on the plan by dragging their corners.
        </p>
      )}

      <Field label="Material">
        <select
          ref={materialRef}
          data-testid="element-material"
          aria-label="Material"
          value={element.material ?? ''}
          onChange={(event) => store.getState().setMaterial(element.id, event.target.value)}
          className="w-full min-w-0 rounded-md border border-garden-line bg-white px-2 py-1 text-sm text-garden-ink focus-visible:border-garden-green focus-visible:outline-none"
        >
          {materialsFor(element.category).map((material) => (
            <option key={material.id} value={material.id}>
              {material.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Zone">
        <select
          data-testid="element-zone"
          aria-label="Zone"
          value={element.zone}
          disabled={locked}
          onChange={(event) =>
            store.getState().setZone(element.id, event.target.value as (typeof ZONE_ORDER)[number])
          }
          className="w-full min-w-0 rounded-md border border-garden-line bg-white px-2 py-1 text-sm text-garden-ink focus-visible:border-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ZONE_ORDER.map((zone) => (
            <option key={zone} value={zone}>
              {ZONE_LABELS[zone]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Elevation">
        <LengthInput
          testId="element-elevation"
          label="Elevation above grade"
          metres={element.elevation ?? 0}
          unit={unit}
          allowNegative
          onCommit={(metres) => store.getState().setElevation(element.id, metres)}
        />
      </Field>

      <div className="space-y-2 border-t border-garden-line pt-3">
        <button
          type="button"
          data-testid="change-material"
          onClick={() => {
            materialRef.current?.focus();
            // Chromium only; a no-op elsewhere, which is why focus is called first.
            materialRef.current?.showPicker?.();
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-garden-line px-3 py-1.5 text-xs font-medium text-garden-ink hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
        >
          <Palette aria-hidden className="h-3.5 w-3.5" />
          Change material
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            data-testid="duplicate-element"
            disabled={locked}
            title={locked ? 'The ground layer cannot be duplicated.' : undefined}
            onClick={() => store.getState().duplicateElement(element.id)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-garden-line px-3 py-1.5 text-xs font-medium text-garden-ink hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Copy aria-hidden className="h-3.5 w-3.5" />
            Duplicate
          </button>

          <button
            type="button"
            data-testid="delete-element"
            disabled={locked}
            title={locked ? 'The ground layer cannot be deleted.' : undefined}
            onClick={() => store.getState().deleteElement(element.id)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/** Label left, control right in a fixed column — `SelectedObjectPanel`'s row, verbatim. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-garden-muted">{label}</span>
      <span className="w-32">{children}</span>
    </label>
  );
}

/**
 * Inline-editable title. Same focused-ref resync as step 2's rename field: while the user is
 * typing the store must not overwrite the draft, and an empty name reverts rather than committing.
 */
function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(name);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(name);
  }, [name]);

  return (
    <input
      data-testid="element-name"
      aria-label="Feature name"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (text.trim() === '') setText(name);
        else onCommit(text);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setText(name);
          event.currentTarget.blur();
        }
      }}
      className="w-full min-w-0 rounded-md border border-transparent px-1 py-0.5 text-xs font-semibold text-garden-ink hover:border-garden-line focus-visible:border-garden-green focus-visible:outline-none"
    />
  );
}
