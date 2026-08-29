'use client';

import { CATEGORY_COLOURS } from '@/lib/concept-colours';
import type { ElementCategory } from '@/lib/concepts';
import { ADDABLE_CATEGORIES } from '@/lib/element-groups';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { EditorIcon } from './EditorIcon';

/**
 * The palette that adds a new surface to the plan.
 *
 * Same shape as step 2's `FeatureTypePalette`: pick a type, then click the canvas. Clicking the
 * active type again cancels, so there is no way to get stuck in placing mode without a visible
 * way out.
 *
 * `existing-feature` is deliberately not offered — that category means "carried over from step 2",
 * and letting the user create one here would make the word a lie.
 */
export function AddFeaturePalette() {
  const placingCategory = usePlanEditorStore((state) => state.placingCategory);
  const setPlacing = usePlanEditorStore((state) => state.setPlacing);

  return (
    <section>
      <h2 className="text-xs font-semibold text-garden-ink">Add features</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-garden-muted">
        Choose a surface, then click the plan to place it.
      </p>

      <ul data-testid="editor-palette" className="mt-3 grid grid-cols-3 gap-2">
        {ADDABLE_CATEGORIES.map((category) => (
          <li key={category}>
            <PaletteButton
              category={category}
              active={placingCategory === category}
              onClick={() => setPlacing(placingCategory === category ? null : category)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PaletteButton({
  category,
  active,
  onClick,
}: {
  category: ElementCategory;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`palette-${category}`}
      aria-pressed={active}
      title="Click the plan to place it"
      onClick={onClick}
      className={[
        'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition-colors',
        'focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none',
        active
          ? 'border-garden-green bg-garden-sage text-garden-forest'
          : 'border-garden-line bg-white text-garden-ink hover:border-garden-green hover:bg-garden-sage/50',
      ].join(' ')}
    >
      <EditorIcon category={category} className="h-5 w-5" />
      <span className="text-[10px] leading-tight font-medium">
        {CATEGORY_COLOURS[category].label}
      </span>
    </button>
  );
}
