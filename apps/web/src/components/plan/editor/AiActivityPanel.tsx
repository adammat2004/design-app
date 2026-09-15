'use client';

import { useState } from 'react';
import {
  Columns2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  SquareChevronRight,
  Undo2,
  X,
} from 'lucide-react';
import type { AgentRole, RunPhase } from '@garden-studio/schema';
import { buildDemoRun } from '@/lib/ai-run/demo-script';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import { useBoundaryStore } from '@/state/boundary-store';
import { usePlanEditorStore } from '@/state/plan-editor-store';

/**
 * Who is working on the garden, and what they are doing to it.
 *
 * Deliberately a list of stages and one sentence per designer — not a conversation. Agents talking
 * to each other on screen is theatre: it invents a process the code does not have, and it competes
 * with the canvas, which is the thing actually worth watching. Everything here is read off the
 * operation the executor is running, so the panel cannot claim work the plan did not receive.
 */

const AGENTS: { role: AgentRole; name: string; phase: RunPhase }[] = [
  { role: 'lead', name: 'Lead designer', phase: 'analyse' },
  { role: 'layout', name: 'Layout designer', phase: 'layout' },
  { role: 'circulation', name: 'Circulation designer', phase: 'circulation' },
  { role: 'planting', name: 'Planting designer', phase: 'planting' },
  { role: 'reviewer', name: 'Design reviewer', phase: 'review' },
];

const STAGES: { phase: RunPhase; label: string }[] = [
  { phase: 'analyse', label: 'Analyse' },
  { phase: 'layout', label: 'Layout' },
  { phase: 'circulation', label: 'Circulation' },
  { phase: 'planting', label: 'Planting' },
  { phase: 'review', label: 'Review' },
];

/** The demonstration is a development tool, not a feature. See `buildDemoRun`. */
function demoAllowed(): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('aiDemo');
}

export function AiActivityPanel() {
  const status = useAiRunStore((state) => state.status);
  const active = useAiRunStore(selectRunActive);
  const frame = useAiRunStore((state) => state.frame);
  const revision = useAiRunStore((state) => state.revision);
  const refused = useAiRunStore((state) => state.refused);
  const comparing = useAiRunStore((state) => state.compare === 'before');
  const blocked = useAiRunStore((state) => state.blocked);

  const elements = usePlanEditorStore((state) => state.present.elements);
  const site = useBoundaryStore((state) => state.present);
  const [showDemo] = useState(demoAllowed);

  /** Undo only while the redesign is still exactly what is on the plan. */
  const undoable = useAiRunStore(
    (state) => state.revision !== null && state.revision.result === elements,
  );

  /* A find over five entries, computed rather than memoised: the memo cost more than the work. */
  const phase = frame?.phase ?? null;
  const reached = phase === null ? -1 : STAGES.findIndex((stage) => stage.phase === phase);

  function stageState(index: number): 'done' | 'current' | 'upcoming' {
    if (status === 'complete' && !active) return 'done';
    if (index < reached) return 'done';
    return index === reached ? 'current' : 'upcoming';
  }

  function agentState(agent: (typeof AGENTS)[number]): 'active' | 'done' | 'waiting' {
    if (!active) return status === 'complete' ? 'done' : 'waiting';
    if (frame?.agent === agent.role) return 'active';
    const index = STAGES.findIndex((stage) => stage.phase === agent.phase);
    return index < reached ? 'done' : 'waiting';
  }

  function runDemo() {
    const built = buildDemoRun(elements, site);
    if (!built.ok) {
      useAiRunStore.setState({ blocked: built.reason });
      return;
    }
    useAiRunStore.getState().start(built.run);
  }

  return (
    <section
      data-testid="ai-activity-panel"
      data-status={status}
      className="rounded-xl border border-garden-line bg-white p-4 shadow-sm"
    >
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-garden-muted uppercase">
        <Sparkles aria-hidden className="h-3.5 w-3.5" />
        AI designer
      </h2>

      {!active && status !== 'complete' ? (
        <p className="mt-2 text-sm text-garden-muted">
          Watch a team of designers work on this plan. You keep every change they make, and can undo
          the lot in one go.
        </p>
      ) : null}

      {showDemo && !active ? (
        <button
          type="button"
          data-testid="ai-demo-run"
          onClick={runDemo}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-garden-forest px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-garden-green focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
        >
          <Sparkles aria-hidden className="h-4 w-4" />
          {status === 'complete' ? 'Run the redesign again' : 'Demo AI redesign'}
        </button>
      ) : null}

      {blocked && !active ? (
        <p data-testid="ai-blocked" role="status" className="mt-3 text-sm text-garden-warn">
          {blocked}
        </p>
      ) : null}

      {/* ---- the stages, while there is something to narrate ---- */}
      {active || status === 'complete' ? (
        <ol className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5" data-testid="ai-stages">
          {STAGES.map((stage, index) => {
            const state = stageState(index);
            return (
              <li
                key={stage.phase}
                data-testid={`ai-stage-${stage.phase}`}
                data-state={state}
                className={`flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase ${
                  state === 'current'
                    ? 'text-garden-forest'
                    : state === 'done'
                      ? 'text-garden-muted'
                      : 'text-garden-muted/45'
                }`}
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-[1px] border ${
                    state === 'current'
                      ? 'border-garden-forest bg-garden-forest'
                      : state === 'done'
                        ? 'border-garden-muted bg-garden-muted'
                        : 'border-garden-muted/50'
                  }`}
                />
                {stage.label}
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* ---- who is working ---- */}
      {active || status === 'complete' ? (
        <ul className="mt-4 divide-y divide-garden-line border-t border-garden-line">
          {AGENTS.map((agent) => {
            const state = agentState(agent);
            return (
              <li
                key={agent.role}
                data-testid={`ai-agent-${agent.role}`}
                data-state={state}
                className={`flex gap-3 py-2 ${state === 'waiting' ? 'opacity-45' : ''}`}
              >
                <span
                  aria-hidden
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-[1px] border ${
                    state === 'active'
                      ? 'border-garden-forest bg-garden-forest'
                      : state === 'done'
                        ? 'border-garden-muted bg-garden-muted'
                        : 'border-garden-muted/50'
                  }`}
                />
                <span className="min-w-0">
                  <span
                    className={`block text-sm ${state === 'active' ? 'font-semibold text-garden-ink' : 'text-garden-ink'}`}
                  >
                    {agent.name}
                  </span>
                  <span className="block truncate text-xs text-garden-muted">
                    {state === 'active'
                      ? (frame?.status ?? frame?.chip ?? 'Working')
                      : state === 'done'
                        ? 'Done'
                        : 'Waiting'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* ---- the controls that matter while it runs ---- */}
      {active ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <PanelButton
            testId="ai-stop"
            onClick={() => useAiRunStore.getState().cancel()}
            icon={<X aria-hidden className="h-3.5 w-3.5" />}
            label="Stop"
          />
          <PanelButton
            testId="ai-skip"
            onClick={() => useAiRunStore.getState().skipToEnd()}
            icon={<SquareChevronRight aria-hidden className="h-3.5 w-3.5" />}
            label="Skip animation"
          />
          <PanelButton
            testId="ai-pause"
            onClick={() =>
              status === 'paused'
                ? useAiRunStore.getState().resume()
                : useAiRunStore.getState().pause()
            }
            icon={
              status === 'paused' ? (
                <Play aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Pause aria-hidden className="h-3.5 w-3.5" />
              )
            }
            label={status === 'paused' ? 'Resume' : 'Pause'}
          />
        </div>
      ) : null}

      {/* ---- what it did, and what you can do about it ---- */}
      {!active && revision ? (
        <div className="mt-4 border-t border-garden-line pt-3" data-testid="ai-result">
          {revision.summary ? (
            <p className="text-sm text-garden-ink">{revision.summary}</p>
          ) : null}

          {refused.length > 0 ? (
            <ul className="mt-2 space-y-1" data-testid="ai-refused">
              {refused.map((entry) => (
                <li key={entry.operationId} className="text-xs text-garden-warn">
                  {entry.label}: {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <PanelButton
              testId="ai-compare"
              onClick={() => useAiRunStore.getState().toggleCompare()}
              icon={<Columns2 aria-hidden className="h-3.5 w-3.5" />}
              label={comparing ? 'Show the changes' : 'Compare before'}
            />
            <PanelButton
              testId="ai-undo"
              onClick={() => useAiRunStore.getState().undoRun()}
              disabled={!undoable}
              hint={undoable ? undefined : 'You have edited the plan since. Use Undo in the toolbar.'}
              icon={<Undo2 aria-hidden className="h-3.5 w-3.5" />}
              label="Undo changes"
            />
            <PanelButton
              testId="ai-replay"
              onClick={() => useAiRunStore.getState().replay()}
              disabled={!undoable}
              hint={undoable ? undefined : 'The plan has changed since these were made.'}
              icon={<RotateCcw aria-hidden className="h-3.5 w-3.5" />}
              label="Replay"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PanelButton({
  testId,
  onClick,
  icon,
  label,
  disabled = false,
  hint,
}: {
  testId: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1.5 text-xs font-semibold text-garden-ink transition-colors hover:bg-garden-sage disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-garden-green focus-visible:outline-none"
    >
      {icon}
      {label}
    </button>
  );
}
