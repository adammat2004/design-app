import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Prepares a preview directory, keeping the last run in `before/`.
 *
 * Shared by every preview script. Clearing the directory every time is deliberate and stays — a
 * renamed case must not leave a stale image behind to be mistaken for current output. But visual
 * tuning is entirely a comparison exercise: you cannot tell whether a tone is better by looking
 * only at the after. One generation deep, so it cannot grow without bound, and `before/` is inside
 * the gitignored directory so neither is ever committed.
 *
 * Returns the `before/` path, which exists only when there was a previous run.
 */
export function preparePreviewDir(outDir: string): string {
  const beforeDir = join(outDir, 'before');

  if (existsSync(outDir)) {
    const carried = join(dirname(outDir), `${outDir.split('/').pop()}-carry`);
    rmSync(carried, { recursive: true, force: true });
    cpSync(outDir, carried, { recursive: true });
    // Drop the previous run's own `before/`, or each run would nest one inside the last.
    rmSync(join(carried, 'before'), { recursive: true, force: true });

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    cpSync(carried, beforeDir, { recursive: true });
    rmSync(carried, { recursive: true, force: true });
  } else {
    mkdirSync(outDir, { recursive: true });
  }

  return beforeDir;
}
