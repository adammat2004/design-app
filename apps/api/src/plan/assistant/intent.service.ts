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
  type AssistantTurn,
  type GardenZone,
  type PlanDocument,
} from '@garden-studio/schema';
import { ConfigService } from '@nestjs/config';
import { ANTHROPIC, type AnthropicClient } from './anthropic.module.js';
import { INTENT_JSON_SCHEMA } from './intent-schema.js';
import { renderInventory } from './inventory.js';
import { ASSISTANT_RULES } from './rules.js';
import { logAssistantUsage } from './usage.js';

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

  async interpret(
    message: string,
    document: PlanDocument,
    history: AssistantTurn[] = [],
  ): Promise<AssistantIntentEnvelope> {
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
        /*
         * What was said, then what is there now, then what they want.
         *
         * All three are in one user turn, below the cache breakpoint, rather than as real
         * alternating turns. The reason is that **the assistant's previous replies described a
         * garden that has since been redrawn**: sent as assistant turns they read as statements of
         * current fact and compete with the inventory, which is the only description of the plan
         * that is still true. Quoted as history under a heading, they are what they actually are —
         * a record of the conversation, there so that "a bit more" has something to refer to.
         *
         * History before the inventory because "we said this, the garden is now that, they want
         * this" is the order the request is reasoned in.
         */
        messages: [
          {
            role: 'user',
            content: [
              renderHistory(history),
              renderInventory(document, zones),
              `The user says:\n${message}`,
            ]
              .filter((section) => section !== '')
              .join('\n\n'),
          },
        ],
      });

      /*
       * Before the refusal check: a refused turn still cost input tokens and still says whether the
       * cache read anything, and that is exactly the call somebody would otherwise never measure.
       */
      logAssistantUsage('Design assistant', response, this.logger);

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
 * The conversation so far, quoted rather than replayed as turns.
 *
 * Empty string for an empty history, so the caller can drop the section entirely — a heading with
 * nothing under it invites the model to wonder what was withheld.
 */
function renderHistory(history: AssistantTurn[]): string {
  if (history.length === 0) return '';

  const lines = history.map(
    (turn) => `${turn.role === 'user' ? 'They said' : 'You said'}: ${turn.text}`,
  );
  return [
    'EARLIER IN THIS CONVERSATION',
    '(Oldest first. The garden has changed since — the inventory below is what is there now.)',
    ...lines,
  ].join('\n');
}

/**
 * SDK errors to HTTP, most specific first.
 *
 * `APIConnectionError` before `APIError` matters: in the TypeScript SDK the former is a subclass of
 * the latter, so the broad check would swallow it. Authentication failures are reported as 503
 * rather than 401 — a bad key on the server is not the client's fault, and saying so would tell an
 * unauthenticated caller something about our configuration.
 *
 * Exported because the garden assistant makes the same call to the same API and must fail the same
 * way. Two mappings would drift, and the one that drifted would be the one nobody tested.
 */
export function toHttpException(error: unknown, logger: Logger): Error {
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
