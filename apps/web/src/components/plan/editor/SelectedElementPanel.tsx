'use client';

import { Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  heightFor,
  MIN_LEVEL_CHANGE,
  PLANT_CATALOGUE,
  PLANT_SYMBOLS,
  SYMBOLS,
  type SymbolId,
} from '@garden-studio/schema';
import { elementAnchor, isLocked, type DesignElement } from '@/lib/concepts';
import {
  canBeEdged,
  MATERIAL_FILLS,
  materialsFor,
  WALLING_MATERIALS,
  type MaterialId,
} from '@/lib/materials';
import { materialAssets } from '@/lib/materials/assets/material-assets';
import type { formatArea } from '@/lib/units';
import { ZONE_ORDER } from '@/lib/zones';
import { useBoundaryStore } from '@/state/boundary-store';
import { selectedElement, usePlanEditorStore } from '@/state/plan-editor-store';
import { LengthInput } from '../SideLengthsPanel';
import { CatalogueThumbnail } from './CatalogueThumbnail';
import { EdgesTab } from './EdgesTab';
import { Caption, Pill } from './Pill';

export const inputClass =
  'w-full rounded-md border border-garden-line bg-white px-2.5 py-1.5 text-xs text-garden-ink focus-visible:border-garden-green focus-visible:outline-none disabled:opacity-40';

/**
 * The precise verbs for the selected element, in four tabs: what it is made of, its size and
 * shape, what is built round its edges, and the rest.
 *
 * The inspector header already names the thing — thumbnail, name, category, area, clear — so this
 * is not a card and not a form. **Tabs rather than one long column** because a surface now has a
 * whole second subject — its boundary, stretch by stretch — and stacking that under the material
 * and the size would push the suggestions and the composer off the bottom of the inspector. Edges is
 * a tab of the selected element and not an editor of its own: the user never leaves the thing they
 * are working on to change what is round it.
 *
 * Every panel stays mounted and the inactive ones are `hidden`, which is the WAI-ARIA tab pattern
 * and also what keeps every control's `data-testid` reachable whichever tab is showing. Rendered
 * only while something is selected and the designer is idle.
 */
export function SelectedElementPanel() {
  const element = usePlanEditorStore(selectedElement);
  const unit = useBoundaryStore((state) => state.unit);
  if (!element) return null;

  return (
    <div data-testid="selected-element" className="px-4 py-3">
      <ElementSheet key={element.id} element={element} unit={unit} />
    </div>
  );
}

type SheetTab = 'style' | 'shape' | 'edges' | 'details';

const TAB_LABELS: Record<SheetTab, string> = {
  style: 'Style',
  shape: 'Size & Shape',
  edges: 'Edges',
  details: 'Details',
};

function ElementSheet({
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
  const replaceOptions = Object.entries(SYMBOLS).filter(
    ([, spec]) => spec.category === element.category && spec.footprint.kind === element.shape.kind,
  );
  const sizedByCanopy = plant && element.shape.kind === 'point';
  const sizedByRect = Boolean(rect && !locked);

  /*
   * Which tabs this element has. A locked ground layer has no size to change — its outline follows
   * the zone — so it has no Size & Shape tab rather than an empty one; a plant has no edges.
   */
  const hasShape = sizedByCanopy || sizedByRect || !locked;
  const edgeable = !plant && canBeEdged(element.category);
  const tabs: SheetTab[] = ['style', ...(hasShape ? (['shape'] as const) : []), ...(edgeable ? (['edges'] as const) : []), 'details'];

  /*
   * The Edges tab's open state lives in the store, not here: it is what tells the canvas to draw the
   * boundary for editing, and Escape on the canvas closes it. Every other tab is this sheet's own.
   */
  const edgesOpen = usePlanEditorStore((state) => state.edgeEdit?.hostId === element.id);
  const [chosen, setChosen] = useState<SheetTab>('style');
  const active: SheetTab = edgesOpen ? 'edges' : chosen === 'edges' ? 'style' : chosen;

  const choose = (tab: SheetTab) => {
    if (tab === 'edges') store.getState().openEdgeEdit(element.id);
    else if (edgesOpen) store.getState().closeEdgeEdit();
    setChosen(tab);
  };

  return (
    <div className="space-y-3">
      {locked ? (
        <p data-testid="locked-reason" className="text-[11px] leading-relaxed text-garden-muted">
          Ground layer. Change its material here; its boundary follows the garden.
        </p>
      ) : null}

      <div
        role="tablist"
        aria-label="Element properties"
        className="-mx-4 flex border-b border-garden-line px-4"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`element-tab-${tab}`}
            data-testid={`element-tab-${tab}`}
            aria-selected={active === tab}
            aria-controls={`element-panel-${tab}`}
            onClick={() => choose(tab)}
            className={`-mb-px flex-1 border-b-2 px-1 py-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
              active === tab
                ? 'border-garden-green text-garden-ink'
                : 'border-transparent text-garden-muted hover:text-garden-ink'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="element-panel-style"
        aria-labelledby="element-tab-style"
        hidden={active !== 'style'}
        className="space-y-3"
      >
        {plant ? (
          <Row label="Plant">
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
          </Row>
        ) : (
          <div className="space-y-1.5">
            <Row label="Material">
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
            </Row>
            <MaterialSwatches element={element} />
          </div>
        )}

        {!plant && replaceOptions.length > 0 && !locked ? (
          <Row label="Replace">
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
          </Row>
        ) : null}
      </div>

      {hasShape ? (
        <div
          role="tabpanel"
          id="element-panel-shape"
          aria-labelledby="element-tab-shape"
          hidden={active !== 'shape'}
          className="space-y-3"
        >
          {sizedByCanopy ? (
            <Row label="Canopy">
              <LengthInput
                testId="element-canopy"
                readMetres={() => {
                  const shape = currentElement().shape;
                  return shape.kind === 'point' ? shape.radius * 2 : 0;
                }}
                label="Canopy diameter"
                metres={element.shape.kind === 'point' ? element.shape.radius * 2 : 0}
                unit={unit}
                onCommit={(metres) => store.getState().setCanopyDiameter(element.id, metres)}
              />
            </Row>
          ) : sizedByRect && rect ? (
            <div>
              <Caption>Size</Caption>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(['width', 'depth'] as const).map((dimension) => (
                  <label key={dimension} className="flex min-w-0 items-center gap-1.5">
                    <span className="w-10 shrink-0 text-[11px] text-garden-muted">
                      {dimension === 'width' ? 'Width' : 'Depth'}
                    </span>
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
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {rect && !locked ? (
            <Row label="Rotation">
              <div className="flex min-w-0 flex-1 items-center gap-2">
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
                <span className="w-8 text-right text-xs tabular-nums">{Math.round(rect.rotation)}°</span>
              </div>
            </Row>
          ) : null}

          {!locked ? (
            <div className="grid grid-cols-2 gap-2">
              {(['x', 'y'] as const).map((axis) => (
                <label key={axis} className="flex min-w-0 items-center gap-1.5">
                  <span className="w-10 shrink-0 text-[11px] text-garden-muted">
                    {axis === 'x' ? 'Pos X' : 'Pos Y'}
                  </span>
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
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {edgeable ? (
        <div
          role="tabpanel"
          id="element-panel-edges"
          aria-labelledby="element-tab-edges"
          hidden={active !== 'edges'}
        >
          {/* Mounted only while open: it resolves the whole plan's edging, and a hidden tab should cost nothing. */}
          {active === 'edges' ? <EdgesTab element={element} unit={unit} /> : null}
        </div>
      ) : null}

      <div
        role="tabpanel"
        id="element-panel-details"
        data-testid="element-details"
        aria-labelledby="element-tab-details"
        hidden={active !== 'details'}
        className="space-y-3"
      >
        <Row label="Height">
          <LengthInput
            testId="element-height"
            allowZero
            readMetres={() => heightFor(currentElement())}
            label="Element height"
            metres={heightFor(element)}
            unit={unit}
            onCommit={(metres) => store.getState().setHeight(element.id, metres)}
          />
        </Row>

        {!plant && Math.abs(element.elevation ?? 0) >= MIN_LEVEL_CHANGE ? (
          /*
           * Only where there is a level change to retain, because without one there is no wall: the
           * face is derived from the edge of a raised element. Offering it on a flat surface would be
           * a control that silently does nothing, which is how `elevation` itself spent its first
           * year on this screen.
           */
          <Row label="Retaining">
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
          </Row>
        ) : null}

        {!locked ? (
          <Row label="Status" hint="Mark the intended work. Delete removes the object from the plan.">
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
          </Row>
        ) : null}

        <Row label="Zone">
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
        </Row>
        <Row label="Elevation">
          <LengthInput
            testId="element-elevation"
            readMetres={() => currentElement().elevation ?? 0}
            label="Elevation above grade"
            metres={element.elevation ?? 0}
            unit={unit}
            allowNegative
            onCommit={(metres) => store.getState().setElevation(element.id, metres)}
          />
        </Row>
      </div>

      {/* Object-level actions, under every tab: they are about the thing, not about one property. */}
      {!locked ? (
        <div className="flex flex-wrap gap-1.5 border-t border-garden-line pt-3">
          <Pill
            testId="duplicate-element"
            onClick={() => store.getState().duplicateElement(element.id)}
            icon={<Copy aria-hidden className="h-3.5 w-3.5" />}
          >
            Duplicate
          </Pill>
          <Pill
            testId="delete-element"
            tone="danger"
            onClick={() => store.getState().deleteElement(element.id)}
            icon={<Trash2 aria-hidden className="h-3.5 w-3.5" />}
          >
            Delete
          </Pill>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The material as pictures, under the select that names it.
 *
 * The catalogue's own thumbnail where the material has a face or a tile on disk, and its flat
 * fill where it does not — never a broken image, and the same answer the plan itself gives when an
 * asset is missing. Clicking one is the same `setMaterial` the select performs: a swatch is a
 * direct edit, one tap instead of two, and the first rung of the ladder that ends at "use porcelain
 * instead" typed in the composer.
 */
function MaterialSwatches({ element }: { element: DesignElement }) {
  const options = materialsFor(element.category);
  if (options.length < 2) return null;

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Material swatches">
      {options.map((material) => {
        const current = element.material === material.id;
        const assets = materialAssets(material.id);
        const pictured = Boolean(assets?.face ?? assets?.texture);
        const fill = MATERIAL_FILLS[material.id as MaterialId] ?? '#dfe3dc';
        return (
          <li key={material.id}>
            <button
              type="button"
              data-testid={`material-swatch-${material.id}`}
              aria-label={material.label}
              aria-pressed={current}
              title={material.label}
              onClick={() => usePlanEditorStore.getState().setMaterial(element.id, material.id)}
              className={`block h-8 w-8 overflow-hidden rounded-md border transition-[box-shadow,border-color] focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none ${
                current
                  ? 'border-garden-green ring-2 ring-garden-green/40'
                  : 'border-garden-line hover:border-garden-green/60'
              }`}
              style={pictured ? undefined : { backgroundColor: fill }}
            >
              {pictured ? (
                <CatalogueThumbnail
                  element={{ category: element.category, material: material.id }}
                  className="object-cover"
                />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A label beside its control, on one line. Labels above every control is what a form looks like. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] font-medium text-garden-muted">{label}</span>
        <span className="flex min-w-0 flex-1">{children}</span>
      </span>
      {hint ? <span className="pl-16 text-[10px] text-garden-muted">{hint}</span> : null}
    </label>
  );
}
