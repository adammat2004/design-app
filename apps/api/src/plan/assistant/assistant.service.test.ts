import { HttpException } from '@nestjs/common';
import {
  PlanDocumentSchema,
  ProposeRequestSchema,
  type AssistantIntentEnvelope,
} from '@garden-studio/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantService } from './assistant.service.js';
import type { IntentService } from './intent.service.js';
import { AssistantRateLimit } from './rate-limit.js';
import type { PlannerService } from './planner.service.js';

/**
 * Orchestration only — both halves are faked.
 *
 * The model is faked for the same reason it is in `intent.service.test.ts`, and the planner because
 * its own suite already runs it against real PostGIS. What is left here is the part neither of them
 * covers: the token bucket, and the promise that the reply never claims more than the planner did.
 */

const plan = () => PlanDocumentSchema.parse({ version: 1 });

function envelope(over: Partial<AssistantIntentEnvelope> = {}): AssistantIntentEnvelope {
  return {
    reply: 'I have proposed two changes.',
    intents: [],
    suggestions: ['Make it cheaper', 'More lawn', 'Add privacy'],
    ...over,
  };
}

interface Fakes {
  available?: boolean;
  interpret?: () => Promise<AssistantIntentEnvelope>;
  plan?: () => Promise<{
    changes: never[];
    unplaceable: { description: string; reason: string }[];
  }>;
}

function service(fakes: Fakes = {}): AssistantService {
  const intent = {
    available: fakes.available ?? true,
    interpret: vi.fn(fakes.interpret ?? (async () => envelope())),
  } as unknown as IntentService;

  const planner = {
    plan: vi.fn(fakes.plan ?? (async () => ({ changes: [], unplaceable: [] }))),
  } as unknown as PlannerService;

  /*
   * A real limiter rather than a fake: it is the thing under test in half of these cases, and it is
   * a fresh instance per call, so each test gets its own budget. Now shared with the garden
   * assistant — see `rate-limit.ts`.
   */
  return new AssistantService(intent, planner, new AssistantRateLimit());
}

/** The status of the exception a call threw, or null if it resolved. */
async function statusOf(call: Promise<unknown>): Promise<number | null> {
  try {
    await call;
    return null;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : -1;
  }
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('AssistantService', () => {
  it('returns the model’s reply and the planner’s changes', async () => {
    const proposal = await service().propose('p1', 'make the patio bigger', plan());

    expect(proposal.reply).toBe('I have proposed two changes.');
    expect(proposal.suggestions).toHaveLength(3);
  });

  /**
   * The model wrote its reply before the planner ran, so it cannot have known what would not fit.
   * Appending the planner's own sentences is what stops the assistant claiming it did something it
   * did not do.
   */
  it('appends the planner’s reasons to the model’s prose', async () => {
    const assistant = service({
      plan: async () => ({
        changes: [],
        unplaceable: [
          { description: 'Shed 2.0 × 1.5 m', reason: 'There is no clear space in the front.' },
        ],
      }),
    });

    const proposal = await assistant.propose('p1', 'add a shed at the front', plan());

    expect(proposal.reply).toBe(
      'I have proposed two changes. There is no clear space in the front.',
    );
    expect(proposal.unplaceable).toHaveLength(1);
  });

  it('leaves the reply alone when everything was placed', async () => {
    const proposal = await service().propose('p1', 'make the patio bigger', plan());

    expect(proposal.reply).toBe('I have proposed two changes.');
  });

  /** The conversation reaches the model, or a follow-up has nothing to refer back to. */
  it('passes the history through to the interpreter', async () => {
    const interpret = vi.fn(async () => envelope());
    const assistant = new AssistantService(
      { available: true, interpret } as unknown as IntentService,
      { plan: vi.fn(async () => ({ changes: [], unplaceable: [] })) } as unknown as PlannerService,
      new AssistantRateLimit(),
    );

    const document = plan();
    const history = [{ role: 'user' as const, text: 'make the patio bigger' }];
    await assistant.propose('p1', 'a bit more', document, history);

    expect(interpret).toHaveBeenCalledWith('a bit more', document, history, []);
  });

  /**
   * What they are pointing at reaches the model, or "make this bigger" has no subject.
   *
   * The selection is deixis rather than a description of the garden, which is why it is on the
   * request at all when the elements themselves deliberately are not.
   */
  it('passes the selection through to the interpreter', async () => {
    const interpret = vi.fn(async () => envelope());
    const assistant = new AssistantService(
      { available: true, interpret } as unknown as IntentService,
      { plan: vi.fn(async () => ({ changes: [], unplaceable: [] })) } as unknown as PlannerService,
      new AssistantRateLimit(),
    );

    const document = plan();
    await assistant.propose('p1', 'make this bigger', document, [], ['e-1']);

    expect(interpret).toHaveBeenCalledWith('make this bigger', document, [], ['e-1']);
  });

  /** An older client that sends neither still works: both fields are additive, with defaults. */
  it('treats a request with no history as a first turn', async () => {
    const interpret = vi.fn(async () => envelope());
    const assistant = new AssistantService(
      { available: true, interpret } as unknown as IntentService,
      { plan: vi.fn(async () => ({ changes: [], unplaceable: [] })) } as unknown as PlannerService,
      new AssistantRateLimit(),
    );

    await assistant.propose('p1', 'make the patio bigger', plan());

    expect(interpret).toHaveBeenCalledWith('make the patio bigger', expect.anything(), [], []);
  });

  /** The body an older client sends still parses, with both additive fields defaulted empty. */
  it('parses a body that carries neither history nor selection', () => {
    const parsed = ProposeRequestSchema.parse({ message: 'make the patio bigger' });

    expect(parsed).toEqual({ message: 'make the patio bigger', history: [], selection: [] });
  });
});

describe('rate limiting', () => {
  it('allows six questions about one plan and then asks for a minute', async () => {
    const assistant = service();

    for (let i = 0; i < 6; i += 1) {
      expect(await statusOf(assistant.propose('p1', 'again', plan()))).toBeNull();
    }

    expect(await statusOf(assistant.propose('p1', 'again', plan()))).toBe(429);
  });

  it('counts per plan, so a busy plan does not silence a quiet one', async () => {
    const assistant = service();

    for (let i = 0; i < 6; i += 1) await assistant.propose('p1', 'again', plan());

    expect(await statusOf(assistant.propose('p2', 'first question', plan()))).toBeNull();
  });

  it('caps the total across every plan', async () => {
    const assistant = service();

    // Four plans at five each is twenty — the overall cap — without any one plan hitting six.
    for (const project of ['p1', 'p2', 'p3', 'p4']) {
      for (let i = 0; i < 5; i += 1) await assistant.propose(project, 'again', plan());
    }

    expect(await statusOf(assistant.propose('p5', 'one more', plan()))).toBe(429);
  });

  it('forgets a question once its minute is up', async () => {
    vi.useFakeTimers();
    const assistant = service();

    for (let i = 0; i < 6; i += 1) await assistant.propose('p1', 'again', plan());
    expect(await statusOf(assistant.propose('p1', 'again', plan()))).toBe(429);

    vi.advanceTimersByTime(61_000);

    expect(await statusOf(assistant.propose('p1', 'again', plan()))).toBeNull();
  });

  /**
   * A server with no key answers 503 for ever, so counting those attempts would replace an honest
   * "not configured" with "give it a minute" — advice that never comes good.
   */
  it('answers 503 without a key, however many times it is asked', async () => {
    const assistant = service({ available: false });

    for (let i = 0; i < 10; i += 1) {
      expect(await statusOf(assistant.propose('p1', 'again', plan()))).toBe(503);
    }
  });
});
