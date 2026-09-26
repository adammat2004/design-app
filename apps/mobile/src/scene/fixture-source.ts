import { readARScene } from '@garden-studio/ar-contract';
import { FIXTURES } from '../fixtures';
import type { SceneSource } from './source';

/**
 * Scenes bundled with the app. The first of three sources, in the order they are likely to be
 * built: bundled fixtures, then `.ar.json` files exported from the web app, then the API.
 */
export function fixtureSource(fixtures: Record<string, unknown> = FIXTURES): SceneSource {
  return {
    async list() {
      return Object.keys(fixtures).map((id) => ({
        id,
        name: readARScene(fixtures[id]).source.projectName,
      }));
    },
    async load(id) {
      if (!(id in fixtures)) throw new Error(`No bundled scene called "${id}".`);
      return readARScene(fixtures[id]);
    },
  };
}

/** The source the app uses. Change this one line to switch the whole app to another source. */
export const sceneSource: SceneSource = fixtureSource();
