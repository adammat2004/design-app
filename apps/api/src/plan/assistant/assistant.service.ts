import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  AssistantProposal,
  DesignElement,
  DesignIntent,
  PlanDocument,
  RedesignResult,
} from '@garden-studio/schema';
import { IntentService } from './intent.service.js';
import { PlannerService } from './planner.service.js';
import { AssistantRateLimit } from './rate-limit.js';

/**
 * Orchestration: interpret, plan, then assemble the reply.
 *
 * **The model writes the prose; the planner writes the facts.** The model's `reply` is used as it
 * comes, but every statement about an outcome — what was resized to what, what could not be fitted
 * and why — is appended here from the planner's own findings. That is what stops the assistant
 * claiming it did something it did not do, which is the single failure that would make the feature
 * untrustworthy in front of a marker.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly intent: IntentService,
    private readonly planner: PlannerService,
    /** Shared with the garden assistant — see `rate-limit.ts` for why it is not one bucket each. */
    private readonly limit: AssistantRateLimit,
  ) {}

  get available(): boolean {
    return this.intent.available;
  }

  /**
   * A redesign asked for in intents, with no model anywhere in it.
   *
   * The design reviewer reads a layout, names a fault and the elements it concerns, and the fix is
   * a `DesignIntent` looked up in a table — there is no sentence in any of that for a model to
   * write. Three consequences, all deliberate:
   *
   *   - **No availability check.** `propose` answers 503 without a key because there is genuinely
   *     nothing it can do; this route works on a server that has never had one, which is the state
   *     `pnpm dev` and a marker's machine are both in.
   *   - **No rate limit.** That budget exists to cap a bill, and this costs nothing. Counting it
   *     here would have the reviewer's corrections starve the chat of its allowance.
   *   - **No prose.** The planner's `unplaceable` entries are returned verbatim and nothing is
   *     assembled around them. A reply written here would be the server inventing a voice for a
   *     caller that is a scorer.
   *
   * Everything downstream is the same: the same planner, the same placer, the same
   * `geometryIsLegal`. A correction the reviewer asks for is placed by exactly the rules a
   * person's request is.
   */
  async redesign(
    document: PlanDocument,
    intents: DesignIntent[],
    elements?: DesignElement[],
  ): Promise<RedesignResult> {
    /*
     * Planned against the layout the caller is actually looking at.
     *
     * A reviewer asks mid-redesign, when the editor is holding a gesture open and nothing has been
     * saved — so the stored layout is the plan as it was several changes ago. Answering from that
     * produces a correction computed against widths and positions the user has already moved on
     * from, which is a worse failure than refusing: it looks like it worked.
     */
    const against = elements ? { ...document, layout: { ...document.layout, elements } } : document;
    return this.planner.plan(against, intents);
  }

  async propose(
    projectId: string,
    message: string,
    document: PlanDocument,
  ): Promise<AssistantProposal> {
    /*
     * Availability before the rate limit, not after. A server with no key answers 503 for ever, so
     * counting those attempts would turn the honest "not configured" into "give it a minute" after
     * six tries — advice that would never come good.
     */
    if (!this.available) {
      throw new ServiceUnavailableException(
        'The design assistant is not configured on this server.',
      );
    }

    this.limit.check(projectId);

    const envelope = await this.intent.interpret(message, document);
    const { changes, unplaceable } = await this.planner.plan(document, envelope.intents);

    return {
      reply: assembleReply(envelope.reply, unplaceable),
      changes,
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

  const notes = unplaceable.map((entry) => entry.reason);

  return [reply.trim(), ...notes].join(' ');
}
