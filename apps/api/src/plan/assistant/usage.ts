import type { Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * What a model call actually cost, and whether the prompt cache did anything.
 *
 * **This exists because the caching win has been claimed in the notes and never measured.** All
 * three assistants put their standing rules in a system block with an `ephemeral` cache breakpoint,
 * on the reasoning that the block is stable across turns — but a prefix shorter than the model's
 * minimum cacheable length is silently never cached, and `ASSISTANT_RULES` is around 800 tokens
 * against a 1024-token minimum. So the breakpoint may do nothing at all, on every call, and nothing
 * in the system would say so.
 *
 * Counts only. **Never the prompt, never the reply, never the key** — the same rule the rest of the
 * assistant keeps, and the reason this takes a `Message` and reads four integers off it rather than
 * logging the object.
 */

/** Below this many tokens a prefix is not cached at all, whatever the breakpoint asks for. */
export const MIN_CACHEABLE_TOKENS = 1024;

export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written *into* the cache on this call. Non-zero on the first call of a window. */
  cacheWrite: number;
  /** Tokens read *back* from the cache. **The number this module exists for.** */
  cacheRead: number;
}

/** The four integers, defaulted, because the SDK marks the cache fields optional. */
export function readUsage(response: Anthropic.Message): AssistantUsage {
  const usage = response.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
  };
}

/**
 * Logs it, and says plainly when a declared breakpoint achieved nothing.
 *
 * **Never throws.** It is called on the success path of a request a user is waiting on, and a
 * measurement that can break the thing it measures is worth less than no measurement — the same
 * contract `design-events` keeps. A `cacheRead` of zero on the first call of a window is correct and
 * expected; what is worth reading twice is a zero on the *second*, which is what the "wrote nothing"
 * line names.
 *
 * `label` names the assistant, because three of them share this and a line that does not say which
 * one answered cannot be acted on.
 */
export function logAssistantUsage(
  label: string,
  response: Anthropic.Message,
  logger: Logger,
): AssistantUsage | null {
  try {
    const usage = readUsage(response);

    logger.log(
      `${label} usage: input=${usage.inputTokens} output=${usage.outputTokens} ` +
        `cache_write=${usage.cacheWrite} cache_read=${usage.cacheRead}`,
    );

    /*
     * The finding T8 is actually after, said once and in words.
     *
     * A breakpoint that neither wrote nor read is a breakpoint doing nothing — and the likeliest
     * cause is the prefix being under the minimum, which no amount of re-running will fix. Saying
     * so here is what stops the caching claim being carried in the notes on nothing.
     */
    if (usage.cacheWrite === 0 && usage.cacheRead === 0) {
      logger.warn(
        `${label}: the prompt cache did nothing on this call (no write, no read). A system prefix ` +
          `under ${MIN_CACHEABLE_TOKENS} tokens is never cached, whatever the breakpoint asks for.`,
      );
    }

    return usage;
  } catch {
    /* A broken measurement must not break the answer it was measuring. */
    return null;
  }
}
