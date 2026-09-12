'use client';

import { FEATURE_DEFINITIONS, FEATURE_KINDS, type FeatureKind } from '@/lib/features';
import { useFeaturesStore } from '@/state/features-store';
import { FeatureIcon } from './FeatureIcon';

/**
 * The quick-add grid.
 *
 * One tap arms the canvas, one tap on the plan places a sensible default — no form, no size fields,
 * nothing to fill in before a shed exists. That was already true of the store (`placePointAt` drops
 * a 1.5 m tree, `placeRectangle` drops a default-size shed on a click under the drag threshold);
 * what changed here is the wording, which now says what each thing *is* in the user's terms rather
 * than in the schema's.
 */

/**
 * What the button promises the next click will do, on its `title`.
 *
 * Only a tooltip: once a kind is armed, `FeaturesTipCallout` says the same thing in prose and in
 * the place the eye is already going. Two hints saying one thing is how a sidebar becomes wallpaper.
 */
const GESTURE: Record<string, string> = {
  point: 'Tap to place',
  rect: 'Tap, or drag to size',
  polygon: 'Tap each corner',
  polyline: 'Tap along it',
};

/**
 * Step 2's own wording, which is not always the schema's.
 *
 * `fence` covers a hedge as well: both are linear, both are things a design has to work around, and
 * the schema has no separate hedge kind — so this is a copy decision rather than a model one.
 */
const LABEL: Partial<Record<FeatureKind, string>> = {
  shed: 'Shed or structure',
  patio: 'Patio or decking',
  planting: 'Planting area',
  fence: 'Hedge or fence',
  water: 'Water',
};

export function QuickAddPalette() {
  const placingKind = useFeaturesStore((state) => state.placingKind);
  const mode = useFeaturesStore((state) => state.mode);
  const startPlacing = useFeaturesStore((state) => state.startPlacing);
  const cancelPlacing = useFeaturesStore((state) => state.cancelPlacing);

  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Add features</h2>

      <ul data-testid="feature-palette" className="mt-2 grid grid-cols-3 gap-2">
        {FEATURE_KINDS.map((kind) => {
          const definition = FEATURE_DEFINITIONS[kind];
          const active = mode === 'place' && placingKind === kind;

          return (
            <li key={kind}>
              <button
                type="button"
                data-testid={`palette-${kind}`}
                aria-pressed={active}
                title={GESTURE[definition.placement]}
                onClick={() => (active ? cancelPlacing() : startPlacing(kind))}
                className={[
                  'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
                  active
                    ? 'border-garden-green bg-garden-sage text-garden-forest'
                    : 'border-garden-line bg-white text-garden-ink hover:border-garden-green hover:bg-garden-sage/50',
                ].join(' ')}
              >
                <FeatureIcon kind={kind} className="h-5 w-5" />
                <span className="text-[10px] leading-tight font-medium">
                  {LABEL[kind] ?? definition.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
