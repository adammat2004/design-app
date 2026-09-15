import type { Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { MIN_CACHEABLE_TOKENS, logAssistantUsage, readUsage } from './usage.js';

/**
 * The measurement the notes have been claiming for three assistants and never taking.
 *
 * All three put their standing rules behind an `ephemeral` cache breakpoint on the reasoning that
 * the block is stable across turns. A prefix under the model's minimum cacheable length is silently
 * never cached, and `ASSISTANT_RULES` is around 800 tokens against a 1024-token minimum — so the
 * breakpoint may do nothing on every call, and until this module nothing would have said so.
 */

function message(usage: Partial<Anthropic.Usage> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [],
    usage: { input_tokens: 0, output_tokens: 0, ...usage },
  } as unknown as Anthropic.Message;
}

function logger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger & {
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
}

describe('readUsage', () => {
  it('reads the four numbers a call actually cost', () => {
    const usage = readUsage(
      message({
        input_tokens: 2400,
        output_tokens: 180,
        cache_creation_input_tokens: 1100,
        cache_read_input_tokens: 0,
      }),
    );

    expect(usage).toEqual({
      inputTokens: 2400,
      outputTokens: 180,
      cacheWrite: 1100,
      cacheRead: 0,
    });
  });

  /* The SDK marks both cache fields optional, and a model that does not report them is not zero. */
  it('defaults the cache fields rather than reading undefined', () => {
    expect(readUsage(message({ input_tokens: 10, output_tokens: 5 }))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheWrite: 0,
      cacheRead: 0,
    });
  });
});

describe('logAssistantUsage', () => {
  it('records the cache read, which is the number this exists for', () => {
    const log = logger();

    logAssistantUsage(
      'Design assistant',
      message({ input_tokens: 2400, output_tokens: 180, cache_read_input_tokens: 812 }),
      log,
    );

    const line = log.log.mock.calls[0]![0] as string;
    expect(line).toContain('Design assistant');
    expect(line).toContain('cache_read=812');
    /* A call that read from the cache is working as intended and says nothing further. */
    expect(log.warn).not.toHaveBeenCalled();
  });

  /**
   * The finding T8 is after, said in words rather than left as a zero to read past.
   *
   * Neither written nor read means the breakpoint achieved nothing, and the likeliest cause is a
   * prefix under the minimum — which no amount of re-running fixes.
   */
  it('says plainly when a declared breakpoint did nothing at all', () => {
    const log = logger();

    logAssistantUsage('Design assistant', message({ input_tokens: 900, output_tokens: 40 }), log);

    expect(log.warn).toHaveBeenCalledTimes(1);
    const warning = log.warn.mock.calls[0]![0] as string;
    expect(warning).toContain('the prompt cache did nothing');
    expect(warning).toContain(String(MIN_CACHEABLE_TOKENS));
  });

  /* Writing the cache on the first call of a window is correct, and is not the fault above. */
  it('does not complain about the call that fills the cache', () => {
    const log = logger();

    logAssistantUsage(
      'Strategic brief',
      message({ input_tokens: 2400, cache_creation_input_tokens: 1400 }),
      log,
    );

    expect(log.warn).not.toHaveBeenCalled();
  });

  /**
   * It runs on the success path of a request somebody is waiting on.
   *
   * A measurement that can break the thing it measures is worth less than no measurement — the same
   * contract `design-events` keeps on the client.
   */
  it('never throws, whatever it is handed', () => {
    const exploding = {
      get usage(): never {
        throw new Error('no usage on this response');
      },
    } as unknown as Anthropic.Message;

    expect(() => logAssistantUsage('Design assistant', exploding, logger())).not.toThrow();
    expect(logAssistantUsage('Design assistant', exploding, logger())).toBeNull();
  });

  it('names which assistant answered, because three of them share this', () => {
    const log = logger();
    logAssistantUsage('Garden assistant', message({ cache_read_input_tokens: 5 }), log);

    expect(log.log.mock.calls[0]![0]).toContain('Garden assistant');
  });
});
