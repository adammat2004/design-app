'use client';

import { useMemo, useState } from 'react';
import {
  FRAME_MODELS,
  findMaterial,
  isStructureFinish,
  presetMatches,
  structurePins,
  STRUCTURE_FINISHES,
  STRUCTURE_SIDES,
  structureFinish,
  type DesignElement,
  type ResolvedStructure,
  type StructureFinishId,
  type StructureSide,
} from '@garden-studio/schema';
import type { Unit } from '@garden-studio/schema';
import { structureContextNow, usePlanEditorStore } from '@/state/plan-editor-store';
import { LengthInput } from '../plan/SideLengthsPanel';
import { Caption } from '../plan/editor/Pill';
import { describePins, StructureResizeNotice, type BlockedResize } from './StructureResizeNotice';

/**
 * The configurator's right-hand column: the structure's settings, in tabs that exist only for what
 * this structure supports.
 *
 * **Every control writes the same element the plan draws, through the same store actions the plan's
 * inspector uses** — `resizeStructure` for width and depth (which keeps the side the structure is
 * against, and refuses by name when something is in the way), `setHeight`, `setMaterial` for the
 * frame, `setStructurePreset` for a whole style, and `setStructure` for the roof, sides, lighting
 * and frame model. There is no draft copy to apply or throw away: each change is an ordinary
 * undoable edit, autosaved like any other, and the plan behind this screen is already up to date.
 *
 * Tabs are generated from the definition's capabilities rather than from what the structure is
 * called: a definition with no `sides` gets no Sides tab. An empty tab is a control that looks
 * available and does nothing, which is the fault this codebase keeps catching.
 */
type InspectorTab = 'size' | 'style' | 'roof' | 'sides' | 'finish' | 'lighting';

const TAB_LABELS: Record<InspectorTab, string> = {
  size: 'Size',
  style: 'Style',
  roof: 'Roof',
  sides: 'Sides',
  finish: 'Finish',
  lighting: 'Lighting',
};

const SIDE_LABELS: Record<StructureSide, string> = { left: 'Left', right: 'Right', rear: 'Rear' };

export function structureTabs(structure: ResolvedStructure): InspectorTab[] {
  const { definition } = structure;
  return [
    'size',
    ...(definition.presets.length > 1 ? (['style'] as const) : []),
    ...(definition.roof ? (['roof'] as const) : []),
    ...(definition.sides ? (['sides'] as const) : []),
    ...(definition.frameMaterials.length ? (['finish'] as const) : []),
    ...(definition.lighting ? (['lighting'] as const) : []),
  ];
}

export function StructureInspector({
  element,
  structure,
  unit,
}: {
  element: DesignElement;
  structure: ResolvedStructure;
  unit: Unit;
}) {
  const tabs = structureTabs(structure);
  const [active, setActive] = useState<InspectorTab>('size');
  const store = usePlanEditorStore;
  const clash = usePlanEditorStore((state) => state.clash);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const { definition } = structure;
  // A refused size belongs to the element it was typed for; selecting another one drops it.
  const [refused, setRefused] = useState<{ elementId: string; result: BlockedResize } | null>(null);
  const blocked = refused?.elementId === element.id ? refused.result : null;
  const pins = useMemo(
    () => describePins(structurePins(element, structureContextNow(elements))),
    [element, elements],
  );
  const current = () => store.getState().present.elements.find((item) => item.id === element.id) ?? element;
  const clamp = (value: number, range: { min: number; max: number }) =>
    Math.min(range.max, Math.max(range.min, value));

  return (
    <div data-testid="structure-inspector" className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Structure settings" className="flex flex-wrap gap-1 border-b border-garden-line px-4 pt-3 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`structure-tab-${tab}`}
            data-testid={`structure-tab-${tab}`}
            aria-selected={active === tab}
            aria-controls={`structure-panel-${tab}`}
            onClick={() => setActive(tab)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
              active === tab ? 'bg-garden-forest text-white' : 'text-garden-muted hover:bg-garden-sage hover:text-garden-ink'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Panel tab="size" active={active}>
          {(['width', 'depth'] as const).map((dimension) => (
            <Field key={dimension} label={dimension === 'width' ? 'Width' : 'Depth'}>
              <LengthInput
                testId={`structure-${dimension}`}
                label={`Structure ${dimension}`}
                metres={structure[dimension]}
                unit={unit}
                readMetres={() => {
                  const shape = current().shape;
                  return shape.kind === 'rect' ? shape[dimension] : structure[dimension];
                }}
                onCommit={(metres) => {
                  const result = store.getState().resizeStructure(element.id, { [dimension]: metres });
                  setRefused(result.status === 'blocked' ? { elementId: element.id, result } : null);
                }}
              />
            </Field>
          ))}
          <Field label="Height">
            <LengthInput
              testId="structure-height"
              label="Structure height"
              metres={structure.height}
              unit={unit}
              readMetres={() => current().height ?? structure.height}
              onCommit={(metres) => store.getState().setHeight(element.id, clamp(metres, definition.dimensions.height))}
            />
          </Field>
          <p data-testid="structure-pins" className="text-[11px] leading-relaxed text-garden-ink">
            {pins}
          </p>
          <p className="text-[11px] leading-relaxed text-garden-muted">
            Width and depth are the footprint on the plan, measured along the structure&rsquo;s own sides; its
            turn on the plan stays as it is. Height is how tall it stands, and changes the shadow it casts
            rather than the ground it takes.
          </p>
          {blocked ? (
            <StructureResizeNotice
              elementId={element.id}
              result={blocked}
              unit={unit}
              onDone={() => setRefused(null)}
            />
          ) : null}
          {clash ? (
            <p data-testid="structure-clash" role="alert" className="rounded-md bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
              {clash}
            </p>
          ) : null}
        </Panel>

        {definition.presets.length > 1 ? (
          <Panel tab="style" active={active}>
            <Caption>Style</Caption>
            <div role="radiogroup" aria-label="Style" className="space-y-1.5">
              {definition.presets.map((preset) => {
                const chosen = structure.preset === preset.id;
                const edited = chosen && !presetMatches(element, preset);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    data-testid={`structure-preset-${preset.id}`}
                    onClick={() => store.getState().setStructurePreset(element.id, preset.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      chosen ? 'border-garden-forest ring-1 ring-garden-forest' : 'border-garden-line hover:border-garden-green'
                    }`}
                  >
                    <span className="block text-xs font-medium text-garden-ink">
                      {preset.label}
                      {edited ? <span className="font-normal text-garden-muted"> · edited</span> : null}
                    </span>
                    <span className="block text-[11px] leading-snug text-garden-muted">{preset.description}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-garden-muted">
              A style sets the frame, roof, sides, lighting and height together. It never changes the size.
            </p>
            <Caption className="pt-1">Frame style</Caption>
            <Choices
              name="model"
              value={structure.model}
              options={FRAME_MODELS}
              onChange={(model) => store.getState().setStructure(element.id, { model })}
            />
          </Panel>
        ) : null}

        {definition.roof ? (
          <Panel tab="roof" active={active}>
            <Caption>Roof</Caption>
            <Choices
              name="roof-kind"
              value={structure.roof.kind}
              options={definition.roof.kinds}
              onChange={(kind) => store.getState().setStructure(element.id, { roof: { kind } })}
            />
            <Caption className="pt-1">Roof finish</Caption>
            <select
              aria-label="Roof finish"
              data-testid="structure-roof-finish"
              className="w-full rounded-md border border-garden-line bg-white px-2.5 py-1.5 text-xs text-garden-ink"
              value={element.structure?.roof?.finish ?? ''}
              onChange={(event) =>
                store.getState().setStructure(element.id, { roof: { finish: event.target.value || undefined } })
              }
            >
              <option value="">Same as the frame</option>
              {definition.roof.finishes.map((id) => (
                <option key={id} value={id}>
                  {structureFinish(id).label}
                </option>
              ))}
            </select>
          </Panel>
        ) : null}

        {definition.sides ? (
          <Panel tab="sides" active={active}>
            <p className="text-[11px] leading-relaxed text-garden-muted">
              The front stays open as the way in. Sides are named as you face it from the front.
            </p>
            {STRUCTURE_SIDES.map((side) => (
              <div key={side} className="space-y-1.5">
                <Caption>{SIDE_LABELS[side]}</Caption>
                <Choices
                  name={`side-${side}`}
                  value={structure.sides[side]}
                  options={definition.sides!.options}
                  onChange={(value) => store.getState().setStructure(element.id, { sides: { [side]: value } })}
                />
              </div>
            ))}
          </Panel>
        ) : null}

        <Panel tab="finish" active={active}>
          <Caption>Frame</Caption>
          <div role="radiogroup" aria-label="Frame finish" className="grid grid-cols-3 gap-2">
            {frameOptions(element, structure).map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={structure.frame === id}
                data-testid={`structure-frame-${id}`}
                onClick={() => store.getState().setMaterial(element.id, id)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 text-[10px] leading-tight text-garden-ink ${
                  structure.frame === id ? 'border-garden-forest ring-1 ring-garden-forest' : 'border-garden-line hover:border-garden-green'
                }`}
              >
                <span
                  aria-hidden
                  className="h-8 w-full rounded"
                  style={{ background: swatchGradient(STRUCTURE_FINISHES[id].baseColor, STRUCTURE_FINISHES[id].metalness) }}
                />
                {structureFinish(id).label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-garden-muted">
            The frame is the material the plan, the schedule and the cost estimate read.
          </p>
        </Panel>

        {definition.lighting ? (
          <Panel tab="lighting" active={active}>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-garden-line px-3 py-2.5">
              <span className="text-xs text-garden-ink">Integrated lighting</span>
              <input
                type="checkbox"
                role="switch"
                data-testid="structure-lighting"
                checked={structure.lighting}
                onChange={(event) => store.getState().setStructure(element.id, { lighting: event.target.checked })}
                className="h-4 w-4 accent-garden-forest"
              />
            </label>
            <p className="text-[11px] leading-relaxed text-garden-muted">
              A warm strip along the inside of the frame.
            </p>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The frames offered, plus the current one when it is not among them — a pergola the generator made
 * in treated softwood keeps showing softwood as chosen rather than appearing to have no frame.
 */
function frameOptions(element: DesignElement, structure: ResolvedStructure): StructureFinishId[] {
  const offered: StructureFinishId[] = structure.definition.frameMaterials.filter((id) => isStructureFinish(id));
  // Only a real frame material: a roof panel or the light strip is a finish but not a frame.
  const current =
    isStructureFinish(element.material) && findMaterial(element.material) ? element.material : null;
  return current && !offered.includes(current) ? [...offered, current] : offered;
}

/** A metal reads as a sheen, a timber as a flat tone. Presentation of the swatch only. */
function swatchGradient(colour: string, metalness: number): string {
  return metalness > 0.3
    ? `linear-gradient(135deg, ${colour} 0%, #ffffff66 45%, ${colour} 70%)`
    : colour;
}

function Panel({ tab, active, children }: { tab: InspectorTab; active: InspectorTab; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`structure-panel-${tab}`}
      aria-labelledby={`structure-tab-${tab}`}
      hidden={active !== tab}
      className="space-y-2.5"
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[11px] font-medium text-garden-muted">{label}</span>
      <span className="flex min-w-0 flex-1">{children}</span>
    </label>
  );
}

function Choices<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          data-testid={`structure-${name}-${option.id}`}
          onClick={() => onChange(option.id)}
          className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
            value === option.id
              ? 'border-garden-forest bg-garden-forest text-white'
              : 'border-garden-line bg-white text-garden-ink hover:border-garden-green'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
