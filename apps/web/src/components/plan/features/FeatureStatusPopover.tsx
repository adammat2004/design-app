'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, PenLine, Replace, Trash2 } from 'lucide-react';
import { STATUS_COLOURS, STATUS_ORDER } from '@/lib/feature-colours';
import { MAX_CORNER_RADIUS, type FeatureStatus, type PlacedFeature } from '@/lib/features';
import { useFeaturesStore } from '@/state/features-store';

const ICONS = { keep: Check, remove: Trash2, replace: Replace };

/** A short list beats free text for the common swaps, but the field stays typeable. */
const REPLACEMENT_SUGGESTIONS = ['Deck', 'Pergola', 'Lawn', 'Planting bed', 'Paving'];

/** The angles anyone actually uses, in 45 degree steps. Same set as the house's field. */
const ROTATION_PRESETS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The primary way a placed feature is changed: controls floating on the plan beside the thing
 * they describe. Deciding about a patio while looking at the patio is the whole point of the
 * screen, so status, rotation, corner rounding and reshaping all live here rather than only in
 * the right panel.
 *
 * Rendered as HTML in the overlay rather than in Konva — it needs text inputs, sliders and focus,
 * and the same Tailwind tokens as the rest of the wizard.
 */
export function FeatureStatusPopover({
  selection,
  editing,
  at,
  bounds,
}: {
  selection: PlacedFeature[];
  editing: boolean;
  at: { x: number; y: number };
  bounds: { width: number; height: number };
}) {
  const setStatus = useFeaturesStore((state) => state.setStatus);
  const setSelectionStatus = useFeaturesStore((state) => state.setSelectionStatus);
  const setReplaceWith = useFeaturesStore((state) => state.setReplaceWith);
  const setCornerRadius = useFeaturesStore((state) => state.setCornerRadius);
  const rotateFeatureLive = useFeaturesStore((state) => state.rotateFeatureLive);
  const setEditingShape = useFeaturesStore((state) => state.setEditingShape);
  const beginGesture = useFeaturesStore((state) => state.beginGesture);
  const endGesture = useFeaturesStore((state) => state.endGesture);

  if (selection.length === 0) return null;

  const single = selection.length === 1 ? selection[0] : null;
  const geometry = single?.geometry;

  // Keep the card on the canvas: near an edge it slides back in rather than hanging off.
  const halfCard = 150;
  const left = Math.min(
    Math.max(at.x, halfCard + 8),
    Math.max(bounds.width - halfCard - 8, halfCard + 8),
  );
  const top = Math.min(Math.max(at.y + 28, 8), Math.max(bounds.height - 90, 8));

  /** Every status in the selection agrees, so the button can show as active. */
  const sharedStatus = selection.every((feature) => feature.status === selection[0].status)
    ? selection[0].status
    : null;

  return (
    <div
      data-testid="status-popover"
      style={{ left, top }}
      className="pointer-events-auto absolute z-10 -translate-x-1/2 rounded-xl border border-garden-line bg-white p-1.5 shadow-lg"
    >
      {single ? null : (
        <p
          data-testid="selection-count"
          className="px-2 pt-0.5 pb-1.5 text-center text-[11px] font-medium text-garden-muted"
        >
          {selection.length} features selected
        </p>
      )}

      <div className="flex items-center gap-1">
        {STATUS_ORDER.map((status) => (
          <StatusButton
            key={status}
            status={status}
            active={sharedStatus === status}
            onClick={() => (single ? setStatus(single.id, status) : setSelectionStatus(status))}
          />
        ))}
      </div>

      {single && single.status === 'replace' ? (
        <ReplaceWithField
          key={single.id}
          value={single.replaceWith}
          onCommit={(text) => setReplaceWith(single.id, text)}
        />
      ) : null}

      {/* Shaping controls only make sense for one thing at a time. */}
      {single && geometry?.kind === 'rect' ? (
        <Row label="Rotation">
          <select
            data-testid="feature-rotation"
            aria-label="Feature rotation in degrees"
            value={rotationOption(geometry.rotation)}
            onChange={(event) => {
              beginGesture();
              rotateFeatureLive(single.id, Number(event.target.value));
              endGesture();
            }}
            className="w-full rounded-md border border-garden-line bg-white px-2 py-1 text-xs text-garden-ink focus-visible:border-garden-green focus-visible:outline-none"
          >
            {rotationOptions(geometry.rotation).map((option) => (
              <option key={option} value={option}>
                {option}°
              </option>
            ))}
          </select>
        </Row>
      ) : null}

      {single && geometry?.kind === 'polygon' ? (
        <Row label="Corners">
          <span className="flex items-center gap-2">
            <input
              type="range"
              data-testid="corner-radius"
              aria-label="Corner rounding in metres"
              min={0}
              max={MAX_CORNER_RADIUS}
              step={0.1}
              value={geometry.cornerRadius}
              onChange={(event) => setCornerRadius(single.id, Number(event.target.value))}
              className="h-1 flex-1 accent-garden-green"
            />
            <span className="w-10 text-right text-[10px] text-garden-muted">
              {geometry.cornerRadius.toFixed(1)} m
            </span>
          </span>
        </Row>
      ) : null}

      {single && (geometry?.kind === 'polygon' || geometry?.kind === 'polyline') ? (
        <div className="mt-1.5 border-t border-garden-line px-1 pt-1.5">
          <button
            type="button"
            data-testid="edit-shape"
            aria-pressed={editing}
            onClick={() => setEditingShape(editing ? null : single.id)}
            className={[
              'flex w-full items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
              editing
                ? 'border-garden-green bg-garden-sage text-garden-forest'
                : 'border-garden-line text-garden-muted hover:bg-garden-sage',
            ].join(' ')}
          >
            <PenLine aria-hidden className="h-3.5 w-3.5" />
            {editing ? 'Done editing' : 'Edit shape'}
          </button>
          {editing ? (
            <p className="mt-1 px-1 text-center text-[10px] leading-relaxed text-garden-muted">
              Drag a corner to move it, click a side to add one, or pick a corner and press Delete.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-1.5 flex items-center gap-2 border-t border-garden-line px-1 pt-1.5">
      <span className="w-14 shrink-0 text-[10px] text-garden-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/** A rotation arrived at by dragging the handle is kept as an option so the select never lies. */
function rotationOption(degrees: number): number {
  return Math.round(degrees);
}

function rotationOptions(degrees: number): number[] {
  const rounded = rotationOption(degrees);
  return ROTATION_PRESETS.includes(rounded)
    ? ROTATION_PRESETS
    : [...ROTATION_PRESETS, rounded].sort((a, b) => a - b);
}

function StatusButton({
  status,
  active,
  onClick,
}: {
  status: FeatureStatus;
  active: boolean;
  onClick: () => void;
}) {
  const style = STATUS_COLOURS[status];
  const Icon = ICONS[status];

  return (
    <button
      type="button"
      data-testid={`set-status-${status}`}
      aria-pressed={active}
      onClick={onClick}
      style={
        active
          ? { background: style.tint, color: style.stroke, borderColor: style.stroke }
          : undefined
      }
      className={[
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        active ? '' : 'border-transparent text-garden-muted hover:bg-garden-sage',
      ].join(' ')}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {style.label}
    </button>
  );
}

/** One field, deliberately. Anything more belongs in step 3's brief. */
function ReplaceWithField({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);
  const listId = 'replace-with-options';

  useEffect(() => {
    if (!focused.current) setText(value ?? '');
  }, [value]);

  return (
    <div className="mt-1.5 border-t border-garden-line px-1 pt-1.5">
      <label className="flex items-center gap-2">
        <span className="text-[10px] whitespace-nowrap text-garden-muted">Replace with</span>
        <input
          data-testid="replace-with"
          list={listId}
          value={text}
          placeholder="e.g. Deck"
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            focused.current = false;
            onCommit(text);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="w-32 rounded-md border border-garden-line px-2 py-1 text-xs text-garden-ink focus-visible:border-garden-green focus-visible:outline-none"
        />
      </label>
      <datalist id={listId}>
        {REPLACEMENT_SUGGESTIONS.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}
