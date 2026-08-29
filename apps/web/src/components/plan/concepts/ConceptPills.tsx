'use client';

import {
  BUDGET_BANDS,
  MAINTENANCE_LEVELS,
  type BudgetBand,
  type MaintenanceLevel,
} from '@/lib/brief';

/**
 * The Budget / Maintenance chips that appear on every concept card, in the details panel and
 * across the top of each compare pane.
 *
 * Colour comes from step 3's own catalogues, so "Medium budget" is the same purple-free green
 * here as it was on the card the user picked it from. A second palette for the same idea would
 * make the wizard feel like two applications.
 */

export function BudgetPill({ band, testId }: { band: BudgetBand; testId?: string }) {
  const option = BUDGET_BANDS.find((candidate) => candidate.id === band);

  return (
    <MetaPill
      testId={testId}
      label="Budget"
      value={option?.label ?? band}
      tint={option?.tint}
      accent={option?.accent}
    />
  );
}

export function MaintenancePill({ level, testId }: { level: MaintenanceLevel; testId?: string }) {
  const option = MAINTENANCE_LEVELS.find((candidate) => candidate.id === level);

  return (
    <MetaPill
      testId={testId}
      label="Maintenance"
      // "Low effort" reads oddly after "Maintenance:", so the pill uses the bare band.
      value={option ? option.label.replace(' effort', '') : level}
      tint={option?.tint}
      accent={option?.accent}
    />
  );
}

function MetaPill({
  testId,
  label,
  value,
  tint,
  accent,
}: {
  testId?: string;
  label: string;
  value: string;
  tint?: string;
  accent?: string;
}) {
  return (
    <span
      data-testid={testId}
      style={{ background: tint, color: accent, borderColor: accent }}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
    >
      {label}: {value}
    </span>
  );
}

/** The accent dot beside a value in the details panel's Style / Budget / Maintenance rows. */
export function AccentDot({ colour }: { colour?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: colour }}
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
    />
  );
}
