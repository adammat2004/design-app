import Anthropic from '@anthropic-ai/sdk';
import { PlanDocumentSchema, type PlanDocument } from '@garden-studio/schema';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntentService } from './intent.service.js';
import { INTENT_JSON_SCHEMA } from './intent-schema.js';
import { AssistantIntentEnvelopeSchema, DesignIntentSchema } from '@garden-studio/schema';

/**
 * The model is always faked here.
 *
 * There is no key in the test environment and there should not be: a suite that reached the network
 * would be slow, flaky, billable, and — because the model's output is not deterministic — unable to
 * assert anything precise. What is worth testing is the parsing and the error mapping, both of which
 * are entirely ours.
 */

type FakeClient = Pick<Anthropic, 'messages'>;

function client(create: () => unknown): FakeClient {
  return { messages: { create: vi.fn(create) } } as unknown as FakeClient;
}

function config(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function message(text: string, stopReason = 'end_turn'): unknown {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    stop_reason: stopReason,
    stop_details: null,
    content: [{ type: 'text', text, citations: null }],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

const envelope = {
  reply: 'I have proposed making the seating area larger.',
  intents: [{ kind: 'resize', target: { elementIds: ['e-1'] }, factor: 1.25 }],
  suggestions: ['Make it gravel', 'Add a fire pit', 'Move it nearer the house'],
};

function plan(): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: {
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 20, y: 0 },
        { id: 'v3', x: 20, y: 16 },
        { id: 'v4', x: 0, y: 16 },
      ],
      closed: true,
      house: {
        outline: [
          { id: 'h0', x: -4, y: -3 },
          { id: 'h1', x: 4, y: -3 },
          { id: 'h2', x: 4, y: 3 },
          { id: 'h3', x: -4, y: 3 },
        ],
        centre: { x: 10, y: 4 },
        rotation: 0,
      },
      selectedZoneIds: ['front'],
    },
    layout: {
      elements: [
        {
          id: 'e-1',
          category: 'paved-area',
          role: 'feature',
          name: 'Seating patio',
          zone: 'front',
          material: 'stone-pavers',
          shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 5, depth: 4, rotation: 0 },
        },
      ],
    },
  });
}

/** Asserts the suite really is offline. */
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('IntentService', () => {
  it('parses a well-formed envelope into intents', async () => {
    const service = new IntentService(
      client(() => message(JSON.stringify(envelope))),
      config(),
    );

    const result = await service.interpret('make the seating area bigger', plan());

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ kind: 'resize', factor: 1.25 });
    expect(result.suggestions).toHaveLength(3);
  });

  it('tells the model about the garden it is editing', async () => {
    const create = vi.fn(() => message(JSON.stringify(envelope)));
    const service = new IntentService({ messages: { create } } as unknown as FakeClient, config());

    await service.interpret('make it bigger', plan());

    const body = create.mock.calls[0]![0] as {
      messages: { content: string }[];
      system: { text: string; cache_control?: unknown }[];
      output_config: { format: { schema: unknown }; effort: string };
    };

    // The inventory, with the id the model has to copy back.
    expect(body.messages[0]!.content).toContain('id=e-1');
    expect(body.messages[0]!.content).toContain('Seating patio');
    // Which materials are legal, so "no gravel lawns" is never proposed in the first place.
    expect(body.messages[0]!.content).toContain('Materials allowed per category');
    // The stable rules sit in a cached system block, ahead of the per-turn inventory.
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.output_config.format.schema).toBe(INTENT_JSON_SCHEMA);
  });

  it('does not tell the model any coordinates', async () => {
    const create = vi.fn(() => message(JSON.stringify(envelope)));
    const service = new IntentService({ messages: { create } } as unknown as FakeClient, config());

    await service.interpret('make it bigger', plan());

    const prompt = (create.mock.calls[0]![0] as { messages: { content: string }[] }).messages[0]!
      .content;

    /*
     * The model is given sizes and areas, never positions. Nothing it can say has a coordinate in
     * it, so there is no reason to show it any — and showing it some would invite it to reason
     * about geometry, which is the planner's job.
     */
    expect(prompt).not.toContain('vertices');
    expect(prompt).not.toMatch(/\bx\s*[:=]/);
    expect(prompt).not.toMatch(/\bcentre\b/);
  });

  it('is unavailable rather than broken when there is no key', async () => {
    const service = new IntentService(null, config());

    expect(service.available).toBe(false);
    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 503 });
  });

  it('honours ANTHROPIC_MODEL', async () => {
    const create = vi.fn(() => message(JSON.stringify(envelope)));
    const service = new IntentService(
      { messages: { create } } as unknown as FakeClient,
      config({ ANTHROPIC_MODEL: 'claude-haiku-4-5' }),
    );

    await service.interpret('make it bigger', plan());

    expect((create.mock.calls[0]![0] as { model: string }).model).toBe('claude-haiku-4-5');
  });

  /*
   * Thinking is left on deliberately. With it disabled this model occasionally writes a tool call
   * into its visible text — the turn succeeds, the call never runs, and nothing raises — and can
   * leak `<thinking>` tags into the output.
   */
  it('does not disable thinking', async () => {
    const create = vi.fn(() => message(JSON.stringify(envelope)));
    const service = new IntentService({ messages: { create } } as unknown as FakeClient, config());

    await service.interpret('make it bigger', plan());

    const body = create.mock.calls[0]![0] as { thinking?: { type: string }; max_tokens: number };
    expect(body.thinking?.type).not.toBe('disabled');
    // `max_tokens` caps thinking and the reply together, so it needs room for both.
    expect(body.max_tokens).toBeGreaterThanOrEqual(8000);
  });

  /* ---------------------------------------------------------------- failure modes */

  it('502s on a refusal, without reading the content', async () => {
    const service = new IntentService(
      client(() => ({ ...(message('', 'refusal') as object), content: [] })),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 502 });
  });

  it('502s when the reply is not JSON', async () => {
    const service = new IntentService(
      client(() => message('Sure, I can help with that!')),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 502 });
  });

  it('502s when the reply is JSON but the wrong shape', async () => {
    const service = new IntentService(
      client(() => message(JSON.stringify({ reply: 'hi', intents: 'lots', suggestions: [] }))),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 502 });
  });

  /*
   * The bounds the JSON Schema cannot express. Structured outputs supports neither numeric nor
   * string limits, so a factor of 50 is shape-valid and has to be caught here.
   */
  it('502s on an out-of-range value the JSON Schema could not constrain', async () => {
    const service = new IntentService(
      client(() =>
        message(
          JSON.stringify({
            ...envelope,
            intents: [{ kind: 'resize', target: { elementIds: ['e-1'] }, factor: 50 }],
          }),
        ),
      ),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 502 });
  });

  it('503s when rate limited, so the client knows to wait', async () => {
    const service = new IntentService(
      client(() => {
        throw new Anthropic.RateLimitError(429, null, 'slow down', new Headers());
      }),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 503 });
  });

  it('503s when the model cannot be reached', async () => {
    const service = new IntentService(
      client(() => {
        throw new Anthropic.APIConnectionError({ message: 'offline' });
      }),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 503 });
  });

  /* A bad key on the server is not the caller's fault, and not the caller's business either. */
  it('503s on a bad key rather than leaking that it is a credentials problem', async () => {
    const service = new IntentService(
      client(() => {
        throw new Anthropic.AuthenticationError(401, null, 'bad key', new Headers());
      }),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 503 });
  });

  it('502s on any other API error', async () => {
    const service = new IntentService(
      client(() => {
        throw new Anthropic.InternalServerError(500, null, 'boom', new Headers());
      }),
      config(),
    );

    await expect(service.interpret('hello', plan())).rejects.toMatchObject({ status: 502 });
  });
});

/*
 * The JSON Schema is hand-written because the SDK's Zod helper needs Zod v4 and this project is on
 * v3. These assertions are what keep the two from drifting: same vocabulary, and every branch the
 * schema describes actually parses.
 */
describe('the hand-written JSON Schema agrees with the Zod schema', () => {
  const intentBranches = INTENT_JSON_SCHEMA.properties.intents.items.anyOf;

  it('describes every intent kind the Zod union accepts', () => {
    const kinds = intentBranches.map((branch) => branch.properties.kind.const);

    expect([...kinds].sort()).toEqual([
      'add',
      'material',
      'move',
      'recategorise',
      'reduce-cost',
      'remove',
      'resize',
    ]);
  });

  it('accepts one example of every branch', () => {
    const examples = [
      { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 1.2 },
      { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'house', away: false },
      { kind: 'material', target: { elementIds: ['e-1'] }, materialId: 'concrete' },
      { kind: 'recategorise', target: { elementIds: ['e-1'] }, category: 'lawn' },
      {
        kind: 'add',
        category: 'structure',
        name: 'Shed',
        footprint: { kind: 'rect', width: 2, depth: 2 },
        affinity: 'any',
      },
      { kind: 'remove', target: { elementIds: ['e-1'] } },
      { kind: 'reduce-cost', maxChanges: 3 },
    ];

    // One at a time: there are seven branches and an envelope takes at most six intents.
    for (const example of examples) {
      expect(DesignIntentSchema.safeParse(example).success, example.kind).toBe(true);
    }
  });

  /* Six is the cap, because a single sentence that produced more is a sentence to push back on. */
  it('caps how much one message can propose', () => {
    const resize = { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 1.2 };

    const envelopeOf = (count: number) =>
      AssistantIntentEnvelopeSchema.safeParse({
        reply: 'ok',
        intents: Array.from({ length: count }, () => resize),
        suggestions: ['a', 'b', 'c'],
      }).success;

    expect(envelopeOf(6)).toBe(true);
    expect(envelopeOf(7)).toBe(false);
  });

  it('offers the model only materials and zones that exist', () => {
    const materialBranch = intentBranches.find(
      (branch) => branch.properties.kind.const === 'material',
    )!;
    const moveBranch = intentBranches.find((branch) => branch.properties.kind.const === 'move')!;

    expect(materialBranch.properties.materialId.enum).toContain('stone-pavers');
    expect(materialBranch.properties.materialId.enum).not.toContain(
      'reclaimed-yorkshire-flagstone',
    );
    expect(moveBranch.properties.zone.enum).toEqual(['front', 'back', 'left', 'right']);
  });

  it('closes every object, which structured outputs requires', () => {
    const closed = (node: unknown): boolean => {
      if (typeof node !== 'object' || node === null) return true;
      const record = node as Record<string, unknown>;

      if (record.type === 'object' && record.additionalProperties !== false) return false;

      return Object.values(record).every((value) =>
        Array.isArray(value) ? value.every(closed) : closed(value),
      );
    };

    expect(closed(INTENT_JSON_SCHEMA)).toBe(true);
  });
});
