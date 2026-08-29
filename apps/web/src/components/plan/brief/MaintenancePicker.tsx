'use client';

import { MAINTENANCE_LEVELS } from '@/lib/brief';
import { useBriefStore } from '@/state/brief-store';
import { MaintenanceIcon } from './BriefIcons';
import { ChoiceCard } from './ChoiceCard';

/**
 * Section 4. Same card as budget, but the tint sits on the icon tile rather than the whole
 * card — three levels of effort is a scale, not four price bands, and a full-bleed red would
 * read as a warning.
 */
export function MaintenancePicker() {
  const maintenance = useBriefStore((state) => state.present.maintenance);
  const setMaintenance = useBriefStore((state) => state.setMaintenance);

  return (
    <ul
      role="radiogroup"
      aria-label="Maintenance preference"
      data-testid="maintenance-levels"
      className="grid grid-cols-3 gap-2.5"
    >
      {MAINTENANCE_LEVELS.map((level) => {
        const chosen = maintenance === level.id;

        return (
          <li key={level.id}>
            <ChoiceCard
              testId={`maintenance-${level.id}`}
              name="maintenance"
              label={level.label}
              checked={chosen}
              onSelect={() => setMaintenance(level.id)}
              accent={level.accent}
            >
              <span
                style={{ background: level.tint, color: level.accent }}
                className="flex h-8 w-8 items-center justify-center rounded-lg"
              >
                <MaintenanceIcon id={level.id} className="h-4 w-4" />
              </span>
              <span
                style={{ color: chosen ? level.accent : undefined }}
                className="mt-2 text-xs leading-tight font-semibold text-garden-ink"
              >
                {level.label}
              </span>
            </ChoiceCard>
          </li>
        );
      })}
    </ul>
  );
}
