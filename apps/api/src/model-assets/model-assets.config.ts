import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';

/**
 * How the model lab is set up here, read once from the environment.
 *
 * Generation is **off unless three things are all true**: a `MESHY_API_KEY`, an explicit
 * `MODEL_GENERATION_ENABLED=true`, and not production. A key alone is not enough on purpose: the
 * repository's `.env` carries keys for the scripts, and a key sitting in a file must not be what
 * decides that a running server may spend.
 */
export interface ModelAssetsConfig {
  enabled: boolean;
  /** Why generation is off, in a sentence, or `null` when it is on. */
  reason: string | null;
  aiModel: string;
  /** Credits a calendar month may consume, counting what is in flight at its estimated cost. */
  ceiling: number;
  /** Below this balance nothing is submitted. */
  minBalance: number;
  maxInFlight: number;
  /** Job folders: references, Meshy's raw output, the processed file, the report. Gitignored. */
  storageDir: string;
  /** The web app's `public/`: the library is `models/library/` and the references `models/references/`. */
  publicDir: string;
  /** Where `tools/assets generate:references` writes its pictures and their sidecars. */
  referencesDir: string;
  /** A poll asks Meshy at most this often per job, however often the lab asks the API. */
  pollIntervalMs: number;
  /** A claimed step not finished in this long is taken to have died with its process. */
  staleAfterMs: number;
}

/** Credits per image-to-3D task with a texture, from Meshy's published pricing (30 Sep 2026). */
export function estimatedCost(aiModel: string): number {
  return aiModel === 'meshy-6-lite' ? 15 : 30;
}

/** `apps/api`, from `src/model-assets` or `dist/model-assets` alike. */
const API_ROOT = resolve(__dirname, '..', '..');
const REPO_ROOT = resolve(API_ROOT, '..', '..');

export function readModelAssetsConfig(config: ConfigService): ModelAssetsConfig {
  const key = config.get<string>('MESHY_API_KEY');
  const switchedOn = config.get<string>('MODEL_GENERATION_ENABLED') === 'true';
  const production = process.env.NODE_ENV === 'production';
  const reason = production
    ? 'Model generation is a development tool and is off in production.'
    : !key
      ? 'No MESHY_API_KEY is configured.'
      : !switchedOn
        ? 'Set MODEL_GENERATION_ENABLED=true in apps/api/.env to allow spending Meshy credits.'
        : null;
  const number = (name: string, fallback: number) => {
    const value = Number(config.get<string>(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    enabled: reason === null,
    reason,
    aiModel: config.get<string>('MESHY_AI_MODEL') || 'meshy-7.1',
    ceiling: number('MESHY_MONTHLY_CREDIT_CEILING', 300),
    minBalance: number('MESHY_MIN_BALANCE', 60),
    maxInFlight: number('MESHY_MAX_IN_FLIGHT', 2),
    storageDir: resolve(API_ROOT, config.get<string>('MODEL_STORAGE_DIR') || 'storage/models'),
    publicDir: resolve(REPO_ROOT, 'apps', 'web', 'public'),
    referencesDir: resolve(REPO_ROOT, 'tools', 'assets', 'raw', 'references'),
    pollIntervalMs: 5_000,
    staleAfterMs: 10 * 60_000,
  };
}

/**
 * Whether one more request may start: a pure rule, so it is tested without a database.
 * `null` means yes; otherwise the sentence the lab shows.
 */
export function admission(input: {
  creditsThisMonth: number;
  inFlight: number;
  estimatedCost: number;
  ceiling: number;
  maxInFlight: number;
}): string | null {
  if (input.inFlight >= input.maxInFlight) {
    return `${input.inFlight} models are already being made; the limit is ${input.maxInFlight} at once.`;
  }
  const committed = input.creditsThisMonth + input.inFlight * input.estimatedCost;
  if (committed + input.estimatedCost > input.ceiling) {
    return (
      `This would take the month to ${committed + input.estimatedCost} credits, over the ceiling of ` +
      `${input.ceiling} (MESHY_MONTHLY_CREDIT_CEILING).`
    );
  }
  return null;
}
