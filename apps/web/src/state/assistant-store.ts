'use client';

import type { ProposedChange } from '@garden-studio/schema';
import { create } from 'zustand';
import { ApiError, proposeChanges } from '@/lib/plan-api';
import { usePlanEditorStore } from './plan-editor-store';
import { flushAll } from './project-sync';
import { projectRevision } from './revision';

/**
 * The AI Design Assistant's conversation.
 *
 * A store of its own rather than fields on the editor, because the chat is session state and the
 * layout is document state. They have different lifetimes and different undo semantics: rewinding
 * the garden must not rewind what was said about it, and a transcript that vanished every time
 * someone pressed Undo would be useless as a record of how the plan got this way.
 *
 * The dependency runs one way. This store posts a sentence to the server and calls `applyProposal`
 * to land a diff. The editor knows nothing about the chat.
 */

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  at: number;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  text: string;
  at: number;
  changes: ProposedChange[];
  /** Change id → still accepted. Every line starts checked. */
  accepted: Record<string, boolean>;
  applied: boolean;
  appliedIds: string[];
  /** Lines the store turned down at apply time, with the reason it gave. */
  refused: { changeId: string; reason: string }[];
  suggestions: string[];
  /** Asked for but impossible to place, with the planner's reason. Never the model's words. */
  unplaceable: { description: string; reason: string }[];
}

export type ChatMessage = UserMessage | AssistantMessage;

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `m${messageCounter}`;
}

/**
 * The chips shown before anything has been said.
 *
 * Generic, and deliberately not derived from the plan: the server writes every later set of
 * suggestions, and a client that generated its own opening set from the layout would be a second
 * source of assistant copy to keep in step with the first.
 */
const OPENING_SUGGESTIONS = [
  'Add more privacy',
  'Lower the cost',
  'More lawn',
  'Use gravel instead of paving',
];

interface AssistantState {
  messages: ChatMessage[];
  /** True while a proposal is in flight. A real model takes seconds. */
  pending: boolean;
  /** Why the last request failed, or null. Shown by the panel, never faked as a reply. */
  error: string | null;

  send: (text: string) => Promise<void>;
  toggleChange: (messageId: string, changeId: string) => void;
  applyMessage: (messageId: string) => void;
  clear: () => void;
}

/**
 * Turns a transport failure into something worth reading.
 *
 * 503 is the expected one and is not really an error: it is what the API returns when it has no
 * Anthropic key, so `pnpm dev` and a marker without a key both land here. Saying "unavailable"
 * rather than "failed" is the difference between a feature that is switched off and one that
 * is broken.
 */
function messageForFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) return 'The assistant is unavailable at the moment.';
    if (error.status === 429) return 'That was a lot of requests at once — try again in a minute.';
    if (error.status === 502)
      return 'The assistant replied with something unusable. Try rephrasing.';
  }

  return 'Could not reach the assistant. Check your connection and try again.';
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  messages: [],
  pending: false,
  error: null,

  send: async (text) => {
    const trimmed = text.trim();
    if (trimmed === '' || get().pending) return;

    set((state) => ({
      messages: [
        ...state.messages,
        { id: nextMessageId(), role: 'user', text: trimmed, at: Date.now() },
      ],
      pending: true,
      error: null,
    }));

    try {
      /*
       * Flush first. The request carries only the sentence — the server reads the plan it has
       * stored — so an unsaved edit inside the 800 ms autosave window would have the assistant
       * reasoning about a garden the user can no longer see.
       */
      await flushAll();

      const target = projectRevision();
      if (!target) throw new Error('No plan is loaded.');

      const proposal = await proposeChanges(target.projectId, trimmed);

      set((state) => ({
        messages: [
          ...state.messages,
          {
            id: nextMessageId(),
            role: 'assistant',
            text: proposal.reply,
            at: Date.now(),
            changes: proposal.changes,
            // Everything starts accepted; reviewing means unticking what you do not want.
            accepted: Object.fromEntries(proposal.changes.map((change) => [change.id, true])),
            applied: false,
            appliedIds: [],
            refused: [],
            suggestions: proposal.suggestions,
            unplaceable: proposal.unplaceable,
          },
        ],
        pending: false,
      }));
    } catch (error) {
      // No assistant bubble on failure. An invented reply in the transcript would be indistinguishable
      // from one the model actually wrote.
      set({ pending: false, error: messageForFailure(error) });
    }
  },

  toggleChange: (messageId, changeId) =>
    set((state) => ({
      messages: state.messages.map((message) => {
        if (message.id !== messageId || message.role !== 'assistant') return message;
        // An applied block is a record of what happened; its ticks stop being controls.
        if (message.applied) return message;

        return {
          ...message,
          accepted: { ...message.accepted, [changeId]: !message.accepted[changeId] },
        };
      }),
    })),

  /**
   * Hands the accepted lines to the editor and records what actually landed.
   *
   * The outcome comes back from the store rather than being assumed, because the store re-checks
   * every line against the live house and boundary and may turn some down. Saying "applied" over
   * a change that was refused would be the one lie this screen cannot afford.
   */
  applyMessage: (messageId) => {
    const message = get().messages.find((candidate) => candidate.id === messageId);
    if (!message || message.role !== 'assistant' || message.applied) return;

    const acceptedIds = message.changes
      .filter((change) => message.accepted[change.id])
      .map((change) => change.id);

    const outcome = usePlanEditorStore.getState().applyProposal(message.changes, acceptedIds);

    set((state) => ({
      messages: state.messages.map((candidate) =>
        candidate.id === messageId && candidate.role === 'assistant'
          ? {
              ...candidate,
              applied: true,
              appliedIds: outcome.applied,
              refused: outcome.refused,
            }
          : candidate,
      ),
    }));
  },

  clear: () => set({ messages: [], pending: false, error: null }),
}));

/* ---------------------------------------------------------------- derived reads */

/** The newest assistant reply's chips, or the opening set before anything has been said. */
export function latestSuggestions(state: { messages: ChatMessage[] }): string[] {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const message = state.messages[i];
    if (message.role === 'assistant') return message.suggestions;
  }

  return OPENING_SUGGESTIONS;
}

export function resetAssistantStoreForTests(): void {
  messageCounter = 0;
  useAssistantStore.setState({ messages: [], pending: false, error: null });
}
