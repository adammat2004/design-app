import type { ARScene } from '@garden-studio/ar-contract';

/** Enough to show a scene in a list without loading it. */
export interface SceneSummary {
  id: string;
  name: string;
}

/**
 * Where scenes come from. The seam that keeps everything else in the app ignorant of whether a
 * garden was bundled, opened from a file or fetched from the API: swap the source, and nothing
 * below `src/scene/` changes.
 *
 * Every implementation must return scenes that have been through `readARScene`, so a scene the
 * rest of the app sees is always valid and always one this app version can read.
 */
export interface SceneSource {
  list(): Promise<SceneSummary[]>;
  load(id: string): Promise<ARScene>;
}
