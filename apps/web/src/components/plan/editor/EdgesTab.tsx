'use client';

import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  EDGE_TREATMENTS,
  EDGING_HEIGHTS,
  EDGING_MATERIALS,
  EDGING_WIDTHS_MM,
  edgePlanOf,
  resolveEdges,
  sideChains,
  spanOfRun,
  treatmentSpec,
  type DesignElement,
  type EdgeDimension,
  type EdgeRun,
  type EdgeTreatment,
  type ResolvedEdgeRun,
} from '@garden-studio/schema';
import { draftPolygon } from '@/lib/boundary-geometry';
import { EDGE_TREATMENT_COLOUR } from '@/lib/canvas-colours';
import { useEdgeRules } from '@/lib/edge-rules';
import { housePolygon } from '@/lib/house';
import { materialAssets } from '@/lib/materials/assets/material-assets';
import { describeElementSide, elementSideLabel } from '@/lib/side-labels';
import { formatLength, type Unit } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { CatalogueThumbnail } from './CatalogueThumbnail';
import { Caption } from './Pill';

/**
 * What is built round the selected surface's edges — a tab of the element, not an editor of its own.
 *
 * Three modes, because "decide for me", "leave it bare" and "let me say" are three different
 * answers and a surface has to be able to give any of them:
 *
 * - **Auto** says what the rules chose, stretch by stretch, and *why*. An automatic answer the user
 *   cannot inspect is one whose only remedy is turning it off.
 * - **None** is a stated refusal, and it binds the neighbours too: a lawn beside a bed set to None
 *   does not quietly put the edge back from its own side.
 * - **Custom** is the user's own runs. The plan is where a run is understood — the canvas shows every
 *   stretch, a click adds one, the ends drag — so this tab holds what the plan cannot: the choice
 *   between seven treatments, the dimensions that treatment has and no others, and a quiet list.
 *
 * Opening this tab is what tells the canvas to draw the boundary for editing; the open state lives
 * in the store's `edgeEdit` for that reason, and Escape on the canvas closes it.
 */
export function EdgesTab({ element, unit }: { element: DesignElement; unit: Unit }) {
  const store = usePlanEditorStore;
  const site = useBoundaryStore((state) => state.present);
  const elements = usePlanEditorStore((state) => state.present.elements);
  const edgeEdit = usePlanEditorStore((state) => state.edgeEdit);
  const rules = useEdgeRules();

  const plan = edgePlanOf(element);
  const chains = useMemo(() => sideChains(element.shape), [element.shape]);

  const runs = useMemo(() => {
    const context = { boundary: draftPolygon(site), house: site.house ? housePolygon(site.house) : undefined };
    return resolveEdges(elements, context, rules).runs.filter((run) => run.hostId === element.id);
  }, [elements, site, rules, element.id]);

  const sideName = (side: number) =>
    elementSideLabel(describeElementSide(element, site, side), side, chains[side]?.closed ?? false);

  const selectedRunId = edgeEdit?.hostId === element.id ? edgeEdit.selectedRunId : null;
  const hoveredRunId = edgeEdit?.hostId === element.id ? edgeEdit.hoveredRunId : null;
  const selected = plan.runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedResolved = runs.find((run) => run.runId === selectedRunId) ?? null;

  return (
    <div className="space-y-3" data-testid="edges-tab">
      <div className="space-y-1">
        <Caption>Edging</Caption>
        <p className="text-[11px] leading-relaxed text-garden-muted">
          What is built where this {noun(element)} meets what is round it.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="How the edges are decided"
        className="grid grid-cols-3 rounded-md border border-garden-line bg-garden-sage/40 p-0.5"
      >
        {(['auto', 'none', 'custom'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={plan.mode === mode}
            data-testid={`edges-mode-${mode}`}
            onClick={() => store.getState().setEdgeMode(element.id, mode)}
            className={`rounded py-1.5 text-[11px] font-medium transition-colors ${
              plan.mode === mode
                ? 'bg-garden-forest text-white shadow-sm'
                : 'text-garden-ink hover:bg-white'
            }`}
          >
            {mode === 'auto' ? 'Auto' : mode === 'none' ? 'None' : 'Custom'}
          </button>
        ))}
      </div>

      {plan.mode === 'auto' ? (
        <AutoPanel element={element} runs={runs} unit={unit} sideName={sideName} />
      ) : plan.mode === 'none' ? (
        <p data-testid="edges-none" className="text-[11px] leading-relaxed text-garden-muted">
          No edging on any side. Surfaces beside this one will not add any along it either.
        </p>
      ) : (
        <>
          {selected ? (
            <SelectedSegment
              element={element}
              run={selected}
              resolved={selectedResolved}
              unit={unit}
              sideName={sideName}
            />
          ) : (
            <p data-testid="edges-hint" className="text-[11px] leading-relaxed text-garden-muted">
              Click the dashed boundary on the plan to add edging there, or pick a segment below.
              Drag a segment&rsquo;s ends to shorten it.
            </p>
          )}

          <SegmentList
            element={element}
            runs={plan.runs}
            chains={chains}
            unit={unit}
            selectedRunId={selectedRunId}
            hoveredRunId={hoveredRunId}
            sideName={sideName}
          />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- auto */

function AutoPanel({
  element,
  runs,
  unit,
  sideName,
}: {
  element: DesignElement;
  runs: ResolvedEdgeRun[];
  unit: Unit;
  sideName: (side: number) => string;
}) {
  return (
    <div className="space-y-2" data-testid="edges-auto">
      <p className="text-[11px] leading-relaxed text-garden-muted">
        Edging is chosen automatically from the materials each side meets.
      </p>

      <label className="flex min-w-0 items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] font-medium text-garden-muted">Product</span>
        <select
          data-testid="element-edging"
          aria-label="Edging product used where edging is laid"
          value={element.edging ?? ''}
          className="w-full rounded-md border border-garden-line bg-white px-2.5 py-1.5 text-xs text-garden-ink focus-visible:border-garden-green focus-visible:outline-none"
          onChange={(event) => usePlanEditorStore.getState().setEdging(element.id, event.target.value)}
        >
          <option value="">The style&rsquo;s choice</option>
          {EDGING_MATERIALS.map((material) => (
            <option key={material.id} value={material.id}>
              {material.label}
            </option>
          ))}
        </select>
      </label>

      {runs.length === 0 ? (
        <p data-testid="edges-auto-empty" className="text-[11px] leading-relaxed text-garden-muted">
          Nothing is laid: every side meets something that is its own edge.
        </p>
      ) : (
        <ul className="divide-y divide-garden-line/70 rounded-md border border-garden-line">
          {runs.map((run) => (
            <li key={run.id} data-testid="edges-auto-run" className="px-2.5 py-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <Bar treatment={run.treatment} />
                <span className="font-medium text-garden-ink">{sideName(run.side)}</span>
                <span className="text-garden-muted">{treatmentSpec(run.treatment).label}</span>
                <span className="ml-auto tabular-nums text-garden-muted">{formatLength(run.length, unit)}</span>
              </div>
              {run.why ? <p className="mt-0.5 pl-3 text-[10px] text-garden-muted">{run.why}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- custom */

function SelectedSegment({
  element,
  run,
  resolved,
  unit,
  sideName,
}: {
  element: DesignElement;
  run: EdgeRun;
  resolved: ResolvedEdgeRun | null;
  unit: Unit;
  sideName: (side: number) => string;
}) {
  const store = usePlanEditorStore;
  const spec = treatmentSpec(run.treatment);
  const material = run.materialId ?? spec.defaultMaterial ?? undefined;

  return (
    <div className="space-y-3" data-testid="edges-selected">
      <div>
        <Caption>Treatment</Caption>
        <ul className="mt-1.5 grid grid-cols-4 gap-1.5" aria-label="Edge treatments">
          {EDGE_TREATMENTS.map((treatment) => (
            <li key={treatment.id}>
              <TreatmentTile
                treatment={treatment.id}
                current={run.treatment === treatment.id}
                onChoose={() => store.getState().setEdgeRunTreatment(element.id, run.id, treatment.id)}
              />
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[10px] text-garden-muted">{spec.hint}</p>
      </div>

      <div className="space-y-2">
        <Caption>Selected segment</Caption>
        <p className="text-[11px] text-garden-ink" data-testid="edges-selected-length">
          {sideName(run.side)} ·{' '}
          {resolved ? formatLength(resolved.length, unit) : 'No longer fits this side'}
        </p>

        {spec.dims.map((dimension) => (
          <MillimetreField
            key={`${run.id}-${dimension}-${run.treatment}`}
            dimension={dimension}
            value={dimension === 'width' ? run.widthMm : run.heightMm}
            fallback={defaultMillimetres(dimension, material)}
            onCommit={(millimetres) =>
              store.getState().setEdgeRunDimension(element.id, run.id, dimension, millimetres)
            }
          />
        ))}

        <button
          type="button"
          data-testid="edges-remove-segment"
          onClick={() => store.getState().removeEdgeRun(element.id, run.id)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-700 hover:underline"
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
          Remove edging from this segment
        </button>
      </div>
    </div>
  );
}

/**
 * Every stored run, secondary to the plan.
 *
 * Hovering a row lights its run on the canvas and hovering the run lights the row — one
 * `hoveredRunId` read by both. A run whose side has been shortened out from under it is listed and
 * said, never moved or dropped: it comes back when the geometry does, the rule a gate and a door
 * already follow.
 */
function SegmentList({
  element,
  runs,
  chains,
  unit,
  selectedRunId,
  hoveredRunId,
  sideName,
}: {
  element: DesignElement;
  runs: EdgeRun[];
  chains: ReturnType<typeof sideChains>;
  unit: Unit;
  selectedRunId: string | null;
  hoveredRunId: string | null;
  sideName: (side: number) => string;
}) {
  const store = usePlanEditorStore;
  if (runs.length === 0) {
    return (
      <p data-testid="edges-segments-empty" className="text-[11px] text-garden-muted">
        No segments yet — every side is bare.
      </p>
    );
  }

  const ordered = [...runs].sort((a, b) => a.side - b.side || startOf(a) - startOf(b));
  function startOf(run: EdgeRun): number {
    const chain = chains[run.side];
    return chain ? (spanOfRun(chain, run)?.from ?? 0) : 0;
  }

  return (
    <div className="space-y-1">
      <Caption>Edge segments</Caption>
      <ul className="divide-y divide-garden-line/70 rounded-md border border-garden-line">
        {ordered.map((run) => {
          const chain = chains[run.side];
          const span = chain ? spanOfRun(chain, run) : null;
          const active = run.id === selectedRunId;
          const hovered = run.id === hoveredRunId;

          return (
            <li key={run.id}>
              <button
                type="button"
                data-testid={`edge-segment-${run.id}`}
                aria-pressed={active}
                onClick={() => store.getState().selectEdgeRun(run.id)}
                onMouseEnter={() => store.getState().hoverEdgeRun(run.id)}
                onMouseLeave={() => store.getState().hoverEdgeRun(null)}
                onFocus={() => store.getState().hoverEdgeRun(run.id)}
                onBlur={() => store.getState().hoverEdgeRun(null)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                  active ? 'bg-garden-sage' : hovered ? 'bg-garden-sage/50' : 'hover:bg-garden-sage/50'
                }`}
              >
                <Bar treatment={run.treatment} />
                <span className="font-medium text-garden-ink">{sideName(run.side)}</span>
                <span className="text-garden-muted">{treatmentSpec(run.treatment).label}</span>
                <span className="ml-auto tabular-nums text-garden-muted">
                  {span ? formatLength(span.to - span.from, unit) : 'Off this side'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {element.edges?.runs.some((run) => run.source === 'user') ? null : (
        <p className="text-[10px] text-garden-muted">These started from the automatic answer.</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function TreatmentTile({
  treatment,
  current,
  onChoose,
}: {
  treatment: EdgeTreatment;
  current: boolean;
  onChoose: () => void;
}) {
  const spec = treatmentSpec(treatment);
  const material = spec.defaultMaterial;
  const assets = material ? materialAssets(material) : null;
  const pictured = Boolean(assets?.face ?? assets?.texture);

  return (
    <button
      type="button"
      data-testid={`edge-treatment-${treatment}`}
      aria-pressed={current}
      title={spec.hint}
      onClick={onChoose}
      className={`flex w-full flex-col items-center gap-1 rounded-md border p-1 text-[10px] font-medium transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none ${
        current
          ? 'border-garden-green text-garden-ink ring-2 ring-garden-green/40'
          : 'border-garden-line text-garden-muted hover:border-garden-green/60'
      }`}
    >
      <span
        aria-hidden
        className="relative block h-7 w-full overflow-hidden rounded-sm border border-garden-line/60 bg-white"
        style={pictured || treatment === 'none' ? undefined : { backgroundColor: EDGE_TREATMENT_COLOUR[treatment] }}
      >
        {pictured && material ? (
          <CatalogueThumbnail element={{ category: 'paved-area', material }} className="object-cover" />
        ) : treatment === 'none' ? (
          <span className="absolute inset-x-1 top-1/2 h-px -rotate-12 bg-garden-muted/60" />
        ) : treatment === 'flush' ? (
          <span className="absolute inset-y-0 left-1/2 w-px bg-white/80" />
        ) : null}
      </span>
      {spec.label}
    </button>
  );
}

/** A narrow swatch of the treatment's overlay colour, so a row and its run on the plan agree. */
function Bar({ treatment }: { treatment: EdgeTreatment }) {
  return (
    <span
      aria-hidden
      className={`h-3 w-1 shrink-0 rounded-full ${treatment === 'none' ? 'border border-dashed border-garden-muted' : ''}`}
      style={treatment === 'none' ? undefined : { backgroundColor: EDGE_TREATMENT_COLOUR[treatment] }}
    />
  );
}

/**
 * A dimension in millimetres, because that is how every edging product is specified.
 *
 * Empty is a real answer: it clears the run back to its product's own dimension, which is shown as
 * the placeholder so the user can see what "default" means before they change it.
 */
function MillimetreField({
  dimension,
  value,
  fallback,
  onCommit,
}: {
  dimension: EdgeDimension;
  value: number | undefined;
  fallback: number | null;
  onCommit: (millimetres: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') return onCommit(null);
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) onCommit(Math.round(parsed));
    else setDraft(value === undefined ? '' : String(value));
  };

  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="w-14 shrink-0 text-[11px] font-medium text-garden-muted">
        {dimension === 'width' ? 'Width' : 'Height'}
      </span>
      <span className="relative flex min-w-0 flex-1">
        <input
          type="text"
          inputMode="numeric"
          data-testid={`edges-${dimension}`}
          aria-label={`${dimension === 'width' ? 'Width' : 'Height'} in millimetres`}
          value={draft}
          placeholder={fallback === null ? '' : String(fallback)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          className="w-full rounded-md border border-garden-line bg-white py-1.5 pr-9 pl-2.5 text-xs text-garden-ink tabular-nums focus-visible:border-garden-green focus-visible:outline-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-garden-muted">
          mm
        </span>
      </span>
    </label>
  );
}

function defaultMillimetres(dimension: EdgeDimension, material: string | undefined): number | null {
  if (!material) return null;
  if (dimension === 'width') return EDGING_WIDTHS_MM[material] ?? null;
  const metres = EDGING_HEIGHTS[material];
  return metres === undefined ? null : Math.round(metres * 1000);
}

function noun(element: DesignElement): string {
  switch (element.category) {
    case 'paved-area':
      return element.shape.kind === 'polyline' ? 'path' : 'paving';
    case 'planting-bed':
      return 'bed';
    case 'gravel-mulch':
      return 'gravel';
    case 'lawn':
      return 'lawn';
    default:
      return 'surface';
  }
}
