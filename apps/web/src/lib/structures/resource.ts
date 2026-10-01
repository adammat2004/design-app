import { useEffect, useSyncExternalStore } from 'react';

/**
 * A file the 3D view would like and can live without: loaded once, in the background, and never
 * suspended on.
 *
 * `useTexture` and friends suspend, and a rejected suspense promise is an *error*, not a fallback —
 * with no error boundary above the Canvas a single 404 took the whole 3D view down, while the
 * comment beside it said a missing file was a supported state. This is the 2D library's answer
 * (`assetVersion`) in miniature: `get()` is `null` until the file has arrived, stays `null` if it
 * never does, and subscribers are told once when it settles, so the caller draws the flat version
 * first and upgrades in place.
 *
 * Started lazily, by the first `useResource` to mount, so nothing is fetched until the 3D view opens.
 */
export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type Resource<T> = {
  get(): T | null;
  status(): ResourceStatus;
  /** Idempotent: the second caller shares the first caller's load. */
  start(): Promise<T | null>;
  subscribe(listener: () => void): () => void;
};

export function createResource<T>(load: () => Promise<T>): Resource<T> {
  let value: T | null = null;
  let state: ResourceStatus = 'idle';
  let pending: Promise<T | null> | null = null;
  const listeners = new Set<() => void>();
  const settle = (next: ResourceStatus) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    get: () => value,
    status: () => state,
    start() {
      if (pending) return pending;
      state = 'loading';
      pending = load().then(
        (loaded) => {
          value = loaded;
          settle('ready');
          return loaded;
        },
        () => {
          settle('failed');
          return null;
        },
      );
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A resource that is known up front not to exist: no catalogue entry, nothing to fetch. */
export function absentResource<T>(): Resource<T> {
  return {
    get: () => null,
    status: () => 'failed',
    start: () => Promise.resolve(null),
    subscribe: () => () => {},
  };
}

/** The resource's value once it has arrived, starting the load if nobody has. */
export function useResource<T>(resource: Resource<T>): T | null {
  useEffect(() => {
    void resource.start();
  }, [resource]);
  return useSyncExternalStore(resource.subscribe, resource.get, () => null);
}

/** The resource's status, for the test hooks on the viewport. */
export function useResourceStatus(resource: Resource<unknown>): ResourceStatus {
  useEffect(() => {
    void resource.start();
  }, [resource]);
  return useSyncExternalStore(resource.subscribe, resource.status, () => 'idle');
}
