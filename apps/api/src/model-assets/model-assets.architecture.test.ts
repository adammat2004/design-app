import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * What keeps generation off every path a garden owner is on. Meshy spends real money, so the rule is
 * structural rather than a matter of care: nothing outside `model-assets/` and the app module may
 * import it, and only the client may name Meshy's host. The same shape of test keeps the feedback
 * table out of the design layer.
 */

const SRC = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe('model generation stays off the user’s path', () => {
  const sources = files(SRC).map((path) => ({
    path: relative(SRC, path),
    text: readFileSync(path, 'utf8'),
  }));

  it('is imported by nothing but the app module', () => {
    const importers = sources
      .filter(({ path }) => !path.startsWith('model-assets/'))
      .filter(({ text }) => /from '[^']*model-assets\//.test(text))
      .map(({ path }) => path);
    expect(importers).toEqual(['app.module.ts']);
  });

  it('names Meshy’s host in the client alone', () => {
    const naming = sources
      .filter(({ text }) => text.includes('api.meshy.ai'))
      .map(({ path }) => path);
    expect(naming).toEqual(['model-assets/meshy.client.ts']);
  });

  it('keeps the generator and the assistants away from the model pipeline', () => {
    const reaching = sources
      .filter(({ path }) => path.startsWith('plan/'))
      .filter(({ text }) => text.includes('@garden-studio/model-pipeline'))
      .map(({ path }) => path);
    expect(reaching).toEqual([]);
  });
});
