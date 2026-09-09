'use client';

import { create } from 'zustand';
import type { ImageryConfig } from '@garden-studio/schema';
import { getImageryConfig } from '@/lib/plan-api';

/**
 * Whether this server can show aerial imagery, and how.
 *
 * Loaded once per session rather than per canvas: the answer is a property of the server, not of
 * the plan, and the step-1 card needs it before any canvas exists. `unavailable` is the ordinary
 * state on a machine with nothing configured — the card disables itself and says so, the way the
 * chat panel does when the assistant has no key. `error` is different: the API could not be
 * reached at all, which the plan layout already reports elsewhere.
 */
export type ImageryStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

interface ImageryState {
  status: ImageryStatus;
  config: ImageryConfig | null;
  load: () => Promise<void>;
}

export const useImageryStore = create<ImageryState>((set, get) => ({
  status: 'idle',
  config: null,

  load: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });

    try {
      const config = await getImageryConfig();
      set(config ? { status: 'ready', config } : { status: 'unavailable', config: null });
    } catch {
      set({ status: 'error', config: null });
    }
  },
}));

/** Test hook: the store is a module singleton. */
export function resetImageryStoreForTests(state: Partial<ImageryState> = {}): void {
  useImageryStore.setState({ status: 'idle', config: null, ...state });
}
