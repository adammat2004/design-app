'use client';

import { useEffect } from 'react';
import { PencilRuler, Satellite } from 'lucide-react';
import { useBoundaryStore, type MappingMethod } from '@/state/boundary-store';
import { useImageryStore } from '@/state/imagery-store';

/**
 * The first question on step 1: trace the garden over aerial imagery, or build it from
 * measurements. Both answers produce the same `SiteSection`; nothing after this screen can tell
 * which was chosen, and that is the point of it being a choice rather than a mode.
 *
 * The aerial card disables itself when the server has no imagery configured, and says so, the
 * way the chat panel does when the assistant has no key. A card that looked available and then
 * failed on the next screen would be worse than no card.
 */
export function MappingMethodPanel() {
  const setMappingMethod = useBoundaryStore((state) => state.setMappingMethod);
  const status = useImageryStore((state) => state.status);
  const load = useImageryStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const aerialReady = status === 'ready';
  const aerialNote =
    status === 'loading' || status === 'idle'
      ? 'Checking whether aerial imagery is available…'
      : status === 'ready'
        ? 'Search your address, then click round your garden on the photograph.'
        : 'Aerial mapping is not set up on this server.';

  return (
    <section data-testid="mapping-method" className="space-y-3 border-t border-garden-line pt-4">
      <h2 className="text-xs font-semibold text-garden-ink">How would you like to map your garden?</h2>

      <div className="space-y-2">
        <MethodCard
          method="aerial"
          testId="method-aerial"
          title="Find my property"
          detail={aerialNote}
          icon={<Satellite aria-hidden className="h-5 w-5 text-garden-green" />}
          disabled={!aerialReady}
          onChoose={setMappingMethod}
        />
        <MethodCard
          method="manual"
          testId="method-manual"
          title="Enter measurements"
          detail="Start from a rectangle or an L-shape, or draw the corners yourself."
          icon={<PencilRuler aria-hidden className="h-5 w-5 text-garden-green" />}
          onChoose={setMappingMethod}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-garden-muted">
        Either way the plan ends up as the same measured drawing. A traced outline is an estimate
        you can correct side by side; typed measurements are exact.
      </p>
    </section>
  );
}

function MethodCard({
  method,
  testId,
  title,
  detail,
  icon,
  disabled,
  onChoose,
}: {
  method: MappingMethod;
  testId: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onChoose: (method: MappingMethod) => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChoose(method)}
      className={[
        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
        'border-garden-line bg-white hover:border-garden-green',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-garden-line',
      ].join(' ')}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-garden-sage">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-garden-ink">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-garden-muted">{detail}</span>
      </span>
    </button>
  );
}
