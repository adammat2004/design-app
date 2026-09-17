'use client';

import { Pause, Play, SquareChevronRight, X } from 'lucide-react';
import type { AgentRole, RunPhase } from '@garden-studio/schema';
import { selectRunActive, useAiRunStore } from '@/state/ai-run-store';
import type { AgentPhase } from '@/state/assistant-store';

/**
 * What the designer is doing to the garden, right now.
 *
 * Deliberately a strip of stages and one sentence per designer — not a conversation between agents.
 * Agents talking to each other on screen is theatre: it invents a process the code does not have,
 * and it competes with the canvas, which is the thing actually worth watching. Everything here is
 * read off the operation the executor is running, so it cannot claim work the plan did not receive.
 *
 * **It lives inside the message it belongs to, and sticks to the bottom of the transcript while the
 * run is live.** One element, not two: a pinned copy above the input plus a static copy in the
 * message would be two things saying the same thing, and they would disagree the moment one of them
 * missed a frame. Sticky gives the same guarantee — you can always see it — with nothing to keep in
 * step.
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
      /*
       * Two placements, one element.
       *
       * On a wide screen the panel is a column beside the canvas, so sticking to the bottom of the
       * transcript is enough to keep it in view. Below `lg` the whole panel is *under* the canvas
       * and off the fold — which would leave the user watching their garden being rewritten with
       * the Stop button somewhere down the page. There it becomes a bar fixed to the bottom of the
       * viewport, which is the one position that is always reachable.
       */
      className={
        live
          ? 'z-30 border-garden-line bg-garden-canvas p-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:border-t max-lg:shadow-[0_-2px_8px_rgba(0,0,0,0.08)] lg:sticky lg:bottom-0 lg:mt-2 lg:rounded-lg lg:border'
          : 'hidden'
      }
    >
      {/*
        `aria-live="off"`, deliberately, on a block that changes several times a second.
        Announcing every frame would make a screen reader unusable for the length of the run; the
        panel's own visually-hidden status region announces the phase changes and the outcome,
        which is the part that carries meaning.
      */}
      <div aria-live="off">
        <ol className="flex flex-wrap gap-x-3 gap-y-1" data-testid="ai-stages">
          {STAGES.map((stage, index) => {
            const state = stageState(index);
            return (
              <li
                key={stage.phase}
                data-testid={`ai-stage-${stage.phase}`}
                data-state={state}
                className={`flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase ${
                  state === 'current'
                    ? 'text-garden-ai'
                    : state === 'done'
                      ? 'text-garden-muted'
                      : 'text-garden-muted/45'
                }`}
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-[1px] border ${
                    state === 'current'
                      ? 'border-garden-ai bg-garden-ai'
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

        {/*
          One line, for whoever is working — not the whole list of five.
          A roster of idle designers is a claim about a team; what the user needs to know is who has
          the plan and what they are doing with it. The others keep their test hooks so a browser
          test can still assert the run reached each stage.
        */}
        <ul className="mt-2">
          {AGENTS.map((agent) => {
            const state = agentState(agent);
            return (
              <li
                key={agent.role}
                data-testid={`ai-agent-${agent.role}`}
                data-state={state}
                className={state === 'active' ? 'flex gap-2' : 'hidden'}
              >
                <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-[1px] bg-garden-ai" />
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-garden-ink">
                    {agent.name}
                  </span>
                  <span className="block truncate text-[10px] text-garden-muted">
                    {frame?.status ??
                      frame?.chip ??
                      reviewStatus ??
                      WAITING_ON[phase === 'idle' ? 'performing' : phase]}
                  </span>
                </span>
              </li>
            );
          })}
          {/* Nothing has started yet: still say what is being waited on rather than nothing. */}
          {!AGENTS.some((agent) => agentState(agent) === 'active') ? (
            <li className="flex gap-2">
              <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-[1px] bg-garden-ai" />
              <span className="text-[10px] text-garden-muted">
                {WAITING_ON[phase === 'idle' ? 'performing' : phase]}
              </span>
            </li>
          ) : null}
        </ul>
      </div>

      {/*
        Stop is always offered; Skip and Pause only once there is an animation to skip or pause.
        Offering Pause against a model call would be a control that does nothing to the thing the
        user is actually waiting for.
      */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ActivityButton
          testId="ai-stop"
          onClick={() => useAiRunStore.getState().cancel()}
          icon={<X aria-hidden className="h-3.5 w-3.5" />}
          label="Stop"
        />
        {active ? (
          <>
            <ActivityButton
              testId="ai-skip"
              onClick={() => useAiRunStore.getState().skipToEnd()}
              icon={<SquareChevronRight aria-hidden className="h-3.5 w-3.5" />}
              label="Skip animation"
            />
            <ActivityButton
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
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A control in the at-work block.
 *
 * 36px tall with a 44px hit area through `before`, because these are the buttons somebody reaches
 * for in a hurry — Stop most of all — and a 28px pill is a miss on a trackpad and a certainty of one
 * on a touch screen.
 */
function ActivityButton({
  testId,
  onClick,
  icon,
  label,
}: {
  testId: string;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="relative flex h-9 items-center gap-1.5 rounded-full border border-garden-line bg-white px-3 text-xs font-semibold text-garden-ink transition-colors before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:bg-garden-sage focus-visible:ring-2 focus-visible:ring-garden-ai focus-visible:outline-none"
    >
      {icon}
      {label}
    </button>
  );
}
