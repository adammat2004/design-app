'use client';

import { ChevronDown, ChevronRight, Fence, Footprints, Trash2 } from 'lucide-react';
import {
  boundaryRuns,
  BOUNDARY_HEIGHTS,
  GATE_DEFAULTS,
  GATE_LABELS,
  GateKindSchema,
  gateSegment,
  gatesOnEdge,
  styleForEdge,
  type BoundaryKind,
  type Gate,
  type GateKind,
} from '@garden-studio/schema';
import { vertexLabel } from '@/lib/boundary-geometry';
import { describeSide, sideLabel } from '@/lib/side-labels';
import { formatLength } from '@/lib/units';
import { selectedGateId, useBoundaryStore } from '@/state/boundary-store';
import { LengthInput } from '../SideLengthsPanel';
import { ChipRow, EditorHeader, EditorSection } from './SegmentInspectorShell';
import { SegmentTrack } from './SegmentTrack';

/**
 * One side of the property, selected on the plan: what encloses it, how tall that stands, whether
 * it faces the street, and the gates and driveways that open through it.
 *
 * This replaces two things. `BoundaryStylePanel` listed every side as "Side 1 … Side 4" with a
 * row of kind chips each, and `AccessPanel` armed a one-shot tool to click a fence for a gate or
 * the street. Both were answering questions about *a side* somewhere other than the side, and
 * the honest place for a fact about a side is the panel that opens when you click it.
 *
 * Everything here is optional and nothing gates Continue. A side left alone is a fence, which is
 * the documented default and what every plot drew before kinds existed.
 */

const KINDS: { id: BoundaryKind; label: string; hint: string }[] = [
  { id: 'fence', label: 'Fence', hint: 'Close-boarded timber panels' },
  { id: 'wall', label: 'Wall', hint: 'Brick or block, about 1.8 m' },
  { id: 'hedge', label: 'Hedge', hint: 'Takes about 0.7 m of the garden' },
  { id: 'railing', label: 'Railing', hint: 'You can see through it' },
  { id: 'open', label: 'Open', hint: 'Nothing built on this side' },
];

const GATE_HINTS: Record<GateKind, string> = {
  pedestrian: 'A garden gate: a person and a wheelie bin',
  vehicle: 'A car comes in here — the paved drive follows later',
  open: 'A gap with nothing hung in it',
};

export function SideEditor({ edgeVertexId }: { edgeVertexId: string }) {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const expandedGateId = useBoundaryStore(selectedGateId);
  const setBoundaryKind = useBoundaryStore((state) => state.setBoundaryKind);
  const setBoundaryHeight = useBoundaryStore((state) => state.setBoundaryHeight);
  const setStreetEdge = useBoundaryStore((state) => state.setStreetEdge);
  const addGate = useBoundaryStore((state) => state.addGate);
  const moveGateLive = useBoundaryStore((state) => state.moveGateLive);
  const beginGesture = useBoundaryStore((state) => state.beginGesture);
  const endGesture = useBoundaryStore((state) => state.endGesture);
  const select = useBoundaryStore((state) => state.select);

  const index = draft.vertices.findIndex((vertex) => vertex.id === edgeVertexId);
  const run = boundaryRuns(draft).find((entry) => entry.edgeVertexId === edgeVertexId);
  if (index < 0 || !run) return null;

  const to = (index + 1) % draft.vertices.length;
  const name = `Side ${vertexLabel(index)} → ${vertexLabel(to)}`;
  const facesStreet = draft.streetEdgeVertexId === edgeVertexId;
  const stored = styleForEdge(draft, edgeVertexId);
  const gates = gatesOnEdge(draft, edgeVertexId);
  // Only what currently resolves goes on the track; the rest is listed with its "off this side" badge.
  const placed = gates.filter((gate) => gateSegment(draft, gate) !== null);

  return (
    <div data-testid="side-editor" className="mt-3 space-y-4">
      <EditorHeader
        icon={<Fence aria-hidden className="h-4 w-4 text-garden-forest" />}
        title={name}
        measure={formatLength(run.length, unit)}
        detail={sideLabel(describeSide(draft, edgeVertexId))}
        testId="side-heading"
      />

      {/*
        The street is one fact about the whole plot — which side the front garden is on — and it
        is stated by naming a side. Turning it on here moves the designation; turning it off clears
        it. Only one side can face the street in this model, so the toggle says so rather than
        pretending two could.
      */}
      <button
        type="button"
        data-testid="side-street-toggle"
        aria-pressed={facesStreet}
        onClick={() => setStreetEdge(facesStreet ? null : edgeVertexId)}
        className={[
          'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px] font-medium transition-colors',
          facesStreet
            ? 'border-garden-forest bg-garden-forest text-white'
            : 'border-garden-line bg-white text-garden-ink hover:border-garden-green',
        ].join(' ')}
      >
        <Footprints aria-hidden className="h-4 w-4 shrink-0" />
        {facesStreet ? 'This side faces the street' : 'This side faces the street?'}
      </button>

      <EditorSection title="What is along this side">
        <ChipRow>
          {KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              data-testid={`side-kind-${kind.id}`}
              title={kind.hint}
              aria-pressed={run.kind === kind.id}
              onClick={() => setBoundaryKind(edgeVertexId, kind.id)}
              className={chipClass(run.kind === kind.id)}
            >
              {kind.label}
            </button>
          ))}
        </ChipRow>

        {run.kind !== 'open' ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-garden-muted">
              Height
              {stored?.height === undefined ? (
                <span className="ml-1 text-[10px] text-garden-muted/80">
                  (usual for a {run.kind})
                </span>
              ) : null}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-24">
                <LengthInput
                  testId="side-height"
                  label="How tall this side stands"
                  metres={run.height}
                  unit={unit}
                  readMetres={() => heightNow(edgeVertexId)}
                  onCommit={(height) => setBoundaryHeight(edgeVertexId, height)}
                />
              </span>
              {stored?.height !== undefined ? (
                <button
                  type="button"
                  data-testid="side-height-reset"
                  title={`Back to the usual ${formatLength(BOUNDARY_HEIGHTS[run.kind], unit)}`}
                  onClick={() => setBoundaryHeight(edgeVertexId, null)}
                  className="rounded-md px-1.5 py-1 text-[10px] text-garden-muted hover:bg-garden-sage hover:text-garden-forest"
                >
                  Usual
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
      </EditorSection>

      <EditorSection
        title="Openings in this side"
        detail={
          gates.length === 0
            ? 'A gate is where the side path starts; a driveway is where a car comes in.'
            : undefined
        }
      >
        {gates.length > 0 ? (
          <ul data-testid="side-gates" className="space-y-1.5">
            {gates.map((gate) => (
              <GateRow
                key={gate.id}
                gate={gate}
                fromLabel={vertexLabel(index)}
                sideLength={run.length}
                expanded={gate.id === expandedGateId}
                onToggle={() =>
                  select(
                    gate.id === expandedGateId
                      ? { kind: 'edge', edgeVertexId }
                      : { kind: 'gate', id: gate.id },
                  )
                }
              />
            ))}
          </ul>
        ) : null}

        <ChipRow>
          {GateKindSchema.options.map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`add-gate-${kind}`}
              title={GATE_HINTS[kind]}
              onClick={() => addGate(edgeVertexId, kind)}
              className="rounded-md border border-garden-line bg-white px-2 py-1 text-[10px] font-medium text-garden-muted hover:border-garden-green hover:text-garden-forest"
            >
              {`+ ${GATE_LABELS[kind]}`}
            </button>
          ))}
        </ChipRow>

        {/*
          The side unrolled flat, the same control the wall strip uses. A gate is drawn full
          height rather than at a real one: a fence has no elevation worth claiming, and the block
          is there to be grabbed and slid, not to say how tall the gate is.
        */}
        {placed.length > 0 ? (
          <SegmentTrack
            length={run.length}
            unit={unit}
            caption={`This side, from corner ${vertexLabel(index)}`}
            testId="side-track"
            itemTestId={(id) => `gate-block-${id}`}
            items={placed.map((gate) => ({
              id: gate.id,
              offset: gate.offsetAlongEdge,
              width: gate.width,
              label: GATE_LABELS[gate.kind],
              selected: gate.id === expandedGateId,
            }))}
            onSelect={(id) => select({ kind: 'gate', id })}
            onGestureStart={beginGesture}
            onMove={moveGateLive}
            onGestureEnd={endGesture}
          />
        ) : null}
      </EditorSection>
    </div>
  );
}

/** The side's height after a commit, read outside React so the input settles on the truth. */
function heightNow(edgeVertexId: string): number {
  const { present } = useBoundaryStore.getState();
  return boundaryRuns(present).find((run) => run.edgeVertexId === edgeVertexId)?.height ?? 0;
}

function GateRow({
  gate,
  fromLabel,
  sideLength,
  expanded,
  onToggle,
}: {
  gate: Gate;
  fromLabel: string;
  sideLength: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const setGateKind = useBoundaryStore((state) => state.setGateKind);
  const setGateWidth = useBoundaryStore((state) => state.setGateWidth);
  const setGateOffset = useBoundaryStore((state) => state.setGateOffset);
  const fitGate = useBoundaryStore((state) => state.fitGate);
  const removeGate = useBoundaryStore((state) => state.removeGate);

  /*
   * A gate the geometry has moved out from under — a corner dragged past it, a side typed shorter
   * than where it was hung — is kept in the document and drawn nowhere. It is *said* here rather
   * than clamped somewhere plausible, with the two honest answers offered: pull it back onto the
   * side if the side has room, or take it away.
   */
  const placed = gateSegment(draft, gate) !== null;
  const canFit = gate.width <= sideLength;

  return (
    <li
      data-testid={`side-gate-${gate.id}`}
      data-placed={placed}
      className="rounded-lg border border-garden-line bg-white"
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          data-testid={`toggle-gate-${gate.id}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] text-garden-ink"
        >
          {expanded ? (
            <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-garden-muted" />
          ) : (
            <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-garden-muted" />
          )}
          <span className="truncate">
            <span className="font-medium">{GATE_LABELS[gate.kind]}</span>
            {` · ${formatLength(gate.width, unit)}`}
            {placed ? ` · ${formatLength(gate.offsetAlongEdge, unit)} from ${fromLabel}` : ''}
          </span>
        </button>
        {!placed ? (
          <span
            data-testid={`gate-unplaced-${gate.id}`}
            className="rounded-full bg-garden-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-garden-warn"
          >
            Off this side
          </span>
        ) : null}
        <button
          type="button"
          data-testid={`remove-gate-${gate.id}`}
          aria-label={`Remove this ${GATE_LABELS[gate.kind].toLowerCase()}`}
          onClick={() => removeGate(gate.id)}
          className="rounded p-1 text-garden-muted hover:bg-garden-warn/10 hover:text-garden-warn"
        >
          <Trash2 aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>

      {!placed ? (
        <div className="flex items-center gap-2 border-t border-garden-line px-2 py-1.5 text-[10px] text-garden-muted">
          {canFit ? 'The side moved out from under it.' : 'The side is shorter than it is wide.'}
          {canFit ? (
            <button
              type="button"
              data-testid={`fit-gate-${gate.id}`}
              onClick={() => fitGate(gate.id)}
              className="rounded-md border border-garden-line px-2 py-0.5 font-medium text-garden-forest hover:border-garden-green"
            >
              Fit to side
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="space-y-2 border-t border-garden-line px-2 py-2">
          <ChipRow>
            {GateKindSchema.options.map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`gate-kind-${kind}`}
                title={GATE_HINTS[kind]}
                aria-pressed={gate.kind === kind}
                onClick={() => setGateKind(gate.id, kind)}
                className={chipClass(gate.kind === kind)}
              >
                {GATE_LABELS[kind]}
              </button>
            ))}
          </ChipRow>
          <Row label="Width">
            <LengthInput
              testId="gate-width"
              label="Width of this opening"
              metres={gate.width}
              unit={unit}
              readMetres={() => gateNow(gate.id)?.width ?? gate.width}
              onCommit={(width) => setGateWidth(gate.id, width)}
            />
          </Row>
          <Row label={`From ${fromLabel}`}>
            <LengthInput
              testId="gate-offset"
              label={`Distance from corner ${fromLabel} to the centre of this opening`}
              metres={gate.offsetAlongEdge}
              unit={unit}
              readMetres={() => gateNow(gate.id)?.offsetAlongEdge ?? gate.offsetAlongEdge}
              onCommit={(offset) => setGateOffset(gate.id, offset)}
            />
          </Row>
          <p className="text-[10px] text-garden-muted">
            {`Usually ${formatLength(GATE_DEFAULTS[gate.kind].width, unit)} wide.`}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function gateNow(gateId: string): Gate | undefined {
  return useBoundaryStore.getState().present.gates.find((gate) => gate.id === gateId);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-garden-muted">{label}</span>
      <span className="w-24">{children}</span>
    </label>
  );
}

export function chipClass(active: boolean): string {
  return [
    'rounded-full px-2.5 py-1 text-[11px] font-medium transition',
    active
      ? 'bg-garden-forest text-white'
      : 'bg-garden-sage text-garden-forest hover:bg-garden-green hover:text-white',
  ].join(' ');
}
