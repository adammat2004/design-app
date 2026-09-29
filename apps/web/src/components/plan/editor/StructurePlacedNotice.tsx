'use client';

import { useEffect, useState } from 'react';
import { Box, X } from 'lucide-react';
import { structureDefinitionFor } from '@garden-studio/schema';
import { usePlanEditorStore, type PlanEditorState } from '@/state/plan-editor-store';

type Snapshot = Pick<PlanEditorState, 'placingSymbol' | 'selectedId' | 'present'>;

/**
 * The structure a palette placement has just put down, if it opens in 3D.
 *
 * Read off the transition `addElement` makes — a symbol was armed, then it is not, and the
 * selection has moved to what it placed — rather than off a flag the store would have to remember
 * and reset. An AI run or a hydration adds elements too, and neither arms a symbol,
 * so neither offers anything.
 */
export function placedStructure(
  previous: Snapshot,
  next: Snapshot,
): { id: string; label: string } | null {
  if (previous.placingSymbol === null || next.placingSymbol !== null) return null;
  const id = next.selectedId;
  // Not "absent from `previous`": `addElement` commits the element and then selects it in a second
  // `set`, so by the transition that disarms the symbol the element is already in the plan.
  if (!id || id === previous.selectedId) return null;
  const element = next.present.elements.find((candidate) => candidate.id === id);
  const definition = element ? structureDefinitionFor(element) : null;
  return element && definition ? { id, label: element.name ?? definition.label } : null;
}

/** How long the offer stays before it gets out of the way on its own. */
const OFFER_MS = 8000;

/**
 * "Pergola added · Configure in 3D": the way into the 3D editor at the moment somebody has just
 * placed the thing it edits. Not an automatic jump — most placements are followed by a drag into
 * position, which is a plan job — and never shown for something with no 3D editor, because an
 * offer that leads nowhere is a control that does nothing.
 */
export function StructurePlacedNotice() {
  const [offer, setOffer] = useState<{ id: string; label: string } | null>(null);
  const open = usePlanEditorStore((state) => state.openStructureEdit);
  // The offer is about the thing selected; select something else, or Undo it away, and it is gone.
  const stillThere = usePlanEditorStore(
    (state) =>
      offer !== null &&
      state.selectedId === offer.id &&
      state.present.elements.some((element) => element.id === offer.id),
  );

  useEffect(
    () =>
      usePlanEditorStore.subscribe((next, previous) => {
        const placed = placedStructure(previous, next);
        if (placed) setOffer(placed);
      }),
    [],
  );

  useEffect(() => {
    if (!offer) return;
    const timer = window.setTimeout(() => setOffer(null), OFFER_MS);
    return () => window.clearTimeout(timer);
  }, [offer]);

  if (!offer || !stillThere) return null;

  return (
    <div
      role="status"
      data-testid="structure-placed-notice"
      className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-garden-line bg-white/95 py-1 pr-1 pl-3 text-xs text-garden-ink shadow-sm backdrop-blur"
    >
      <span className="whitespace-nowrap">{offer.label} added</span>
      <button
        type="button"
        data-testid="structure-placed-configure"
        onClick={() => {
          open(offer.id);
          setOffer(null);
        }}
        className="flex min-h-8 items-center gap-1.5 rounded-full bg-garden-forest px-3 py-1 font-semibold whitespace-nowrap text-white hover:bg-garden-green"
      >
        <Box aria-hidden className="h-3.5 w-3.5" />
        Configure in 3D
      </button>
      <button
        type="button"
        data-testid="structure-placed-dismiss"
        aria-label="Dismiss"
        onClick={() => setOffer(null)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-garden-muted hover:bg-garden-sage hover:text-garden-ink"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
