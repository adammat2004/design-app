'use client';

import { Check, Pause, Play, SquareChevronRight, X } from 'lucide-react';
import type { AgentRole, RunPhase } from '@garden-studio/schema';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import type { AgentPhase } from '@/state/assistant-store';
import { Pill } from './Pill';

/**
 * What the designer is doing to the garden, right now.
 *
 * Deliberately a checklist of stages and one sentence for whoever is working — not a conversation
 * between agents. Agents talking to each other on screen is theatre: it invents a process the code
 * does not have, and it competes with the canvas, which is the thing actually worth watching.
 * Everything here is read off the operation the executor is running, so it cannot claim work the
 * plan did not receive.
 *
 * **It is the inspector's body while a request is live, not a box inside a bubble.** The subject
 * header stays put above it; what this says is that the subject is being changed, and by which
 * stage. On a wide screen that is simply the next thing under the header. Below `lg` the whole
 * inspector is under the canvas and off the fold, so it becomes a bar fixed to the bottom of the
 * viewport — the one position Stop is always reachable from. One element, two placements, so
 * nothing has to be kept in step.
 */

const AGENTS: { role: AgentRole; name: string; phase: RunPhase }[] = [
  { role: 'lead', name: 'Lead designer', phase: 'analyse' },
  { role: 'layout', name: 'Layout designer', phase: 'layout' },
  { role: 'circulation', name: 'Circulation designer', phase: 'circulation' },
  { role: 'planting', name: 'Planting designer', phase: 'planting' },
  { role: 'reviewer', name: 'Design reviewer', phase: 'review' },
];

const STAGES: { phase: RunPhase; label: string }[] = [
  { phase: 'analyse', label: 'Analysing the plan' },
  { phase: 'layout', label: 'Adjusting the layout' },
  { phase: 'circulation', label: 'Setting out the routes' },
  { phase: 'planting', label: 'Adjusting the planting' },
  { phase: 'review', label: 'Reviewing the design' },
];

/** What the designer is doing before any operation has started, per conversational phase. */
const WAITING_ON: Record<Exclude<AgentPhase, 'idle'>, string> = {
  thinking: 'Reading the plan and working out what to do',
  performing: 'Working on the garden',
  reviewing: 'Checking the composition',
};

export function AgentActivity({ phase }: { phase: AgentPhase }) {
  const status = useAiRunStore((state) => state.status);
  const active = useAiRunStore(selectRunActive);
  const frame = useAiRunStore((state) => state.frame);
  /*
   * What the reviewer is doing between runs, where there is no frame to read a status off.
   *
   * Every value it takes is read off something measured — the fault's own sentence, the count of
   * corrections the server actually scored — so the panel reports work rather than narrating a
   * process. It is the last fallback before the generic waiting line, because a live operation's
   * own label is always the more specific thing to say.
   */
  const reviewStatus = useAiRunStore((state) => state.reviewStatus);

  const live = phase !== 'idle' || active;

  /* A find over five entries, computed rather than memoised: the memo cost more than the work. */
  const runPhase = frame?.phase ?? (phase === 'reviewing' ? 'review' : null);
  const reached = runPhase === null ? -1 : STAGES.findIndex((stage) => stage.phase === runPhase);

  function stageState(index: number): 'done' | 'current' | 'upcoming' {
    if (!live) return status === 'complete' ? 'done' : 'upcoming';
    if (index < reached) return 'done';
    return index === reached ? 'current' : 'upcoming';
  }

  function agentState(agent: (typeof AGENTS)[number]): 'active' | 'done' | 'waiting' {
    if (!live) return status === 'complete' ? 'done' : 'waiting';
    if (frame?.agent === agent.role) return 'active';
    if (phase === 'reviewing' && agent.role === 'reviewer') return 'active';
    const index = STAGES.findIndex((stage) => stage.phase === agent.phase);
    return index < reached ? 'done' : 'waiting';
  }

  const activeAgent = AGENTS.find((agent) => agentState(agent) === 'active') ?? null;
  const working =
    frame?.status ?? frame?.chip ?? reviewStatus ?? WAITING_ON[phase === 'idle' ? 'performing' : phase];

  /*
   * `data-status` carries the *run's* state, not the conversation's, and stays on the element even
   * when there is nothing to draw. It is how a browser test asks what the designer is doing, and a
   * hook that disappears between runs cannot answer "it was stopped".
   */
  return (
    <div
      data-testid="ai-activity-panel"
      data-status={status}
      data-phase={phase}
      className={
        live
          ? 'z-30 px-4 py-3 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:border-t max-lg:border-garden-line max-lg:bg-white max-lg:shadow-[0_-2px_8px_rgba(0,0,0,0.08)]'
          : 'hidden'
      }
    >
      {/*
        `aria-live="off"`, deliberately, on a block that changes several times a second.
        Announcing every frame would make a screen reader unusable for the length of the run; the
        inspector's own visually-hidden status region announces the phase changes and the outcome,
        which is the part that carries meaning.
      */}
      <div aria-live="off">
        <ol className="space-y-1.5" data-testid="ai-stages">
          {STAGES.map((stage, index) => {
            const state = stageState(index);
            return (
              <li
                key={stage.phase}
                data-testid={`ai-stage-${stage.phase}`}
                data-state={state}
                className={`flex items-center gap-2 text-xs ${
                  state === 'current'
                    ? 'font-medium text-garden-ink'
                    : state === 'done'
                      ? 'text-garden-muted'
                      : 'text-garden-muted/60'
                }`}
              >
                <StageMark state={state} />
                <span className="min-w-0 truncate">{stage.label}</span>
              </li>
            );
          })}
        </ol>

        {/*
          One line, for whoever is working — not the whole list of five.
          A roster of idle designers is a claim about a team; what the user needs to know is who has
          the plan and what they are doing with it. The others keep their test hooks so a browser
          test can still assert the run reached each stage.
        */}
        <ul className="mt-2 pl-6">
          {AGENTS.map((agent) => {
            const state = agentState(agent);
            return (
              <li
                key={agent.role}
                data-testid={`ai-agent-${agent.role}`}
                data-state={state}
                className={state === 'active' ? 'block' : 'hidden'}
              >
                <span className="block text-[11px] font-medium text-garden-ink">{agent.name}</span>
                <span className="block truncate text-[11px] text-garden-muted">{working}</span>
              </li>
            );
          })}
          {/* Nothing has started yet: still say what is being waited on rather than nothing. */}
          {activeAgent === null ? (
            <li className="text-[11px] text-garden-muted">{working}</li>
          ) : null}
        </ul>
      </div>

      {/*
        Stop is always offered; Skip and Pause only once there is an animation to skip or pause.
        Offering Pause against a model call would be a control that does nothing to the thing the
        user is actually waiting for.
      */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill
          testId="ai-stop"
          onClick={() => useAiRunStore.getState().cancel()}
          icon={<X aria-hidden className="h-3.5 w-3.5" />}
        >
          Stop
        </Pill>
        {active ? (
          <>
            <Pill
              testId="ai-skip"
              onClick={() => useAiRunStore.getState().skipToEnd()}
              icon={<SquareChevronRight aria-hidden className="h-3.5 w-3.5" />}
            >
              Skip animation
            </Pill>
            <Pill
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
            >
              {status === 'paused' ? 'Resume' : 'Pause'}
            </Pill>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A tick, a filled dot, or an empty ring: done, current, still to come. */
function StageMark({ state }: { state: 'done' | 'current' | 'upcoming' }) {
  if (state === 'done') {
    return (
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-garden-sage text-garden-green"
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-garden-ai/40"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-garden-ai" />
      </span>
    );
  }
  return <span aria-hidden className="h-4 w-4 shrink-0 rounded-full border border-garden-line" />;
}
