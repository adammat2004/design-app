import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AssistantProposal, PlanDocument } from '@garden-studio/schema';
import { IntentService } from './intent.service.js';
import { PlannerService } from './planner.service.js';

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
  /**
   * In-process token bucket. The API has no auth, so a reachable deployment would otherwise hand
   * a stranger an Anthropic bill; this is the cheap half of the answer and the README says to keep
   * the server on localhost, which is the rest of it.
   */
  private readonly hits = new Map<string, number[]>();

  private static readonly WINDOW_MS = 60_000;
  private static readonly PER_PROJECT = 6;
  private static readonly OVERALL = 20;

  constructor(
    private readonly intent: IntentService,
    private readonly planner: PlannerService,
  ) {}

  get available(): boolean {
    return this.intent.available;
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

    this.rateLimit(projectId);

    const envelope = await this.intent.interpret(message, document);
    const { changes, unplaceable } = await this.planner.plan(document, envelope.intents);

    return {
      reply: assembleReply(envelope.reply, unplaceable),
      changes,
      suggestions: envelope.suggestions,
      unplaceable,
    };
  }

  private rateLimit(projectId: string): void {
    const now = Date.now();
    const since = now - AssistantService.WINDOW_MS;

    for (const [key, times] of this.hits) {
      const recent = times.filter((time) => time > since);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }

    const project = this.hits.get(projectId) ?? [];
    const overall = [...this.hits.values()].reduce((total, times) => total + times.length, 0);

    if (project.length >= AssistantService.PER_PROJECT || overall >= AssistantService.OVERALL) {
      throw new HttpException(
        'That is a lot of questions at once — give it a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.hits.set(projectId, [...project, now]);
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
