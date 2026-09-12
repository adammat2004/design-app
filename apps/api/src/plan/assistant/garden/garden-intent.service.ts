import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  computeZones,
  GardenEnvelopeSchema,
  type GardenEnvelope,
  type GardenZone,
  type PlanDocument,
} from '@garden-studio/schema';
import { ConfigService } from '@nestjs/config';
import { ANTHROPIC, type AnthropicClient } from '../anthropic.module.js';
import { toHttpException } from '../intent.service.js';
import { GARDEN_ACTION_JSON_SCHEMA } from './garden-action-schema.js';
import { renderGardenInventory } from './garden-inventory.js';
import { GARDEN_RULES } from './garden-rules.js';

/**
 * The second, and only other, place in the codebase that talks to a language model.
 *
 * Its whole job is to turn a description of a garden into `GardenAction[]` — no geometry, no
 * coordinates, no decisions about what is legal. Everything downstream is deterministic, which is
 * what makes `garden-planner.service.test.ts` able to test the interesting half with no model at
 * all.
 */
@Injectable()
export class GardenIntentService {
  private readonly logger = new Logger(GardenIntentService.name);
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

  async interpret(message: string, document: PlanDocument): Promise<GardenEnvelope> {
    if (!this.claude) {
      throw new ServiceUnavailableException(
        'The garden assistant is not configured on this server.',
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
         * for both. Thinking is deliberately left on: disabling it is what makes Claude
         * occasionally write a tool call into its visible text, and `effort` is the cheaper lever
         * for cost anyway.
         */
        max_tokens: 16_000,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: GARDEN_ACTION_JSON_SCHEMA },
        },
        system: [
          {
            type: 'text',
            text: GARDEN_RULES,
            // Stable across every turn, so it is worth a cache breakpoint. The inventory, which
            // changes each turn, goes in the user turn *after* it.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `${renderGardenInventory(document, zones)}\n\nThe user says:\n${message}`,
          },
        ],
      });

      // Before `content`, always: a declined request is a successful HTTP response with an empty
      // or partial body, and indexing into it is how that becomes a crash.
      if (response.stop_reason === 'refusal') {
        this.logger.warn(
          `Garden assistant request refused: ${response.stop_details?.category ?? 'unknown'}`,
        );
        throw new BadGatewayException('The assistant could not answer that.');
      }

      return this.parse(response);
    } catch (error) {
      throw toHttpException(error, this.logger);
    }
  }

  private parse(response: Anthropic.Message): GardenEnvelope {
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
     * and vocabulary; the bounds — a count of at most four, a name under forty characters — live
     * there, because structured outputs does not support numeric or string limits.
     */
    const parsed = GardenEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(`Garden assistant output failed validation: ${parsed.error.message}`);
      throw new BadGatewayException('The assistant returned something unexpected.');
    }

    return parsed.data;
  }
}
