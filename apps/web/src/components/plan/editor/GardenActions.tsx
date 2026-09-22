'use client';

import { Armchair, Leaf, Lightbulb, Sparkles } from 'lucide-react';
import { useAssistantStore } from '@/state/assistant-store';

/**
 * What you can do to the garden as a whole, in the place the property sheet occupies when an
 * element is selected.
 *
 * The garden is a subject like any other, so its inspector has the same shape: header, direct
 * actions, suggestions, composer. There is no "nothing selected" state and no empty form — the
 * things you can do to a whole garden are simply requests, so these are the four most useful ones
 * as rows rather than a paragraph telling the user to type.
 */
const ACTIONS = [
  { id: 'ideas', label: 'Generate ideas', detail: 'for my garden', icon: Lightbulb, text: 'Suggest a few improvements to this garden' },
  { id: 'modern', label: 'Make it more modern', detail: null, icon: Sparkles, text: 'Make the garden more modern' },
  { id: 'planting', label: 'Add more planting', detail: null, icon: Leaf, text: 'Add more planting throughout the garden' },
  { id: 'seating', label: 'Create a seating area', detail: null, icon: Armchair, text: 'Create a seating area' },
] as const;

export function GardenActions({ noKey }: { noKey: boolean }) {
  const send = useAssistantStore((state) => state.send);

  return (
    <div className="px-4 py-3">
      <p className="text-xs leading-relaxed text-garden-muted">
        {noKey
          ? 'Select something on the plan to edit it.'
          : 'Tell the designer what you want, or select something on the plan.'}
      </p>
      {noKey ? null : (
        <ul className="mt-2 -mx-2">
          {ACTIONS.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                data-testid={`garden-action-${action.id}`}
                onClick={() => void send(action.text)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-garden-sage/60 focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-garden-sage/70 text-garden-green">
                  <action.icon aria-hidden className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 text-xs text-garden-ink">
                  <span className="font-medium">{action.label}</span>
                  {action.detail ? <span className="text-garden-muted"> {action.detail}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
