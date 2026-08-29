'use client';

import { Check } from 'lucide-react';
import { DESIRED_FEATURES, DESIRED_FEATURE_OTHER, type DesiredFeature } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { DesiredFeatureIcon } from './BriefIcons';
import { OtherTextField } from './OtherTextField';

/**
 * Section 2, and the only multi-select on the screen.
 *
 * Square tick box on the left, to stay clearly apart from the round badge the single-select
 * cards use on the right. The control is a real `<input type="checkbox">` hidden with
 * `sr-only` inside its `<label>` — the recipe `DesignAreasPanel` uses — so keyboard and
 * screen-reader behaviour comes for free rather than being simulated with `aria-pressed`.
 */
export function DesiredFeaturesGrid() {
  const chosen = useBriefStore((state) => state.present.desiredFeatures);
  const featuresOther = useBriefStore((state) => state.present.featuresOther);
  const toggleFeature = useBriefStore((state) => state.toggleFeature);
  const setFeaturesOther = useBriefStore((state) => state.setFeaturesOther);

  const wantsOther = chosen.includes('other');

  return (
    <div>
      <ul data-testid="desired-features" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DESIRED_FEATURES.map((option) => (
          <li key={option.id}>
            <FeatureChip
              id={option.id}
              label={option.label}
              checked={chosen.includes(option.id)}
              onToggle={() => toggleFeature(option.id)}
            />
          </li>
        ))}
        <li>
          <FeatureChip
            id={DESIRED_FEATURE_OTHER.id}
            label={DESIRED_FEATURE_OTHER.label}
            checked={wantsOther}
            onToggle={() => toggleFeature('other')}
          />
        </li>
      </ul>

      {wantsOther ? (
        <OtherTextField
          testId="desired-features-other"
          label="What else would you like?"
          placeholder="e.g. A hot tub, a bin store, a compost area"
          value={featuresOther}
          onChange={setFeaturesOther}
        />
      ) : null}
    </div>
  );
}

function FeatureChip({
  id,
  label,
  checked,
  onToggle,
}: {
  id: DesiredFeature;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={[
        'flex h-full cursor-pointer items-center gap-2.5 rounded-xl border p-3 transition-colors',
        'focus-within:ring-2 focus-within:ring-garden-green',
        checked
          ? 'border-garden-green bg-garden-sage text-garden-forest'
          : 'border-garden-line bg-white text-garden-ink hover:border-garden-green hover:bg-garden-sage/50',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          checked
            ? 'border-garden-green bg-garden-green text-white'
            : 'border-garden-line bg-white',
        ].join(' ')}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>

      <input
        type="checkbox"
        data-testid={`desired-${id}`}
        checked={checked}
        onChange={onToggle}
        className="sr-only"
      />

      <DesiredFeatureIcon id={id} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 text-xs leading-tight font-medium">{label}</span>
    </label>
  );
}
