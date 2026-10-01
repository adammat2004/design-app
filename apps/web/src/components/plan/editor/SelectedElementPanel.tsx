'use client';

import { Box, Copy, Lock, LockOpen, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  heightFor,
  ENCLOSURE_KIND_IDS,
  ENCLOSURE_KINDS,
  MIN_LEVEL_CHANGE,
  PLANT_SPECIES,
  type EnclosureKind,
  PLANT_SYMBOLS,
  speciesById,
  SYMBOLS,
  structureDefinitionFor,
  type SymbolId,
} from '@garden-studio/schema';
import {
  elementAnchor,
  isGroundLayer,
  isLocked,
  isUserLocked,
  type DesignElement,
} from '@/lib/concepts';
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
import { FreeShapeControls } from './FreeShapeControls';
import { PlantingTab } from './PlantingTab';
import { Caption, Pill } from './Pill';
import { StructureResizeNotice, type BlockedResize } from '../../structure-3d/StructureResizeNotice';

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

type SheetTab = 'style' | 'planting' | 'shape' | 'edges' | 'details';

const TAB_LABELS: Record<SheetTab, string> = {
  style: 'Style',
  planting: 'Planting',
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
  const userLocked = isUserLocked(element);
  /* A user's lock holds the geometry still, so there is no size to change until it is unlocked. */
  const hasShape = !userLocked && (sizedByCanopy || sizedByRect || !locked);
  const edgeable = !plant && canBeEdged(element.category);
  const bed = element.category === 'planting-bed' && element.shape.kind !== 'point';
  const tabs: SheetTab[] = ['style', ...(bed ? (['planting'] as const) : []), ...(hasShape ? (['shape'] as const) : []), ...(edgeable ? (['edges'] as const) : []), 'details'];

  /*
   * The Edges tab's open state lives in the store, not here: it is what tells the canvas to draw the
   * boundary for editing, and Escape on the canvas closes it. Every other tab is this sheet's own.
   */
  const edgesOpen = usePlanEditorStore((state) => state.edgeEdit?.hostId === element.id);
  const [chosen, setChosen] = useState<SheetTab>('style');
  // A structure's refused size, with what is in the way. The sheet is keyed by element, so it resets.
  const [blocked, setBlocked] = useState<BlockedResize | null>(null);
  const structure = structureDefinitionFor(element) !== null;
  /* A tab that went away under the user — the Shape tab when the element was locked — falls back to Style. */
  const active: SheetTab = edgesOpen
    ? 'edges'
    : chosen === 'edges' || !tabs.includes(chosen)
      ? 'style'
      : chosen;

  const choose = (tab: SheetTab) => {
    if (tab === 'edges') store.getState().openEdgeEdit(element.id);
    else if (edgesOpen) store.getState().closeEdgeEdit();
    setChosen(tab);
  };

  return (
    <div className="space-y-3">
      {isGroundLayer(element) ? (
        <p data-testid="locked-reason" className="text-[11px] leading-relaxed text-garden-muted">
          Ground layer. Change its material here; its boundary follows the garden.
        </p>
      ) : userLocked ? (
        <div className="flex items-start gap-2">
          <p data-testid="locked-reason" className="flex-1 text-[11px] leading-relaxed text-garden-muted">
            Locked. Its shape and place are held, and the designer will not change it.
          </p>
          <Pill
            testId="element-unlock"
            icon={<LockOpen aria-hidden className="h-3.5 w-3.5" />}
            onClick={() => store.getState().toggleLocked([element.id])}
          >
            Unlock
          </Pill>
        </div>
      ) : null}

      {/*
        The way into the focused 3D editor, for the structures that have one. Asked of the
        definition rather than of a list of names, so a structure gains the button by gaining a
        definition. It opens a view of this same element: nothing is copied, so what is changed
        there is already true of the plan when the user comes back.
      */}
      {structureDefinitionFor(element) ? (
        <button
          type="button"
          data-testid="edit-in-3d"
          onClick={() => store.getState().openStructureEdit(element.id)}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-garden-forest px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-garden-green focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Box aria-hidden className="h-4 w-4" />
          Edit in 3D
        </button>
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
        {element.category === 'enclosure' ? <EnclosureControls element={element} /> : plant ? (
          <Row label="Plant">
            <select
              aria-label="Plant type or species"
              data-testid="element-species"
              className={inputClass}
              value={element.plantId ?? element.symbol ?? 'tree-deciduous'}
              onChange={(event) => {
                const species = speciesById(event.target.value);
                store
                  .getState()
                  .replaceSymbol(
                    element.id,
                    (species?.symbol as SymbolId | undefined) ?? (event.target.value as SymbolId),
                    species ? species.id : undefined,
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
              {/* By form, because a tree is never swapped for a shrub by somebody who meant it. */}
              {(['tree', 'shrub'] as const).map((form) => (
                <optgroup key={form} label={form === 'tree' ? 'Trees' : 'Shrubs'}>
                  {PLANT_SPECIES.filter((species) => species.symbol && species.form === form).map((species) => (
                    <option key={species.id} value={species.id}>
                      {species.common} ({species.botanical})
                    </option>
                  ))}
                </optgroup>
              ))}
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

      {bed ? (
        <div
          role="tabpanel"
          id="element-panel-planting"
          aria-labelledby="element-tab-planting"
          hidden={active !== 'planting'}
        >
          {/* Mounted only while open: the light verdict samples the sun across two days of shadows. */}
          {active === 'planting' ? <PlantingTab element={element} /> : null}
        </div>
      ) : null}

      {hasShape ? (
        <div
          role="tabpanel"
          id="element-panel-shape"
          aria-labelledby="element-tab-shape"
          hidden={active !== 'shape'}
          className="space-y-3"
        >
          <FreeShapeControls element={element} unit={unit} />

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
                        if (!structure) {
                          store.getState().setSize(element.id, { [dimension]: value });
                          return;
                        }
                        // A pergola is resized the way the 3D editor resizes it: anchored, and refused by name.
                        const result = store.getState().resizeStructure(element.id, { [dimension]: value });
                        setBlocked(result.status === 'blocked' ? result : null);
                      }}
                    />
                  </label>
                ))}
              </div>
              {blocked ? (
                <div className="mt-2">
                  <StructureResizeNotice
                    elementId={element.id}
                    result={blocked}
                    unit={unit}
                    onDone={() => setBlocked(null)}
                  />
                </div>
              ) : null}
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
                    store
                      .getState()
                      .rotateElementLive(element.id, Number(event.target.value), { exact: true })
                  }
                  onPointerDown={() => store.getState().beginGesture()}
                  onPointerUp={() => store.getState().endGesture()}
                  onPointerCancel={() => store.getState().endGesture()}
                  onBlur={() => store.getState().endGesture()}
                  onKeyDown={() => store.getState().beginGesture()}
                  onKeyUp={() => store.getState().endGesture()}
                  className="min-w-0 flex-1 accent-garden-green"
                />
                <DegreesInput
                  degrees={rect.rotation}
                  onCommit={(degrees) => {
                    const editor = store.getState();
                    editor.beginGesture();
                    editor.rotateElementLive(element.id, degrees, { exact: true });
                    editor.endGesture();
                  }}
                />
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
        {!isGroundLayer(element) ? (
          <Row label="Lock" hint="Hold it still: no drags by hand, and the designer will not touch it.">
            <button
              type="button"
              data-testid="element-lock"
              aria-pressed={userLocked}
              onClick={() => store.getState().toggleLocked([element.id])}
              className={[
                'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
                userLocked
                  ? 'border-garden-forest bg-garden-forest text-white'
                  : 'border-garden-line bg-white text-garden-ink hover:border-garden-green',
              ].join(' ')}
            >
              {userLocked ? (
                <Lock aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <LockOpen aria-hidden className="h-3.5 w-3.5" />
              )}
              {userLocked ? 'Locked' : 'Unlocked'}
            </button>
          </Row>
        ) : null}

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

/**
 * A typed rotation, beside the slider.
 *
 * The slider alone could not say 22.5°, and a rotation that has to match a house turned 23° is
 * exactly the number somebody reads off a drawing and wants to type. Held as text while focused,
 * like `LengthInput`, so "2" on the way to "22" never turns the patio; committed on Enter or blur,
 * and never when untouched, so tabbing through the panel does not push a no-op onto the history.
 */
function DegreesInput({ degrees, onCommit }: { degrees: number; onCommit: (degrees: number) => void }) {
  const format = (value: number) => String(Math.round(value * 10) / 10);
  const [text, setText] = useState(() => format(degrees));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(degrees));
  }, [degrees]);

  function commit() {
    const typed = Number(text);
    if (text.trim() === '' || !Number.isFinite(typed)) {
      setText(format(degrees));
      return;
    }
    if (text === format(degrees)) return;
    onCommit(((typed % 360) + 360) % 360);
  }

  return (
    <span className="flex w-[4.5rem] shrink-0 items-center gap-0.5 rounded-md border border-garden-line bg-white px-1.5 py-1 focus-within:border-garden-green">
      <input
        type="number"
        inputMode="decimal"
        step={1}
        aria-label="Rotation in degrees"
        data-testid="element-rotation-degrees"
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        className="w-full min-w-0 bg-transparent text-right text-xs tabular-nums text-garden-ink focus-visible:outline-none"
      />
      <span className="shrink-0 text-[11px] text-garden-muted">°</span>
    </span>
  );
}

/**
 * What a proposed boundary is: its kind, what it is built of, and a hedge's species. The height is
 * the Details tab's, as every element's is; the thickness is its line's width, under Size & Shape.
 */
function EnclosureControls({ element }: { element: DesignElement }) {
  const store = usePlanEditorStore.getState;
  const kind = element.enclosure?.kind ?? 'fence';
  const spec = ENCLOSURE_KINDS[kind];
  const hedges = PLANT_SPECIES.filter((species) => species.form === 'hedge');
  return (
    <div className="space-y-1.5">
      <Row label="Kind">
        <select
          data-testid="enclosure-kind"
          aria-label="Kind of boundary"
          value={kind}
          className={inputClass}
          onChange={(event) => store().setEnclosure(element.id, { kind: event.target.value as EnclosureKind })}
        >
          {ENCLOSURE_KIND_IDS.map((id) => (
            <option key={id} value={id}>
              {ENCLOSURE_KINDS[id].label}
            </option>
          ))}
        </select>
      </Row>
      {spec.materials.length > 1 ? (
        <Row label="Material">
          <select
            data-testid="element-material"
            aria-label="Material"
            value={element.material ?? spec.material}
            className={inputClass}
            onChange={(event) => store().setMaterial(element.id, event.target.value)}
          >
            {materialsFor('enclosure')
              .filter((material) => spec.materials.includes(material.id))
              .map((material) => (
                <option key={material.id} value={material.id}>
                  {material.label}
                </option>
              ))}
          </select>
        </Row>
      ) : null}
      {kind === 'hedge' ? (
        <Row label="Species">
          <select
            data-testid="enclosure-species"
            aria-label="Hedge species"
            value={element.plantId ?? ''}
            className={inputClass}
            onChange={(event) => store().setEnclosure(element.id, { plantId: event.target.value || null })}
          >
            <option value="">Not chosen</option>
            {hedges.map((species) => (
              <option key={species.id} value={species.id}>
                {species.common} ({species.botanical})
              </option>
            ))}
          </select>
        </Row>
      ) : null}
      <p className="text-[11px] leading-relaxed text-garden-muted">
        {kind === 'open'
          ? 'Laid along the boundary, this takes away what is there.'
          : 'Laid along the boundary, this replaces what is there; the old line shows dashed beneath it.'}
      </p>
    </div>
  );
}
