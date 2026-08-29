'use client';

/**
 * The plan being edited and the revision every write is based on.
 *
 * Its own module because two things bump it — the autosave in `project-sync.ts` and generation in
 * `concepts-store.ts` — and they must not each keep their own idea of it, or the second one to
 * write would 409 against a revision the first had already moved past. Putting it in either store
 * would make the two import each other.
 *
 * Not a store: nothing renders it. It is bookkeeping between this client and the server.
 */
let current: { projectId: string; revision: number } | null = null;

export function setProjectRevision(next: { projectId: string; revision: number } | null): void {
  current = next;
}

export function projectRevision(): { projectId: string; revision: number } | null {
  return current;
}

/** Records the revision a successful write returned, so the next one is based on it. */
export function advanceRevision(revision: number): void {
  if (current) current = { ...current, revision };
}
