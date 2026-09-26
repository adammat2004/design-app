import type { ARScene } from '@garden-studio/ar-contract';
import { useEffect, useState } from 'react';
import { sceneSource } from './fixture-source';

export type SceneState =
  | { status: 'loading' }
  | { status: 'ready'; scene: ARScene }
  | { status: 'error'; message: string };

/** Loads one scene from the app's scene source. */
export function useARScene(id: string): SceneState {
  const [state, setState] = useState<SceneState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    sceneSource.load(id).then(
      (scene) => !cancelled && setState({ status: 'ready', scene }),
      (error: unknown) =>
        !cancelled &&
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);
  return state;
}
