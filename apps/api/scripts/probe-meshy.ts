import { MeshyClient, MeshyError } from '../src/model-assets/meshy.client';
import { readMeshyKey } from './meshy-common';

/**
 * Prove the Meshy key works, for nothing.
 *
 * `GET /openapi/v1/balance` is free and counts against no task queue, so it is the one request that
 * can tell a working key from a bad one without spending a credit. **Run by hand, never by the
 * suite** — `pnpm test` stays keyless, as it does for Anthropic.
 *
 * ```
 *   pnpm --filter @garden-studio/api probe:meshy
 * ```
 */
async function main(): Promise<void> {
  let key: string;
  try {
    key = readMeshyKey();
  } catch (error) {
    console.error(`  ✗ ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const balance = await new MeshyClient(key).balance();
    console.log(`\n  ✓ key accepted — balance ${balance} credits\n`);
  } catch (error) {
    const status = error instanceof MeshyError ? error.status : '?';
    console.log(`\n  ✗ ${status} — ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

void main();
