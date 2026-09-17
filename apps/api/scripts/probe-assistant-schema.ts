import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { GARDEN_ACTION_JSON_SCHEMA } from '../src/plan/assistant/garden/garden-action-schema.js';
import { INTENT_JSON_SCHEMA } from '../src/plan/assistant/intent-schema.js';

/**
 * Ask Anthropic what it objects to, for the price of one token.
 *
 * The design assistant started returning 400 from `messages.create` and the only thing the server
 * logged was the status, so the cause was a guess. This sends **one** request carrying nothing but
 * the schema under test and prints the API's own sentence back.
 *
 * It exists because the alternative is reasoning about the schema from the outside: the published
 * structured-outputs limits name unsupported *keywords*, and this schema uses none of them, so a
 * static reading can rank hypotheses but cannot settle them. One call settles it.
 *
 * **Run by hand, never by the suite.** `pnpm test` must stay free and keyless — a marker gets this
 * repository without a key and everything has to work for them. This is the only file in the
 * project that talks to Anthropic outside a request.
 *
 * ```
 *   pnpm --filter @garden-studio/api probe:assistant          # the design assistant's schema
 *   pnpm --filter @garden-studio/api probe:assistant garden   # the one that works, as a control
 * ```
 *
 * The control matters as much as the subject. If the garden schema also fails, the schema is not
 * the variable and the next place to look is the model, the key or the account — which would make
 * every planned schema change wasted work.
 */

/** The schemas worth sending, by the name you pass on the command line. */
const VARIANTS: Record<string, unknown> = {
  intent: INTENT_JSON_SCHEMA,
  garden: GARDEN_ACTION_JSON_SCHEMA,
};

/**
 * The smallest request that still compiles the grammar.
 *
 * A schema is compiled when it is first seen and then cached for a day, so the rejection happens
 * before any tokens are generated — which is why `max_tokens` can be tiny and the message can be
 * one word. No system block, so nothing here can be confused with the real prompt.
 */
const MAX_TOKENS = 16;

async function main(): Promise<void> {
  const name = process.argv[2] ?? 'intent';
  const schema = VARIANTS[name];

  if (!schema) {
    console.error(`No such variant: ${name}. Try one of: ${Object.keys(VARIANTS).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  const apiKey = readKey();
  if (!apiKey) {
    console.error(
      'No ANTHROPIC_API_KEY in apps/api/.env — nothing to probe with. This is a supported\n' +
        'state for the app, which answers 503 without one, but not for this script.',
    );
    process.exitCode = 1;
    return;
  }

  const model = readEnv('ANTHROPIC_MODEL') ?? 'claude-opus-5';
  const serialised = JSON.stringify(schema);

  console.log(`\n  variant   ${name}`);
  console.log(`  model     ${model}`);
  console.log(`  schema    ${serialised.length} bytes\n`);

  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 0 });

  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: schema as Record<string, unknown> },
      },
      messages: [{ role: 'user', content: 'hello' }],
    });

    console.log(`  ✓ 200 — the schema compiled. stop_reason: ${response.stop_reason}\n`);
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error;

    /*
     * The whole point of the script. `message` is the API's sentence, `error` the parsed body —
     * both are the response, so neither can carry the key or the prompt.
     */
    console.log(`  ✗ ${error.status ?? '?'} ${error.type ?? ''}`);
    console.log(`\n  ${error.message}\n`);
    if (error.error) console.log(`  body: ${JSON.stringify(error.error)}\n`);
    if (error.requestID) console.log(`  request: ${error.requestID}\n`);

    process.exitCode = 1;
  }
}

/** The key, read straight from `.env` — the script is not a Nest app and has no ConfigModule. */
function readKey(): string | null {
  const value = readEnv('ANTHROPIC_API_KEY');
  return value && value.length > 0 ? value : null;
}

/**
 * One value out of `apps/api/.env`.
 *
 * Hand-parsed rather than pulling in `dotenv`: it is present only as a transitive dependency of
 * `@nestjs/config`, and a diagnostic script should not be the thing that discovers that was
 * pruned. Quotes are stripped because a key pasted from a dashboard often arrives wearing them.
 */
function readEnv(key: string): string | null {
  const path = resolve(__dirname, '..', '.env');

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return process.env[key] ?? null;
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const at = trimmed.indexOf('=');
    if (at === -1 || trimmed.slice(0, at).trim() !== key) continue;

    return trimmed
      .slice(at + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  return process.env[key] ?? null;
}

/*
 * `void` rather than a top-level await: the API package is CommonJS, and `tsx` transforms a
 * top-level await into a syntax error rather than into anything runnable.
 */
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
