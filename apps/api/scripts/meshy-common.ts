import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What the Meshy scripts share: the key from `apps/api/.env`, a pause, and a task with its signed
 * URLs stripped. The calls themselves are `src/model-assets/meshy.client.ts`, the service's own
 * client, so a script and the lab send Meshy exactly the same thing.
 */

/** One value out of `apps/api/.env` (the environment wins). Same hand parse as `probe:assistant`. */
export function readEnv(key: string): string | null {
  if (process.env[key]) return process.env[key]!;

  let contents: string;
  try {
    contents = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
  } catch {
    return null;
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at === -1 || trimmed.slice(0, at).trim() !== key) continue;
    const value = trimmed
      .slice(at + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    return value.length > 0 ? value : null;
  }

  return null;
}

export function readMeshyKey(): string {
  const key = readEnv('MESHY_API_KEY');
  if (!key) {
    throw new Error('No MESHY_API_KEY in apps/api/.env or the environment.');
  }
  return key;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * The task with every signed URL replaced by its path.
 *
 * The URLs carry an `Expires` signature and die with Meshy's three-day retention, so keeping them
 * records nothing useful and puts a live download link in a file somebody might paste.
 */
export function withoutSignedUrls(task: unknown): unknown {
  if (typeof task === 'string') {
    try {
      const url = new URL(task);
      if (url.search) return `${url.origin}${url.pathname}`;
    } catch {
      /* not a URL */
    }
    return task;
  }
  if (Array.isArray(task)) return task.map(withoutSignedUrls);
  if (task && typeof task === 'object') {
    return Object.fromEntries(
      Object.entries(task).map(([key, value]) => [key, withoutSignedUrls(value)]),
    );
  }
  return task;
}
