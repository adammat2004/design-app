import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export const ANTHROPIC = Symbol('ANTHROPIC');

/** Null when no key is configured, so the endpoint can answer 503 instead of crashing at boot. */
export type AnthropicClient = Anthropic | null;

/**
 * The Claude client, provided the same way `DbModule` provides drizzle.
 *
 * Not `@Global()` — only the assistant talks to a model, unlike the database.
 *
 * Deliberately resolves to `null` rather than throwing when `ANTHROPIC_API_KEY` is missing. This
 * project gets handed to a marker who will not have a key, and `pnpm dev` and the whole test suite
 * have to keep working for them; the assistant endpoint returns 503 and the chat panel says so.
 */
@Module({
  providers: [
    {
      provide: ANTHROPIC,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AnthropicClient => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        const enabled = config.get<string>('ASSISTANT_ENABLED') !== 'false';

        if (!apiKey || !enabled) return null;

        return new Anthropic({
          apiKey,
          // Milliseconds in the TypeScript SDK, unlike the Python one's seconds.
          timeout: Number(config.get<string>('ASSISTANT_TIMEOUT_MS') ?? 30_000),
          maxRetries: 2,
        });
      },
    },
  ],
  exports: [ANTHROPIC],
})
export class AnthropicModule {}
