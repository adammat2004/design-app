'use client';

import { Check } from 'lucide-react';

/**
 * The single-select card, shared by budget, maintenance and style.
 *
 * Deliberately unlike the multi-select cards next to it: **round badge means one, square tick
 * means many.** Both now sit in the top right, because a card whose artwork runs edge to edge has
 * nowhere else to put one — so the *shape* carries that distinction on its own where it used to
 * have position and border weight helping. Do not round off `SpaceCard`'s tick.
 *
 * A real `<input type="radio">` hidden with `sr-only`, so a group gets native arrow-key
 * navigation and announces itself as a radio group. There is no way to unselect: these three
 * answers gate Continue, so the only move is to choose differently.
 */
export function ChoiceCard({
  testId,
  name,
  checked,
  onSelect,
  label,
  tint,
  accent,
  padded = true,
  children,
}: {
  testId: string;
  /** Groups the radios together; must be unique per question. */
  name: string;
  checked: boolean;
  onSelect: () => void;
  /** The accessible name, since the visible label is arbitrary markup. */
  label: string;
  /** Optional per-option background, applied inline because it is catalogue data. */
  tint?: string;
  /** Border and heading colour once chosen. */
  accent?: string;
  /** Style cards manage their own padding, as the artwork is edge to edge. */
  padded?: boolean;
  children: React.ReactNode;
}) {
  return (
    /*
     * `${testId}-card` on the label as well as `${testId}` on the input, because the two are for
     * different questions. The input is the *state* — what a unit test and a screen reader read.
     * The label is the *target*: the radio is `sr-only`, so a real pointer click (and Playwright's,
     * which refuses an element outside the viewport) can only land here. A browser test that clicked
     * the input would also pass on a day the label stopped wrapping it, which is the one regression
     * worth catching.
     */
    <label
      data-testid={`${testId}-card`}
      data-checked={checked}
      style={{
        background: tint,
        borderColor: checked ? accent : undefined,
      }}
      className={[
        'relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border-2 transition-colors',
        'focus-within:ring-2 focus-within:ring-garden-green',
        padded ? 'p-4' : '',
        checked ? 'border-garden-green shadow-sm' : 'border-garden-line hover:border-garden-green',
      ].join(' ')}
    >
      <input
        type="radio"
        name={name}
        data-testid={testId}
        checked={checked}
        onChange={onSelect}
        aria-label={label}
        className="sr-only"
      />

      <SelectionBadge checked={checked} accent={accent} />
      {children}
    </label>
  );
}

/**
 * The round "one of these" badge, against `SpaceCard`'s square "any of these" tick.
 *
 * `bg-white/75` and a white border when unchecked rather than the line colour: it sits over a
 * photograph now, and a pale grey ring disappears against half the pictures it has to be legible
 * on.
 */
export function SelectionBadge({ checked, accent }: { checked: boolean; accent?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: checked ? (accent ?? undefined) : undefined }}
      className={[
        'absolute top-2.5 right-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors',
        checked
          ? 'border-transparent bg-garden-green text-white'
          : 'border-white/70 bg-white/75 shadow-sm',
      ].join(' ')}
    >
      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}
