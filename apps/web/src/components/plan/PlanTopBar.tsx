'use client';

import { Bell, ChevronDown, CircleQuestionMark, Leaf } from 'lucide-react';
import { useBoundaryStore } from '@/state/boundary-store';
import { StepIndicator } from './StepIndicator';

export function PlanTopBar({ currentStep }: { currentStep: number }) {
  const projectName = useBoundaryStore((state) => state.projectName);

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-garden-line bg-white px-4 py-3 lg:px-6">
      <div className="flex items-center gap-2">
        <Leaf aria-hidden className="h-6 w-6 text-garden-green" />
        <div className="leading-tight">
          <p className="text-base font-semibold text-garden-forest">Garden Studio</p>
          <p className="text-[10px] tracking-[0.14em] text-garden-muted uppercase">
            Design your garden
          </p>
        </div>
      </div>

      <div className="hidden border-l border-garden-line pl-6 lg:block">
        <p className="text-[10px] tracking-wide text-garden-muted uppercase">Project</p>
        <p data-testid="project-name" className="text-sm font-medium text-garden-ink">
          {projectName}
        </p>
      </div>

      <div className="order-last w-full sm:order-none sm:mx-auto sm:w-auto">
        <StepIndicator current={currentStep} />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <IconButton label="Help">
          <CircleQuestionMark aria-hidden className="h-5 w-5" />
        </IconButton>
        <IconButton label="Notifications">
          <Bell aria-hidden className="h-5 w-5" />
        </IconButton>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-garden-sage text-xs font-semibold text-garden-forest">
          GS
        </span>
        <ChevronDown aria-hidden className="h-4 w-4 text-garden-muted" />
      </div>
    </header>
  );
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-full p-2 text-garden-muted hover:bg-garden-sage hover:text-garden-forest focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
    >
      {children}
    </button>
  );
}
