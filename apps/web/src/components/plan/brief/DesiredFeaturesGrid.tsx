'use client';

import { SquarePen } from 'lucide-react';
import { DESIRED_FEATURES, DESIRED_FEATURE_OTHER } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { OtherTextField } from './OtherTextField';
import { SpaceCard } from './SpaceCard';

/**
 * The garden spaces, as a grid of pictures.
 *
 * Nothing about any individual space is written here: the grid maps over `DESIRED_FEATURES` and a
 * new one is a row in that catalogue, not a card in this file. That is what keeps sixteen options
 * from becoming sixteen pieces of markup that can drift apart.
 *
 * Four across on a desktop, which is what makes the artwork big enough to read — the old chips
 * were three across at `text-xs` and the icon on them was 16 px. Two across on a phone rather than
 * one: a single-column list of photographs is a very long scroll, and at two the pictures are
 * still comfortably legible.
 */
export function DesiredFeaturesGrid() {
  const chosen = useBriefStore((state) => state.present.desiredFeatures);
  const featuresOther = useBriefStore((state) => state.present.featuresOther);
  const toggleFeature = useBriefStore((state) => state.toggleFeature);
  const setFeaturesOther = useBriefStore((state) => state.setFeaturesOther);

  const wantsOther = chosen.includes('other');

  return (
    <div>
      <ul
        data-testid="desired-features"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
      >
        {DESIRED_FEATURES.map((option) => (
          <li key={option.id}>
            <SpaceCard
              option={option}
              checked={chosen.includes(option.id)}
              onToggle={() => toggleFeature(option.id)}
            />
          </li>
        ))}

        <li>
          <SomethingElseCard checked={wantsOther} onToggle={() => toggleFeature('other')} />
        </li>
      </ul>

      {wantsOther ? (
        <OtherTextField
          testId="desired-features-other"
          label="What else would you like?"
          placeholder="e.g. A bin store, a compost area, a sauna"
          value={featuresOther}
          onChange={setFeaturesOther}
        />
      ) : null}
    </div>
  );
}

/**
 * The escape hatch, and the reason it is dashed and last.
 *
 * The grid is deliberately the common, high-value spaces — a catalogue of every garden feature
 * anybody has ever wanted would bury the twelve that matter. This is where the rest goes, and it
 * looks like a blank rather than a picture because there is no photograph of "something else".
 * Dashed and empty is the honest drawing of an open question.
 */
function SomethingElseCard({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <label
      data-testid="space-card-other"
      data-checked={checked}
      className={[
        'flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border-2 border-dashed',
        'transition-colors focus-within:ring-2 focus-within:ring-garden-green focus-within:ring-offset-1',
        checked
          ? 'border-garden-green bg-garden-sage/60'
          : 'border-garden-line bg-white hover:border-garden-green/50',
      ].join(' ')}
    >
      <input
        type="checkbox"
        data-testid="desired-other"
        checked={checked}
        onChange={onToggle}
        aria-label={DESIRED_FEATURE_OTHER.label}
        className="sr-only"
      />

      <span className="flex aspect-4/3 w-full items-center justify-center">
        <SquarePen aria-hidden className="h-6 w-6 text-garden-muted" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-sm leading-tight font-semibold text-garden-ink">
          {DESIRED_FEATURE_OTHER.label}
        </span>
        <span className="text-xs leading-snug text-garden-muted">
          {DESIRED_FEATURE_OTHER.description}
        </span>
      </span>
    </label>
  );
}
