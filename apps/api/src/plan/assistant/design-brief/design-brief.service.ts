import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  DesignBriefEnvelopeSchema,
  type DesignBrief,
  type GardenBrief,
} from '@garden-studio/schema';
import { reconcileBriefs } from '../../generation/design/brief-reconcile.js';
import type { Requirements, SiteAnalysis } from '../../generation/design/types.js';
import { ANTHROPIC, type AnthropicClient } from '../anthropic.module.js';
import { DESIGN_BRIEF_JSON_SCHEMA } from './design-brief-schema.js';
import { renderDesignBriefInventory } from './design-brief-inventory.js';
import { DESIGN_BRIEF_RULES } from './design-brief-rules.js';

/**
 * The third and last place in the codebase that talks to a language model, and the only one on the
 * generation path.
 *
 * It writes the *strategy* for three concepts — what each garden is for, how the requested spaces
 * rank in it, which rooms matter, which compositions are worth trying — and then a deterministic
 * engine draws all three. It is the "LLM confined to the strategic reasoning layer" the architecture
 * was built around: there is nowhere in `DesignBrief` to put a coordinate, so the model cannot say
 * where anything goes even if it tried.
 *
 * Four rules make it safe to switch on, and each is a failure it would otherwise cause:
 *
 * **Generation never fails because of the model.** Every error path — no key, a refusal, a timeout,
 * unreadable JSON, a schema mismatch — returns the deterministic briefs and logs. Step 4 generates
 * on arrival, so a model outage would otherwise be a wizard that cannot continue.
 *
 * **Once per generation, never per candidate.** Fifty candidates are scored per concept and the
 * brief is an input to all of them; a call inside that loop would be both ruinous and pointless,
 * since the answer cannot depend on a candidate that does not exist yet.
 *
 * **Reconciled field by field, not trusted.** `reconcileBriefs` is pure and lives with the design
 * layer, so what the model is allowed to change is testable with no model at all.
 *
 * **Off by default.** `DESIGN_BRIEF_LLM=true` turns it on. Step 4 auto-generates the moment a user
 * arrives, so default-on would spend on every visit to a screen people visit to look around.
 */
@Injectable()
export class DesignBriefService {
  private readonly logger = new Logger(DesignBriefService.name);
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly cache = new Map<string, { briefs: DesignBrief[]; at: number }>();

  /**
   * How long a strategic brief stays good for.
   *
   * It is a function of the site and the brief, neither of which changes between generating a set
   * and rerolling one slot of it — so `mode: 'one'` must not pay for a second call to be told the
   * same thing. Ten minutes is longer than that round trip and far shorter than a session in which
   * someone goes back to step 3 and changes their mind.
   */
  private static readonly TTL_MS = 10 * 60_000;

  /** A hundred plans' worth of strategy is a few kilobytes; past that, evict the oldest. */
  private static readonly MAX_ENTRIES = 100;

  constructor(
    @Inject(ANTHROPIC) private readonly claude: AnthropicClient,
    config: ConfigService,
  ) {
    this.model = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-5';
    this.enabled = config.get<string>('DESIGN_BRIEF_LLM') === 'true';
  }

  /** Whether a call would actually be made: a key, and the flag. */
  get available(): boolean {
    return this.claude !== null && this.enabled;
  }

  /**
   * The three strategic briefs, from the model where it can improve on the default and from the
   * default everywhere else.
   *
   * Takes the deterministic answer as an argument rather than computing it, so the caller keeps one
   * source for it and this cannot drift into being a second brief builder.
   */
  async write(
    brief: GardenBrief,
    analysis: SiteAnalysis,
    requirements: Requirements,
    fallback: DesignBrief[],
  ): Promise<DesignBrief[]> {
    if (!this.available || !this.claude) return fallback;

    const key = this.keyFor(brief, analysis, requirements);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < DesignBriefService.TTL_MS) return cached.briefs;

    try {
      const briefs = await this.ask(brief, analysis, requirements, fallback);
      /*
       * Only a real answer is remembered, and the identity check is how that is known: every
       * give-up path inside `ask` returns the very array it was handed.
       *
       * Caching a fallback would be wrong twice over. It would hold a refusal for ten minutes, so
       * one bad moment disables the feature for the rest of a session. And it would come back on
       * the next call as an array that is no longer reference-equal to *that* call's fallback — so
       * the caller, which distinguishes the two by identity, would treat a non-answer as an answer
       * and push slot A's briefs across all three slots.
       */
      if (briefs !== fallback) this.remember(key, briefs);
      return briefs;
    } catch (error) {
      /*
       * Swallowed on purpose, and the one place in the assistant code that does. The other two
       * services map an error to an HTTP status because a user asked them a question and is waiting
       * for an answer; here nobody asked, the deterministic brief is a complete answer, and turning
       * a model outage into a failed generation would be strictly worse than not calling at all.
       */
      this.logger.warn(
        `Strategic brief unavailable, using the deterministic one: ${
          error instanceof Error ? error.message : 'unknown failure'
        }`,
      );
      return fallback;
    }
  }

  private async ask(
    brief: GardenBrief,
    analysis: SiteAnalysis,
    requirements: Requirements,
    fallback: DesignBrief[],
  ): Promise<DesignBrief[]> {
    const response = await this.claude!.messages.create({
      model: this.model,
      /*
       * `max_tokens` caps thinking *and* the response together on this model, so it needs room for
       * both. Thinking is deliberately left on: disabling it is what makes Claude occasionally write
       * a tool call into its visible text, and `effort` is the cheaper lever for cost anyway.
       */
      max_tokens: 16_000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: DESIGN_BRIEF_JSON_SCHEMA },
      },
      system: [
        {
          type: 'text',
          text: DESIGN_BRIEF_RULES,
          // Identical on every call, so it is worth a cache breakpoint. The site summary, which is
          // different every time, goes in the user turn after it.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: renderDesignBriefInventory(brief, analysis, requirements, fallback),
        },
      ],
    });

    // Before `content`, always: a declined request is a successful HTTP response with an empty or
    // partial body, and indexing into it is how that becomes a crash.
    if (response.stop_reason === 'refusal') {
      this.logger.warn(`Strategic brief refused: ${response.stop_details?.category ?? 'unknown'}`);
      return fallback;
    }

    const envelope = this.parse(response);
    if (!envelope) return fallback;

    const reconciled = reconcileBriefs(envelope.briefs, fallback, brief, analysis);
    for (const note of reconciled.refused) this.logger.debug(`Strategic brief: ${note}`);

    return reconciled.briefs;
  }

  private parse(response: Anthropic.Message): { briefs: DesignBrief[] } | null {
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!text.trim()) {
      this.logger.warn('Strategic brief returned nothing.');
      return null;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.logger.warn('Strategic brief returned something unreadable.');
      return null;
    }

    /*
     * Validated with the shared Zod schema rather than trusted. The JSON Schema constrains shape and
     * vocabulary; the bounds — three briefs, at most three archetypes, 400 characters of rationale —
     * live there, because structured outputs supports neither numeric nor string limits.
     */
    const parsed = DesignBriefEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(`Strategic brief failed validation: ${parsed.error.message}`);
      return null;
    }

    return parsed.data;
  }

  /**
   * What makes two requests the same request.
   *
   * The rendered *inputs*, hashed — not the document. A plan whose boundary was nudged by a
   * millimetre is the same strategic question, and keying on the document would pay for a fresh call
   * every time the user dragged a corner on an earlier step.
   */
  private keyFor(brief: GardenBrief, analysis: SiteAnalysis, requirements: Requirements): string {
    const summary = [
      brief.desiredFeatures.join(','),
      brief.style ?? '',
      brief.budget,
      brief.maintenance,
      brief.purpose ?? '',
      requirements.intent,
      requirements.capacity,
      analysis.shape,
      Math.round(analysis.scale.designedArea),
      analysis.roomDepth?.toFixed(1) ?? '',
      analysis.roomWidth?.toFixed(1) ?? '',
      analysis.sideGate ? 'gate' : '',
      analysis.sun ? 'sun' : '',
    ].join('|');

    return createHash('sha256').update(summary).digest('hex');
  }

  private remember(key: string, briefs: DesignBrief[]): void {
    if (this.cache.size >= DesignBriefService.MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { briefs, at: Date.now() });
  }
}
