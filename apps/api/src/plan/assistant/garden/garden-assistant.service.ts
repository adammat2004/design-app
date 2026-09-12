import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { GardenProposal, PlanDocument } from '@garden-studio/schema';
import { AssistantRateLimit } from '../rate-limit.js';
import { GardenIntentService } from './garden-intent.service.js';
import { GardenPlannerService } from './garden-planner.service.js';

/**
 * Orchestration for step 2: interpret, plan, then assemble the reply.
 *
 * **The model writes the prose; the planner writes the facts.** The model's `reply` is used as it
 * comes, but every statement about an outcome — what could not be fitted and why — is appended here
 * from the planner's own findings. That is what stops the assistant claiming it mapped a shed it
 * could not fit, which is the one failure that would make the feature untrustworthy.
 */
@Injectable()
export class GardenAssistantService {
  constructor(
    private readonly intent: GardenIntentService,
    private readonly planner: GardenPlannerService,
    private readonly limit: AssistantRateLimit,
  ) {}

  get available(): boolean {
    return this.intent.available;
  }

  async propose(
    projectId: string,
    message: string,
    document: PlanDocument,
  ): Promise<GardenProposal> {
    /*
     * Availability before the rate limit, not after. A server with no key answers 503 for ever, so
     * counting those attempts would turn the honest "not configured" into "give it a minute" after
     * six tries — advice that would never come good.
     */
    if (!this.available) {
      throw new ServiceUnavailableException(
        'The garden assistant is not configured on this server.',
      );
    }

    this.limit.check(projectId);

    const envelope = await this.intent.interpret(message, document);
    const { changes, scope, unplaceable } = await this.planner.plan(document, envelope.actions);

    return {
      reply: assembleReply(envelope.reply, unplaceable),
      changes,
      scope,
      suggestions: envelope.suggestions,
      unplaceable,
    };
  }
}

/**
 * The model's sentence, plus one deterministic sentence per thing that could not be done.
 *
 * Appended rather than woven in, because the model wrote its reply before the planner had run and
 * cannot have known. Rewriting its prose to match would mean a second round trip and a second
 * chance to be wrong about the outcome.
 */
function assembleReply(reply: string, unplaceable: { reason: string }[]): string {
  if (unplaceable.length === 0) return reply;

  return [reply.trim(), ...unplaceable.map((entry) => entry.reason)].join(' ');
}
