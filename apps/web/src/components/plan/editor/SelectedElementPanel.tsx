'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, MousePointer2, Trash2 } from 'lucide-react';
import {
  heightFor,
  PLANT_CATALOGUE,
  PLANT_SYMBOLS,
  SYMBOLS,
  type SymbolId,
} from '@garden-studio/schema';
import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import { elementAnchor, elementArea, isLocked, type DesignElement } from '@/lib/concepts';
import { canBeEdged, EDGING_MATERIALS, materialsFor, WALLING_MATERIALS } from '@/lib/materials';
import { MIN_LEVEL_CHANGE } from '@garden-studio/schema';
import { formatArea } from '@/lib/units';
import { ZONE_ORDER } from '@/lib/zones';
import { useBoundaryStore } from '@/state/boundary-store';
import { selectedElement, usePlanEditorStore } from '@/state/plan-editor-store';
import { LengthInput } from '../SideLengthsPanel';
import { ElementThumbnail } from './ElementThumbnail';

const inputClass =
  'w-full rounded-md border border-garden-line bg-white px-3 py-2.5 text-xs text-garden-ink focus-visible:outline-2 focus-visible:outline-garden-green disabled:opacity-40';
export function SelectedElementPanel() {
  const element = usePlanEditorStore(selectedElement);
  const unit = useBoundaryStore((state) => state.unit);
  return (
    <section data-testid="selected-element" className="bg-white">
      <div className="flex h-11 items-center border-b border-garden-line px-5">
        <h2 className="border-b-2 border-garden-green py-3 text-xs font-semibold text-garden-forest">
          Edit
        </h2>
      </div>
      <div className="p-5">
        {element ? (
          <ElementDetails key={element.id} element={element} unit={unit} />
        ) : (
          <div
            data-testid="selected-none"
            className="flex flex-col items-center gap-3 py-10 text-center"
          >
            <MousePointer2 aria-hidden className="h-7 w-7 text-garden-green" />
            <p className="text-sm font-medium">Make it your garden</p>
            <p className="max-w-56 text-xs leading-5 text-garden-muted">
              Select a tree, surface or feature to adjust its size, position and style.
            </p>
          </div>
        )}
      </div>
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
  const currentElement = () =>
    store.getState().present.elements.find((item) => item.id === element.id) ?? element;
  const locked = isLocked(element);
  const rect = element.shape.kind === 'rect' ? element.shape : null;
  const plant = element.category === 'planting-bed' && element.shape.kind === 'point';
  const anchor = elementAnchor(element);
  const species = element.plantId ? PLANT_CATALOGUE[element.plantId] : undefined;
  const replaceOptions = Object.entries(SYMBOLS).filter(
    ([, spec]) => spec.category === element.category && spec.footprint.kind === element.shape.kind,
  );
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ElementThumbnail element={element} />
        <div className="min-w-0 flex-1">
          <NameField
            name={element.name ?? CATEGORY_COLOURS[element.category].label}
            onCommit={(name) => store.getState().renameElement(element.id, name)}
          />
          <p data-testid="element-category" className="mt-1 text-xs text-garden-muted">
            {species?.botanicalName ?? CATEGORY_COLOURS[element.category].label}
          </p>
        </div>
      </div>
      {locked ? (
        <p
          data-testid="locked-reason"
          className="rounded-md bg-garden-sage/50 p-3 text-xs leading-5 text-garden-muted"
        >
          Ground layer. Change its material here; its boundary follows the garden.
        </p>
      ) : null}
      {plant ? (
        <Field label="Plant type / species">
          <select
            aria-label="Plant type or species"
            data-testid="element-species"
            className={inputClass}
            value={element.plantId ?? element.symbol ?? 'tree-deciduous'}
            onChange={(event) => {
              const choice = PLANT_CATALOGUE[event.target.value];
              store
                .getState()
                .replaceSymbol(
                  element.id,
                  choice?.symbol ?? (event.target.value as SymbolId),
                  choice ? event.target.value : undefined,
                );
            }}
          >
            <optgroup label="Plant types">
              {PLANT_SYMBOLS.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {SYMBOLS[symbol].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Named species">
              {Object.entries(PLANT_CATALOGUE).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.name} ({p.botanicalName})
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
      ) : null}
      {!plant && replaceOptions.length > 0 && !locked ? (
        <Field label="Replace with">
          <select
            data-testid="element-replace"
            aria-label="Replace feature"
            value={element.symbol ?? ''}
            className={inputClass}
            onChange={(event) =>
              store.getState().replaceSymbol(element.id, event.target.value as SymbolId)
            }
          >
            <option value="" disabled>
              Choose a feature
            </option>
            {replaceOptions.map(([id, spec]) => (
              <option key={id} value={id}>
                {spec.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Height">
          <LengthInput
            testId="element-height"
            allowZero
            readMetres={() => heightFor(currentElement())}
            label="Element height"
            metres={heightFor(element)}
            unit={unit}
            onCommit={(metres) => store.getState().setHeight(element.id, metres)}
          />
        </Field>
        {plant && element.shape.kind === 'point' ? (
          <Field label="Canopy width">
            <LengthInput
              testId="element-canopy"
              readMetres={() => {
                const shape = currentElement().shape;
                return shape.kind === 'point' ? shape.radius * 2 : 0;
              }}
              label="Canopy diameter"
              metres={element.shape.radius * 2}
              unit={unit}
              onCommit={(metres) => store.getState().setCanopyDiameter(element.id, metres)}
            />
          </Field>
        ) : (
          <Field label="Area">
            <span data-testid="element-area" className="block py-2 text-sm tabular-nums">
              {formatArea(elementArea(element), unit)}
            </span>
          </Field>
        )}
      </div>
      {rect && !locked ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(['width', 'depth'] as const).map((dimension) => (
              <Field key={dimension} label={dimension === 'width' ? 'Width' : 'Depth'}>
                <LengthInput
                  testId={`element-${dimension}`}
                  readMetres={() => {
                    const shape = currentElement().shape;
                    return shape.kind === 'rect' ? shape[dimension] : rect[dimension];
                  }}
                  label={`Element ${dimension}`}
                  metres={rect[dimension]}
                  unit={unit}
                  onCommit={(value) => {
                    store.getState().beginGesture();
                    store.getState().resizeElementLive(element.id, { [dimension]: value });
                    store.getState().endGesture();
                  }}
                />
              </Field>
            ))}
          </div>
          <Field label="Rotation">
            <div className="flex items-center gap-3">
              <span className="w-10 text-xs tabular-nums">{Math.round(rect.rotation)}°</span>
              <input
                type="range"
                aria-label="Element rotation"
                data-testid="element-rotation"
                min={0}
                max={359}
                value={Math.round(rect.rotation) % 360}
                onChange={(event) =>
                  store.getState().rotateElementLive(element.id, Number(event.target.value))
                }
                onPointerDown={() => store.getState().beginGesture()}
                onPointerUp={() => store.getState().endGesture()}
                onPointerCancel={() => store.getState().endGesture()}
                onBlur={() => store.getState().endGesture()}
                onKeyDown={() => store.getState().beginGesture()}
                onKeyUp={() => store.getState().endGesture()}
                className="min-w-0 flex-1 accent-garden-green"
              />
            </div>
          </Field>
        </>
      ) : null}
      {!locked ? (
        <div className="grid grid-cols-2 gap-3">
          {(['x', 'y'] as const).map((axis) => (
            <Field key={axis} label={`Position ${axis.toUpperCase()}`}>
              <LengthInput
                testId={`element-position-${axis}`}
                readMetres={() => elementAnchor(currentElement())[axis]}
                label={`Position ${axis.toUpperCase()}`}
                metres={anchor[axis]}
                unit={unit}
                allowNegative
                onCommit={(value) =>
                  store.getState().setPosition(element.id, { ...anchor, [axis]: value })
                }
              />
            </Field>
          ))}
        </div>
      ) : null}
      {!plant ? (
        <Field label="Material">
          <select
            data-testid="element-material"
            aria-label="Material"
            value={element.material ?? ''}
            className={inputClass}
            onChange={(event) => store.getState().setMaterial(element.id, event.target.value)}
          >
            {materialsFor(element.category).map((material) => (
              <option key={material.id} value={material.id}>
                {material.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {!plant && canBeEdged(element.category) ? (
        /*
         * Offered on the four ground-covering categories only, and "Spade cut" is the default
         * rather than a product: a border has a cut edge for nothing, and every entry below it is
         * something somebody has to buy and lay. Where the course actually goes is not asked —
         * `plan/edging.ts` derives that from the outline, leaving out the sides against the fence
         * and the house.
         */
        <Field label="Edging">
          <select
            data-testid="element-edging"
            aria-label="Edging"
            value={element.edging ?? ''}
            className={inputClass}
            onChange={(event) => store.getState().setEdging(element.id, event.target.value)}
          >
            <option value="">Spade cut (none)</option>
            {EDGING_MATERIALS.map((material) => (
              <option key={material.id} value={material.id}>
                {material.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {!plant && Math.abs(element.elevation ?? 0) >= MIN_LEVEL_CHANGE ? (
        /*
         * Only where there is a level change to retain, because without one there is no wall: the
         * face is derived from the edge of a raised element. Offering it on a flat surface would be
         * a control that silently does nothing, which is how `elevation` itself spent its first
         * year on this screen.
         */
        <Field label="Retaining wall">
          <select
            data-testid="element-retaining"
            aria-label="Retaining wall"
            value={element.retaining ?? ''}
            className={inputClass}
            onChange={(event) => store.getState().setRetaining(element.id, event.target.value)}
          >
            <option value="">Upstand in the same material</option>
            {WALLING_MATERIALS.map((material) => (
              <option key={material.id} value={material.id}>
                {material.label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {!locked ? (
        <Field label="Status">
          <select
            data-testid="element-status"
            aria-label="Design status"
            className={inputClass}
            value={element.status ?? ''}
            onChange={(event) =>
              store
                .getState()
                .setStatus(
                  element.id,
                  event.target.value === ''
                    ? undefined
                    : (event.target.value as DesignElement['status']),
                )
            }
          >
            <option value="">Proposed</option>
            <option value="keep">Keep</option>
            <option value="remove">Remove</option>
            <option value="replace">Replace</option>
          </select>
          <span className="mt-1 text-[10px] text-garden-muted">
            Mark the intended work. Delete removes the object from the plan.
          </span>
        </Field>
      ) : null}
      <div className="flex gap-3">
        <button
          type="button"
          data-testid="duplicate-element"
          disabled={locked}
          onClick={() => store.getState().duplicateElement(element.id)}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-garden-line py-2.5 text-xs disabled:opacity-40"
        >
          <Copy aria-hidden className="h-4 w-4" />
          Duplicate
        </button>
        <button
          type="button"
          data-testid="delete-element"
          disabled={locked}
          onClick={() => store.getState().deleteElement(element.id)}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 py-2.5 text-xs text-red-600 disabled:opacity-40"
        >
          <Trash2 aria-hidden className="h-4 w-4" />
          Delete
        </button>
      </div>
      <details className="rounded-md border border-garden-line p-3">
        <summary className="cursor-pointer text-xs font-medium">Advanced options</summary>
        <div className="mt-4 space-y-4">
          <Field label="Zone">
            <select
              data-testid="element-zone"
              aria-label="Zone"
              value={element.zone}
              disabled={locked}
              className={inputClass}
              onChange={(event) =>
                store
                  .getState()
                  .setZone(element.id, event.target.value as (typeof ZONE_ORDER)[number])
              }
            >
              {ZONE_ORDER.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.charAt(0).toUpperCase() + zone.slice(1)} garden
                </option>
              ))}
            </select>
          </Field>
          <Field label="Elevation">
            <LengthInput
              testId="element-elevation"
              readMetres={() => currentElement().elevation ?? 0}
              label="Elevation above grade"
              metres={element.elevation ?? 0}
              unit={unit}
              allowNegative
              onCommit={(metres) => store.getState().setElevation(element.id, metres)}
            />
          </Field>
        </div>
      </details>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="text-[11px] text-garden-muted">{label}</span>
      {children}
    </label>
  );
}

function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(name);
  const focused = useRef(false);
  const cancelled = useRef(false);

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
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (text.trim() === '') setText(name);
        else onCommit(text);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          setText(name);
          event.currentTarget.blur();
        }
      }}
      className="w-full min-w-0 rounded-md border border-transparent px-1 py-0.5 text-base font-semibold text-garden-ink hover:border-garden-line focus-visible:border-garden-green focus-visible:outline-none"
    />
  );
}
