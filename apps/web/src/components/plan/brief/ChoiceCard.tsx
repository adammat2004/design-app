'use client';

import { Check } from 'lucide-react';

/**
 * The single-select card, shared by budget, maintenance and style.
 *
 * Deliberately unlike the multi-select chips next to it: **square indicator on the left means
 * many, round badge on the right means one.** Reinforced by the border weight — `border` on
 * chips, `border-2` here.
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
    <label
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

/** The round "one of these" badge. Pinned top-right, opposite the chips' square tick. */
export function SelectionBadge({ checked, accent }: { checked: boolean; accent?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: checked ? (accent ?? undefined) : undefined }}
      className={[
        'absolute top-2.5 right-2.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
        checked
          ? 'border-transparent bg-garden-green text-white'
          : 'border-garden-line bg-white/80',
      ].join(' ')}
    >
      {checked ? <Check className="h-3 w-3" /> : null}
    </span>
  );
}
