import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The image model's key, from the environment or from `apps/api/.env`.
 *
 * Read from the API's env file because that is where every other key in this repository already
 * lives, and a second `.env` for a script that runs twice a year is one more thing to leave a key
 * in by mistake. Both spellings are accepted; the file in this repository uses the second.
 *
 * `null` is a supported answer: the tool then prints what it would generate and exits 0. Nothing
 * at runtime ever needs this — the app reads files.
 */
export function readOpenAiKey(repoRoot: string): string | null {
  const fromEnv = process.env.OPENAI_API_KEY ?? process.env.OPEN_AI_API_KEY;
  if (fromEnv) return fromEnv;

  const file = join(repoRoot, 'apps', 'api', '.env');
  if (!existsSync(file)) return null;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*(OPENAI_API_KEY|OPEN_AI_API_KEY)\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[2]) return match[2].replace(/^["']|["']$/g, '');
  }

  return null;
}
