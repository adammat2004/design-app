'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Leaf, X } from 'lucide-react';
import { PLANT_CATALOGUE } from '@garden-studio/schema';
import { CATEGORY_COLOURS, elementLabel } from '@/lib/concept-colours';
import { elementArea, type DesignElement } from '@/lib/concepts';
import type { Subject } from '@/lib/smart-suggestions';
import { formatArea } from '@/lib/units';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import { useAssistantStore, type AgentPhase } from '@/state/assistant-store';
import { useBoundaryStore } from '@/state/boundary-store';
import { selectedElement, usePlanEditorStore } from '@/state/plan-editor-store';
import { AgentActivity } from './AgentActivity';
import { ElementThumbnail } from './ElementThumbnail';
import { GardenActions } from './GardenActions';
import { InspectorComposer } from './InspectorComposer';
import { RecentActivity } from './RecentActivity';
import { SelectedElementPanel } from './SelectedElementPanel';
import { SmartSuggestions } from './SmartSuggestions';
import { WorkingState } from './WorkingState';

const GARDEN: Subject = { kind: 'garden' };

/**
 * The right column of the editor: one inspector whose subject is whatever is selected.
 *
 * One subject, three ways to change it. The header names the thing — a patio, a bed, or the garden
 * — and everything under it is something you can do to that thing: the precise verbs (material,
 * size), the recommended ones (smart suggestions), and the imprecise one (a sentence). They are
 * drawn as one surface with hairline dividers, never as a form with a chat under it, because to the
 * user they are not two features; they are three handles on the same object.
 *
 * Layout is header, one scrolling body, pinned footer. The sheet used to have its own capped
 * scroller and the transcript another, and the seam between them was the seam between the two
 * products this column used to be.
 *
 * While the designer has the plan the same header stays and the body says what is being done to the
 * subject and how far along it is. The inspector does not become an AI panel for the length of a
 * run; the patio's inspector shows that the patio is being changed.
 */
export function EditorInspector() {
  const focus = usePlanEditorStore(selectedElement);
  const phase = useAssistantStore((state) => state.phase);
  const available = useAssistantStore((state) => state.available);
  const probeAvailability = useAssistantStore((state) => state.probeAvailability);
  const messages = useAssistantStore((state) => state.messages);
  const runActive = useAiRunStore(selectRunActive);

  const busy = phase !== 'idle' || runActive;
  const noKey = available === false;

  /* Asked once, so the no-key state can be shown before somebody types and waits for a failure. */
  useEffect(() => {
    void probeAvailability();
  }, [probeAvailability]);

  /*
   * Nothing is claimed about the selection while a run is on. The run drives `selectedId` itself —
   * that is how the canvas follows the work — so a subject read off it would look like the user's
   * own context while it is really the designer's cursor. The subject of a live request is what the
   * request was *about*, captured when it was sent.
   */
  const subject: Subject = useMemo(
    () => (focus && !busy ? { kind: 'element', element: focus } : GARDEN),
    [focus, busy],
  );

  const bodyRef = useRef<HTMLDivElement>(null);

  /* A new subject starts at the top of its own inspector. */
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = 0;
  }, [focus?.id]);

  /*
   * A finished request ends on its outcome. The record sits under the controls and the
   * suggestions, and Compare and Undo are the two things somebody wants the moment the run
   * stops — scrolled off the bottom they would look like the product had nothing to say about it.
   */
  const hadMessages = messages.length > 0;
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = busy ? 0 : hadMessages ? body.scrollHeight : 0;
  }, [busy, hadMessages]);

  return (
    <section
      data-testid="inspector"
      data-busy={busy}
      className="flex min-h-0 flex-col bg-white lg:h-0 lg:flex-1"
    >
      {/*
        The one announcement a screen reader gets.

        The stage list changes several times a second and is silenced. What is worth saying out loud
        is the phase and the outcome — which is what this carries, and nothing else.
      */}
      <p className="sr-only" role="status" data-testid="agent-status">
        {phase === 'thinking'
          ? 'The designer is reading the plan.'
          : phase === 'performing'
            ? 'The designer is changing the garden.'
            : phase === 'reviewing'
              ? 'The designer is reviewing its work.'
              : lastOutcomeText(messages)}
      </p>

      {busy ? (
        <WorkingHeader phase={phase} />
      ) : focus ? (
        <ElementHeader focus={focus} />
      ) : (
        <GardenHeader />
      )}

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto lg:min-h-0">
        {busy ? <WorkingState /> : focus ? <SelectedElementPanel /> : <GardenActions noKey={noKey} />}

        {/*
          Mounted always, hidden when idle: `ai-activity-panel` carries the run's final state
          (complete, stopped) after the work is over, and a block that unmounted with the phase
          could not answer "it was stopped".
        */}
        <AgentActivity phase={phase} />

        <SmartSuggestions subject={subject} dimmed={busy} />

        {busy ? null : <RecentActivity />}
      </div>

      <InspectorComposer subject={subject} busy={busy} noKey={noKey} />
    </section>
  );
}

/* ------------------------------------------------------------------ headers */

const headerClass = 'flex shrink-0 items-center gap-3 border-b border-garden-line px-4 py-3';

function ElementHeader({ focus }: { focus: DesignElement }) {
  const unit = useBoundaryStore((state) => state.unit);
  const species = focus.plantId ? PLANT_CATALOGUE[focus.plantId] : undefined;
  const label = elementLabel(focus);

  return (
    <header data-testid="agent-focus" className={headerClass}>
      <ElementThumbnail element={focus} />
      <div className="min-w-0 flex-1">
        <NameField
          key={focus.id}
          name={focus.name ?? CATEGORY_COLOURS[focus.category].label}
          onCommit={(name) => usePlanEditorStore.getState().renameElement(focus.id, name)}
        />
        <p className="mt-0.5 truncate text-xs text-garden-muted">
          <span data-testid="element-category">
            {species?.botanicalName ?? CATEGORY_COLOURS[focus.category].label}
          </span>
          {' · '}
          <span data-testid="element-area" className="tabular-nums">
            {formatArea(elementArea(focus), unit)}
          </span>
        </p>
      </div>
      <button
        type="button"
        data-testid="agent-focus-clear"
        onClick={() => usePlanEditorStore.getState().select(null)}
        aria-label={`Stop talking about ${label}`}
        className="relative shrink-0 rounded-full p-1.5 text-garden-muted transition-colors before:absolute before:inset-0 before:-m-1.5 before:content-[''] hover:bg-garden-sage hover:text-garden-ink focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </header>
  );
}

function GardenHeader() {
  return (
    <header className={headerClass}>
      <GardenMark />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-garden-ink">Garden</h2>
        <p className="mt-0.5 text-xs text-garden-muted">Your outdoor space</p>
      </div>
    </header>
  );
}

/**
 * The same header, for the subject of the request being worked on.
 *
 * The subject is what the newest request was *about* — the label captured when it was sent — never
 * `selectedId`, which the run is driving. Where the element still exists its thumbnail is shown;
 * where the request named nothing, the subject is the garden.
 */
function WorkingHeader({ phase }: { phase: AgentPhase }) {
  const about = useAssistantStore((state) => {
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      const message = state.messages[i]!;
      if (message.role === 'user') return message.about;
    }
    return null;
  });
  const element = usePlanEditorStore((state) =>
    about ? (state.present.elements.find((item) => item.id === about.id) ?? null) : null,
  );

  const doing =
    phase === 'thinking' ? 'Reading the plan…' : phase === 'reviewing' ? 'Reviewing…' : 'Updating…';

  return (
    <header data-testid="inspector-working" className={headerClass}>
      {element ? <ElementThumbnail element={element} /> : <GardenMark />}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-garden-ink">{about?.label ?? 'Garden'}</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-garden-muted">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-garden-ai" />
          {doing}
        </p>
      </div>
    </header>
  );
}

function GardenMark() {
  return (
    <span
      aria-hidden
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-garden-line bg-garden-sage/60 text-garden-green"
    >
      <Leaf className="h-6 w-6" strokeWidth={1.5} />
    </span>
  );
}

function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(name);
  const focused = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(name);
  }, [name]);

  return (
    <input
      data-testid="element-name"
      aria-label="Feature name"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        if (text.trim() === '') setText(name);
        else onCommit(text);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelled.current = true;
          setText(name);
          event.currentTarget.blur();
        }
      }}
      className="-mx-1 w-full min-w-0 rounded-md border border-transparent px-1 py-0.5 text-sm font-semibold text-garden-ink hover:border-garden-line focus-visible:border-garden-green focus-visible:outline-none"
    />
  );
}

/** What the last finished request ended up doing, for the status region to announce. */
function lastOutcomeText(messages: ReturnType<typeof useAssistantStore.getState>['messages']): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== 'assistant') continue;
    if (message.status === 'failed') return message.text;
    if (message.outcome) return message.outcome.text;
  }
  return '';
}
