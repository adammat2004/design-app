import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AssistantIntentEnvelopeSchema,
  computeZones,
  type AssistantIntentEnvelope,
  type GardenZone,
  type PlanDocument,
} from '@garden-studio/schema';
import { ConfigService } from '@nestjs/config';
import { ANTHROPIC, type AnthropicClient } from './anthropic.module.js';
import { INTENT_JSON_SCHEMA } from './intent-schema.js';
import { renderInventory } from './inventory.js';
import { ASSISTANT_RULES } from './rules.js';

/**
 * The one place in the codebase that talks to a language model.
 *
 * Its whole job is to turn a sentence into `DesignIntent[]` — no geometry, no coordinates, no
 * decisions about what is legal. Everything downstream of this file is deterministic, which is what
 * makes the interesting half of the assistant testable without a model at all.
 */
@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);
  private readonly model: string;

  constructor(
    @Inject(ANTHROPIC) private readonly claude: AnthropicClient,
    config: ConfigService,
  ) {
    this.model = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-5';
  }

  get available(): boolean {
    return this.claude !== null;
  }

  async interpret(message: string, document: PlanDocument): Promise<AssistantIntentEnvelope> {
    if (!this.claude) {
      throw new ServiceUnavailableException(
        'The design assistant is not configured on this server.',
      );
    }

    const zones: GardenZone[] = computeZones(
      document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      document.site.house,
    );

    try {
      const response = await this.claude.messages.create({
        model: this.model,
        /*
         * `max_tokens` caps thinking *and* the response together on this model, so it needs room
         * for both. Thinking is deliberately left on: disabling it is what makes Claude occasionally
         * write a tool call into its visible text or leak `<thinking>` tags, and `effort` is the
         * cheaper lever for cost anyway.
         */
        max_tokens: 16_000,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: INTENT_JSON_SCHEMA },
        },
        system: [
          {
            type: 'text',
            text: ASSISTANT_RULES,
            // Stable across every turn, so it is worth a cache breakpoint. The inventory, which
            // changes each turn, goes in the user turn *after* it.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `${renderInventory(document, zones)}\n\nThe user says:\n${message}`,
          },
        ],
      });

      // Before `content`, always: a declined request is a successful HTTP response with an empty
      // or partial body, and indexing into it is how that becomes a crash.
      if (response.stop_reason === 'refusal') {
        this.logger.warn(
          `Assistant request refused: ${response.stop_details?.category ?? 'unknown'}`,
        );
        throw new BadGatewayException('The assistant could not answer that.');
      }

      return this.parse(response);
    } catch (error) {
      throw toHttpException(error, this.logger);
    }
  }

  private parse(response: Anthropic.Message): AssistantIntentEnvelope {
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!text.trim()) {
      throw new BadGatewayException('The assistant returned nothing to act on.');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadGatewayException('The assistant returned something unreadable.');
    }

    /*
     * Validated with the shared Zod schema rather than trusted. The JSON Schema constrains shape
     * and vocabulary; the bounds — a resize factor between 0.25 and 4, a name under 60 characters —
     * live here, because structured outputs does not support numeric or string limits.
     */
    const parsed = AssistantIntentEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(`Assistant output failed validation: ${parsed.error.message}`);
      throw new BadGatewayException('The assistant returned something unexpected.');
    }

    return parsed.data;
  }
}

/**
 * SDK errors to HTTP, most specific first.
 *
 * `APIConnectionError` before `APIError` matters: in the TypeScript SDK the former is a subclass of
 * the latter, so the broad check would swallow it. Authentication failures are reported as 503
 * rather than 401 — a bad key on the server is not the client's fault, and saying so would tell an
 * unauthenticated caller something about our configuration.
 */
function toHttpException(error: unknown, logger: Logger): Error {
  if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
    return error;
  }

  if (error instanceof Anthropic.RateLimitError) {
    logger.warn('Assistant rate limited.');
    return new ServiceUnavailableException('The assistant is busy. Try again in a moment.');
  }

  if (error instanceof Anthropic.APIConnectionError) {
    logger.warn('Assistant unreachable.');
    return new ServiceUnavailableException('Could not reach the assistant.');
  }

  if (error instanceof Anthropic.AuthenticationError) {
    logger.error('Assistant credentials rejected.');
    return new ServiceUnavailableException('The design assistant is not configured correctly.');
  }

  if (error instanceof Anthropic.APIError) {
    logger.error(`Assistant API error ${error.status ?? '?'}.`);
    return new BadGatewayException('The assistant failed to answer.');
  }

  logger.error(error instanceof Error ? error.message : 'Unknown assistant failure.');
  return new BadGatewayException('The assistant failed to answer.');
}
