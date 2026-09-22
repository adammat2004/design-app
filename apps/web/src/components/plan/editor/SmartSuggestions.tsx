'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Check, ChevronRight, Leaf, Sparkles, Sun } from 'lucide-react';
import { briefArtFile } from '@/lib/brief-art';
import {
  suggestionsFor,
  type SmartSuggestion,
  type Subject,
  type SuggestionArt,
} from '@/lib/smart-suggestions';
import { useAssistantStore } from '@/state/assistant-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';
import { CatalogueThumbnail } from './CatalogueThumbnail';
import { Caption } from './Pill';

/**
 * The bridge between the property sheet and the composer.
 *
 * Above this section are the precise verbs (a select, two lengths); below it is the imprecise one
 * (a sentence). This is the middle: recommended actions on the same subject, drawn as one list
 * whether an entry edits a field directly or sends a request. See `smart-suggestions.ts` for why
 * the distinction is deliberately invisible.
 *
 * Request-kind entries are dropped when there is no key, rather than rendered disabled: a card that
 * looks available and does nothing is the fault this codebase keeps catching.
 */
export function SmartSuggestions({ subject, dimmed = false }: { subject: Subject; dimmed?: boolean }) {
  const elements = usePlanEditorStore((state) => state.present.elements);
  const available = useAssistantStore((state) => state.available);
  const send = useAssistantStore((state) => state.send);
  const reviewDesign = useAssistantStore((state) => state.reviewDesign);

  const items = useMemo(() => {
    const all = suggestionsFor(subject, { elements });
    return available === false ? all.filter((item) => item.action.kind !== 'request') : all;
  }, [subject, elements, available]);

  if (items.length === 0) return null;

  function perform(item: SmartSuggestion) {
    if (dimmed) return;
    switch (item.action.kind) {
      case 'material':
        if (subject.kind === 'element') {
          usePlanEditorStore.getState().setMaterial(subject.element.id, item.action.material);
        }
        return;
      case 'request':
        void send(item.action.text);
        return;
      case 'review':
        void reviewDesign();
        return;
    }
  }

  return (
    <section
      data-testid="smart-suggestions"
      aria-label="Smart suggestions"
      className={`border-t border-garden-line px-4 py-3 ${dimmed ? 'opacity-50' : ''}`}
    >
      <Caption>Smart suggestions</Caption>
      <ul className="mt-1.5 -mx-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-testid={`smart-suggestion-${item.id}`}
              data-action={item.action.kind}
              disabled={dimmed}
              onClick={() => perform(item)}
              className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-garden-sage/60 focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
            >
              <SuggestionArtwork art={item.art} title={item.title} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-garden-ink">{item.title}</span>
                <span className="block truncate text-[11px] text-garden-muted">{item.detail}</span>
              </span>
              <ChevronRight
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 text-garden-muted/70 transition-colors group-hover:text-garden-ink"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ICONS = { sparkles: Sparkles, leaf: Leaf, sun: Sun, check: Check } as const;

/**
 * Forty pixels of picture. A brief vignette where one fits the action, the catalogue's own
 * thumbnail for a material, an icon otherwise — and a missing file falls back to the icon, the same
 * guarantee `SpaceCard` gives the brief.
 */
function SuggestionArtwork({ art, title }: { art: SuggestionArt; title: string }) {
  const [failed, setFailed] = useState(false);
  const frame = 'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-garden-sage/50';

  if (art.kind === 'material') {
    return (
      <span className={`${frame} p-0.5`} aria-hidden>
        <CatalogueThumbnail element={{ category: art.category, material: art.material }} />
      </span>
    );
  }

  if (art.kind === 'brief' && !failed) {
    return (
      <span className={frame} aria-hidden>
        <Image
          unoptimized
          src={briefArtFile(art.id)}
          alt={title}
          width={80}
          height={80}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  const Icon = ICONS[art.kind === 'icon' ? art.icon : 'sparkles'];
  return (
    <span className={frame} aria-hidden>
      <Icon className="h-4 w-4 text-garden-green/80" />
    </span>
  );
}
