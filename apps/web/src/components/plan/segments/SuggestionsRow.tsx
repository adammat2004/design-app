'use client';

import { DoorOpen, Fence, Footprints } from 'lucide-react';
import {
  frontDoor,
  gardenDirection,
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
 * The property details that matter to the design, offered one tap at a time.
 *
 * Where you step out of the house decides where the terrace goes; which fence the gate is in
 * decides where the bins, the shed and the side path go; which fence faces the street decides
 * what the front garden is for. The generator reads all four, and each one is a fact the user can
 * state by clicking a side or a wall on the plan — these chips are the shortcut for the common
 * case, and each disappears once its fact is stated.
 *
 * Every inference is **offered, not applied** — the rule the patio-door chip set. A wrong silent
 * gate has the shed built confidently beside a fence the user never said had a way through. One
 * tap turns a guess into a statement, and the plan draws the result at once.
 *
 * This is what remains of the Access sub-step. The rest of it — placing a gate on a chosen fence,
 * naming the street side, what each side is made of — lives on the side and wall editors, where
 * the thing being described is the thing that was clicked.
 */
export function SuggestionsRow() {
  const draft = useBoundaryStore((state) => state.present);
  const unit = useBoundaryStore((state) => state.unit);
  const addOpening = useBoundaryStore((state) => state.addOpening);
  const addSuggestedGate = useBoundaryStore((state) => state.addSuggestedGate);
  const setSuggestedStreetEdge = useBoundaryStore((state) => state.setSuggestedStreetEdge);

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

  const anything = patioFits || frontFits || streetSuggestion !== null || gateSuggestion !== null;

  return (
    <section data-testid="suggestions-row" className="space-y-2">
      <div>
        <h2 className="text-xs font-semibold text-garden-ink">Property details</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
          Add the details that matter to your garden design. Click a side of the plot or a wall of
          the house to describe it — or take a suggestion.
        </p>
      </div>

      <p data-testid="property-status" className="text-[10px] text-garden-muted">
        <span data-testid="doors-status">
          {backDoor
            ? `Garden door: ${formatLength(backDoor.width, unit)} wide`
            : 'No door onto the garden yet'}
          {front ? ' · front door placed' : ''}
        </span>
        {' · '}
        <span data-testid="street-status">
          {street ? 'Street side chosen' : 'Street side not chosen'}
        </span>
        {' · '}
        <span data-testid="gates-count">
          {gates.length === 0
            ? 'No gate'
            : `${gates.length} ${gates.length === 1 ? 'gate' : 'gates'}`}
        </span>
      </p>

      {anything ? (
        <div className="space-y-1.5">
          {patioFits ? (
            <Chip
              testId="suggest-patio-door"
              icon={<DoorOpen aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />}
              title="Add patio doors on the garden-facing wall"
              detail={`Centred on the back wall, ${formatLength(OPENING_DEFAULTS['patio-door'].width, unit)} wide. Move them after.`}
              onClick={() => addOpening(patioWall!, 'patio-door')}
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

          {streetSuggestion ? (
            <Chip
              testId="suggest-street-edge"
              icon={
                <Footprints aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />
              }
              title="The street is in front of the house"
              detail="Takes the side the house faces. Or click a side on the plan instead."
              onClick={setSuggestedStreetEdge}
            />
          ) : null}

          {gateSuggestion ? (
            <Chip
              testId="suggest-side-gate"
              icon={<Fence aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-garden-green" />}
              title="Add a side gate beside the house"
              detail={`On the wider side return, just behind the back wall — ${formatLength(OPENING_DEFAULTS['back-door'].width, unit)} wide. Or click a side on the plan.`}
              onClick={addSuggestedGate}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
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
