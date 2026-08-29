'use client';

import { useEffect, useRef, useState } from 'react';
import { MousePointer2, PenLine } from 'lucide-react';
import { STATUS_COLOURS, STATUS_ORDER } from '@/lib/feature-colours';
import { FEATURE_DEFINITIONS, featureAnchor, featureArea, featureVertices } from '@/lib/features';
import { formatArea } from '@/lib/units';
import { zoneAt } from '@/lib/zones';
import { selectZones, useBoundaryStore } from '@/state/boundary-store';
import { useFeaturesStore } from '@/state/features-store';
import { FeatureIcon } from './FeatureIcon';
import { StatusPill } from './StatusPill';

/**
 * Read-mostly properties for the selected feature. Status is still set on the plan — this panel
 * reports it, and only the name is editable here, since that is the one thing there is nowhere
 * better to type.
 */
export function SelectedFeaturePanel() {
  const selectedIds = useFeaturesStore((state) => state.selectedIds);
  const features = useFeaturesStore((state) => state.present.features);
  const editingShapeId = useFeaturesStore((state) => state.editingShapeId);
  const renameFeature = useFeaturesStore((state) => state.renameFeature);
  const setSelectionStatus = useFeaturesStore((state) => state.setSelectionStatus);
  const setEditingShape = useFeaturesStore((state) => state.setEditingShape);

  const unit = useBoundaryStore((state) => state.unit);
  const boundaryDraft = useBoundaryStore((state) => state.present);

  const selection = features.filter((candidate) => selectedIds.includes(candidate.id));
  const feature = selection.length === 1 ? selection[0] : null;

  return (
    <section className="rounded-xl border border-garden-line bg-white p-4 shadow-sm">
      <h2 className="text-xs font-semibold text-garden-ink">Selected object</h2>

      {selection.length > 1 ? (
        /*
         * Width, depth and rotation mean nothing across a mixed selection, so the panel drops
         * to what does apply in bulk: how many, and what is happening to them.
         */
        <div data-testid="selected-many" className="mt-3 space-y-3">
          <p className="text-xs font-semibold text-garden-ink">
            {selection.length} features selected
          </p>

          <ul className="space-y-1">
            {STATUS_ORDER.map((status) => {
              const count = selection.filter((candidate) => candidate.status === status).length;
              if (count === 0) return null;

              return (
                <li key={status} className="flex items-center justify-between gap-2">
                  <StatusPill status={status} />
                  <span className="text-xs text-garden-muted">{count}</span>
                </li>
              );
            })}
          </ul>

          <div className="space-y-1 border-t border-garden-line pt-3">
            <p className="text-[11px] text-garden-muted">Set all to</p>
            <div className="flex flex-wrap gap-1">
              {STATUS_ORDER.map((status) => (
                <button
                  key={status}
                  type="button"
                  data-testid={`bulk-status-${status}`}
                  onClick={() => setSelectionStatus(status)}
                  style={{
                    color: STATUS_COLOURS[status].stroke,
                    borderColor: STATUS_COLOURS[status].stroke,
                  }}
                  className="rounded-full border px-2.5 py-1 text-[11px] font-medium hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
                >
                  {STATUS_COLOURS[status].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : feature ? (
        <div data-testid="selected-feature" className="mt-3 space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-garden-sage">
              <FeatureIcon kind={feature.kind} className="h-4 w-4 text-garden-forest" />
            </span>
            <NameField
              key={feature.id}
              name={feature.name}
              onCommit={(name) => renameFeature(feature.id, name)}
            />
          </div>

          <Field label="Type">
            <span className="text-sm text-garden-ink">
              {FEATURE_DEFINITIONS[feature.kind].label}
            </span>
          </Field>

          {/* Points have no footprint worth quoting, so the row is dropped rather than zeroed. */}
          {featureArea(feature) > 0 ? (
            <Field label="Area">
              <span data-testid="feature-area" className="text-sm text-garden-ink">
                {formatArea(featureArea(feature), unit)}
              </span>
            </Field>
          ) : null}

          <Field label="Zone">
            <span data-testid="feature-zone" className="text-sm text-garden-ink">
              {zoneAt(featureAnchor(feature), selectZones({ present: boundaryDraft }))?.label ??
                'Outside the garden areas'}
            </span>
          </Field>

          <Field label="Status">
            <StatusPill status={feature.status} testId="feature-status" />
          </Field>

          {feature.status === 'replace' ? (
            <Field label="Replace with">
              <span data-testid="feature-replace-with" className="text-sm text-garden-ink">
                {feature.replaceWith ?? <span className="text-garden-muted">Not set</span>}
              </span>
            </Field>
          ) : null}

          {feature.geometry.kind === 'polygon' ? (
            <Field label="Corners">
              <span data-testid="panel-corner-radius" className="text-sm text-garden-ink">
                {feature.geometry.cornerRadius === 0
                  ? 'Square'
                  : `${feature.geometry.cornerRadius.toFixed(1)} m rounded`}
              </span>
            </Field>
          ) : null}

          {feature.geometry.kind === 'rect' ? (
            <Field label="Rotation">
              <span data-testid="panel-rotation" className="text-sm text-garden-ink">
                {Math.round(feature.geometry.rotation)}°
              </span>
            </Field>
          ) : null}

          {/* The canvas popover carries the same control; this is the second way in, not the only. */}
          {featureVertices(feature) ? (
            <button
              type="button"
              data-testid="panel-edit-shape"
              aria-pressed={editingShapeId === feature.id}
              onClick={() => setEditingShape(editingShapeId === feature.id ? null : feature.id)}
              className={[
                'flex w-full items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
                editingShapeId === feature.id
                  ? 'border-garden-green bg-garden-sage text-garden-forest'
                  : 'border-garden-line text-garden-ink hover:bg-garden-sage',
              ].join(' ')}
            >
              <PenLine aria-hidden className="h-3.5 w-3.5" />
              {editingShapeId === feature.id ? 'Done editing' : 'Edit shape'}
            </button>
          ) : null}
        </div>
      ) : (
        <p
          data-testid="selected-none"
          className="mt-3 text-[11px] leading-relaxed text-garden-muted"
        >
          <MousePointer2 aria-hidden className="mr-1 inline h-3.5 w-3.5" />
          Select a feature on the plan to see its details and set what happens to it.
        </p>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-garden-muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/**
 * Same focused/unfocused split as `LengthInput`: the field resyncs from the store only while it
 * is not being typed into, so an undo elsewhere is reflected without stealing a half-typed name.
 */
function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(name);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(name);
  }, [name]);

  return (
    <input
      data-testid="feature-name"
      aria-label="Feature name"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setText(event.target.value)}
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
      className="min-w-0 flex-1 rounded-md border border-transparent px-1 py-0.5 text-xs font-semibold text-garden-ink hover:border-garden-line focus-visible:border-garden-green focus-visible:outline-none"
    />
  );
}
