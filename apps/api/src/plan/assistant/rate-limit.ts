import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * One budget across every assistant on the server.
 *
 * In-process token bucket. The API has no auth, so a reachable deployment would otherwise hand a
 * stranger an Anthropic bill; this is the cheap half of the answer and the README's "keep it on
 * localhost" is the rest of it.
 *
 * **Shared rather than one bucket per assistant, and that is the point of extracting it.** Two
 * buckets would mean the design assistant and the garden assistant each got the full allowance, so
 * the real ceiling would quietly be double what the number says — and a third assistant would
 * double it again. One provider, one budget.
 */
@Injectable()
export class AssistantRateLimit {
  private readonly hits = new Map<string, number[]>();

  private static readonly WINDOW_MS = 60_000;
  private static readonly PER_PROJECT = 6;
  private static readonly OVERALL = 20;

  /** Records a call, or throws 429. Keyed by plan, so one busy plan cannot starve another. */
  check(projectId: string): void {
    const now = Date.now();
    const since = now - AssistantRateLimit.WINDOW_MS;

    for (const [key, times] of this.hits) {
      const recent = times.filter((time) => time > since);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }

    const project = this.hits.get(projectId) ?? [];
    const overall = [...this.hits.values()].reduce((total, times) => total + times.length, 0);

    if (project.length >= AssistantRateLimit.PER_PROJECT || overall >= AssistantRateLimit.OVERALL) {
      throw new HttpException(
        'That is a lot of questions at once — give it a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.hits.set(projectId, [...project, now]);
  }
}
