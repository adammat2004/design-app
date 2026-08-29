'use client';

import { FEATURE_DEFINITIONS, FEATURE_KINDS, type FeatureKind } from '@/lib/features';
import { useFeaturesStore } from '@/state/features-store';
import { FeatureIcon } from './FeatureIcon';

const PLACEMENT_HINT: Record<string, string> = {
  point: 'Click to place',
  rect: 'Drag out a rectangle',
  polygon: 'Click each corner',
  polyline: 'Click along its route',
};

/**
 * The nine things a garden already has. Picking one arms the canvas; how it then gets drawn
 * depends on the type, which is why each button carries its own hint.
 */
export function FeatureTypePalette() {
  const placingKind = useFeaturesStore((state) => state.placingKind);
  const startPlacing = useFeaturesStore((state) => state.startPlacing);
  const cancelPlacing = useFeaturesStore((state) => state.cancelPlacing);

  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Add existing feature</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
        Choose a feature type, then click or drag on the plan to place it.
      </p>

      <ul data-testid="feature-palette" className="mt-3 grid grid-cols-3 gap-2">
        {FEATURE_KINDS.map((kind) => (
          <li key={kind}>
            <PaletteButton
              kind={kind}
              active={placingKind === kind}
              onClick={() => (placingKind === kind ? cancelPlacing() : startPlacing(kind))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PaletteButton({
  kind,
  active,
  onClick,
}: {
  kind: FeatureKind;
  active: boolean;
  onClick: () => void;
}) {
  const definition = FEATURE_DEFINITIONS[kind];

  return (
    <button
      type="button"
      data-testid={`palette-${kind}`}
      aria-pressed={active}
      title={PLACEMENT_HINT[definition.placement]}
      onClick={onClick}
      className={[
        'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition-colors',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        active
          ? 'border-garden-green bg-garden-sage text-garden-forest'
          : 'border-garden-line bg-white text-garden-ink hover:border-garden-green hover:bg-garden-sage/50',
      ].join(' ')}
    >
      <FeatureIcon kind={kind} className="h-5 w-5" />
      <span className="text-[10px] leading-tight font-medium">{definition.label}</span>
    </button>
  );
}
