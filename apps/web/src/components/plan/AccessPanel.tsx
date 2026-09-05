'use client';

import { DoorOpen, Fence, Footprints, Trash2 } from 'lucide-react';
import {
  frontDoor,
  gardenDirection,
  gateSide,
  OPENING_DEFAULTS,
  primaryDoorTowards,
  resolvedGates,
  streetDirection,
  streetEdge,
  suggestedGateEdge,
  suggestedStreetEdge,
  suggestedWallTowards,
  wallLength,
} from '@garden-studio/schema';
import { formatLength } from '@/lib/units';
import { useBoundaryStore } from '@/state/boundary-store';

/**
 * Step 1's third sub-step: how you get in and out.
 *
 * Where you step out of the house decides where the terrace goes; which fence the gate is in
 * decides where the bins, the shed and the side path go; which fence faces the street decides
 * what the front garden is for. Together they are what turns a footprint on a plot into a site a
 * design can be built round, and the generator reads all four.
 *
 * Every inference here is **offered, not applied** — the same rule the patio-door chip set. A
 * wrong silent gate has the shed built confidently beside a fence the user never said had a way
 * through. One tap turns a guess into a statement, and the plan draws the result at once.
 */
export function AccessPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const accessTool = useBoundaryStore((state) => state.accessTool);
  const setAccessTool = useBoundaryStore((state) => state.setAccessTool);
  const addOpening = useBoundaryStore((state) => state.addOpening);
  const selectWall = useBoundaryStore((state) => state.selectWall);
  const addSuggestedGate = useBoundaryStore((state) => state.addSuggestedGate);
  const removeGate = useBoundaryStore((state) => state.removeGate);
  const setStreetEdge = useBoundaryStore((state) => state.setStreetEdge);
  const setSuggestedStreetEdge = useBoundaryStore((state) => state.setSuggestedStreetEdge);
  const setMode = useBoundaryStore((state) => state.setMode);

  const { house } = draft;
  if (!house) return null;

  // Away from the street once it is known, the house's own back until then.
  const garden = gardenDirection(draft);
  const towardsStreet = streetDirection(draft);
  const backDoor = garden ? primaryDoorTowards(house, garden) : null;
  const front = frontDoor(house, towardsStreet ?? undefined);
  const patioWall = backDoor || !garden ? null : suggestedWallTowards(house, garden, 'patio-door');
  const patioFits =
    patioWall !== null &&
    (wallLength(house, patioWall) ?? 0) >= OPENING_DEFAULTS['patio-door'].width;
  const frontWall =
    front || !towardsStreet ? null : suggestedWallTowards(house, towardsStreet, 'front-door');
  const frontFits =
    frontWall !== null &&
    (wallLength(house, frontWall) ?? 0) >= OPENING_DEFAULTS['front-door'].width;

  const street = streetEdge(draft);
  const streetSuggestion = street ? null : suggestedStreetEdge(draft);
  const gates = resolvedGates(draft);
  const gateSuggestion = gates.length === 0 ? suggestedGateEdge(draft) : null;

  return (
    <section data-testid="access-panel" className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold text-garden-ink">Access</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
          Doors, the side gate and the street. The terrace goes off the doors, the shed and the bins
          go by the gate, and the front path runs to the street.
        </p>
      </div>

      {/* ---- doors ---- */}
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-semibold text-garden-ink">Doors</h3>
        <p data-testid="doors-status" className="text-[10px] text-garden-muted">
          {backDoor
            ? `Garden door on the back: ${formatLength(backDoor.width, unit)} wide`
            : 'No door onto the garden yet'}
          {front ? ' · front door placed' : ''}
        </p>

        {patioFits ? (
          <Chip
            testId="access-suggest-patio-door"
            icon={<DoorOpen aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />}
            title="Add patio doors on the garden-facing wall"
            detail="Centred on the back wall. Move them on the House step if they are elsewhere."
            onClick={() => {
              addOpening(patioWall!, 'patio-door');
              selectWall(patioWall!);
            }}
          />
        ) : null}

        {frontFits ? (
          <Chip
            testId="suggest-front-door"
            icon={<DoorOpen aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />}
            title="Add a front door on the street-facing wall"
            detail="Where the front path ends."
            onClick={() => addOpening(frontWall!, 'front-door')}
          />
        ) : null}

        <button
          type="button"
          data-testid="access-edit-doors"
          onClick={() => setMode('house')}
          className="text-[10px] font-medium text-garden-green underline-offset-2 hover:underline"
        >
          Move or add doors on the House step
        </button>
      </div>

      {/* ---- the street ---- */}
      <div className="space-y-1.5 border-t border-garden-line pt-3">
        <h3 className="text-[11px] font-semibold text-garden-ink">Street</h3>
        <p data-testid="street-status" className="text-[10px] text-garden-muted">
          {street ? 'Street side chosen' : 'Which fence faces the street?'}
        </p>

        {streetSuggestion ? (
          <Chip
            testId="suggest-street-edge"
            icon={<Footprints aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />}
            title="The street is in front of the house"
            detail="Takes the fence the house faces. Or click a fence on the plan instead."
            onClick={setSuggestedStreetEdge}
          />
        ) : null}

        <div className="flex gap-1.5">
          <ToolButton
            testId="access-tool-street"
            active={accessTool === 'street'}
            onClick={() => setAccessTool(accessTool === 'street' ? null : 'street')}
          >
            {accessTool === 'street'
              ? 'Click the fence that faces the street…'
              : 'Pick the street side'}
          </ToolButton>
          {street ? (
            <button
              type="button"
              data-testid="clear-street-edge"
              onClick={() => setStreetEdge(null)}
              className="rounded-md border border-garden-line px-2 py-1 text-[10px] text-garden-muted hover:border-garden-green"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- gates ---- */}
      <div className="space-y-1.5 border-t border-garden-line pt-3">
        <h3 className="text-[11px] font-semibold text-garden-ink">Side gate</h3>
        <p data-testid="gates-count" className="text-[10px] text-garden-muted">
          {gates.length === 0
            ? 'No gate'
            : `${gates.length} ${gates.length === 1 ? 'gate' : 'gates'}`}
        </p>

        {gateSuggestion ? (
          <Chip
            testId="suggest-side-gate"
            icon={<Fence aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />}
            title="Add a side gate beside the house"
            detail={`On the wider side return, just behind the back wall — ${formatLength(OPENING_DEFAULTS['back-door'].width, unit)} wide. Or click the fence.`}
            onClick={addSuggestedGate}
          />
        ) : null}

        <ToolButton
          testId="access-tool-gate"
          active={accessTool === 'gate'}
          onClick={() => setAccessTool(accessTool === 'gate' ? null : 'gate')}
        >
          {accessTool === 'gate'
            ? 'Click the fence where the gate is…'
            : 'Place a gate on the fence'}
        </ToolButton>

        {gates.length > 0 ? (
          <ul data-testid="gates-list" className="space-y-1">
            {gates.map(({ gate }, index) => (
              <li
                key={gate.id}
                className="flex items-center justify-between rounded-md border border-garden-line bg-white px-2 py-1 text-[10px] text-garden-ink"
              >
                <span>
                  {`Gate ${index + 1} · ${sideLabel(gateSide(draft, gate, house))} · ${formatLength(gate.width, unit)}`}
                </span>
                <button
                  type="button"
                  data-testid={`remove-gate-${gate.id}`}
                  aria-label={`Remove gate ${index + 1}`}
                  onClick={() => removeGate(gate.id)}
                  className="rounded p-0.5 text-garden-muted hover:text-red-700"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function sideLabel(side: 'left' | 'right' | null): string {
  return side === 'left' ? 'left side' : side === 'right' ? 'right side' : 'on the fence';
}

function Chip({
  testId,
  icon,
  title,
  detail,
  onClick,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-lg border border-garden-green bg-garden-sage/40 px-3 py-2 text-left hover:bg-garden-sage"
    >
      {icon}
      <span>
        <span className="block text-[11px] font-semibold text-garden-forest">{title}</span>
        <span className="block text-[10px] text-garden-muted">{detail}</span>
      </span>
    </button>
  );
}

function ToolButton({
  testId,
  active,
  onClick,
  children,
}: {
  testId: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={[
        'flex-1 rounded-md border px-2 py-1.5 text-left text-[10px] font-medium transition-colors',
        active
          ? 'border-garden-forest bg-garden-forest text-white'
          : 'border-garden-line bg-white text-garden-ink hover:border-garden-green',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
