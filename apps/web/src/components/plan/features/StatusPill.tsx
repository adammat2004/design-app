'use client';

import { Check, Replace, Trash2 } from 'lucide-react';
import { STATUS_COLOURS } from '@/lib/feature-colours';
import type { FeatureStatus } from '@/lib/features';

const ICONS = { keep: Check, remove: Trash2, replace: Replace };

/** The same badge in the list, on the plan, in the legend and in the Selected object panel. */
export function StatusPill({
  status,
  size = 'sm',
  testId,
}: {
  status: FeatureStatus;
  size?: 'sm' | 'xs';
  testId?: string;
}) {
  const style = STATUS_COLOURS[status];
  const Icon = ICONS[status];

  return (
    <span
      data-testid={testId}
      data-status={status}
      style={{ background: style.tint, color: style.stroke, borderColor: style.stroke }}
      className={[
        'inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap',
        size === 'xs' ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[11px]',
      ].join(' ')}
    >
      <Icon aria-hidden className={size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {style.label}
    </span>
  );
}
