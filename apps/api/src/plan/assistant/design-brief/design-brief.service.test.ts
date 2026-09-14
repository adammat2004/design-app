import Anthropic from '@anthropic-ai/sdk';
import type { DesignBrief } from '@garden-studio/schema';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { ARCHETYPES as BUDGET_POSITIONS } from '../../generation/archetypes.js';
import { resolveConstraints } from '../../generation/constraints.js';
import { buildBriefs } from '../../generation/design/brief-builder.js';
import { interpretRequirements } from '../../generation/design/requirements.js';
import { scenario } from '../../generation/design/scenarios.js';
import { analyseSite } from '../../generation/design/site-analysis.js';
import { DesignBriefService } from './design-brief.service.js';
import { DESIGN_BRIEF_JSON_SCHEMA } from './design-brief-schema.js';
import { DESIGN_BRIEF_RULES } from './design-brief-rules.js';

/**
 * The model is always faked here, as it is for the other two assistants.
 *
 * There is no key in the test environment and there should not be. What is worth testing is
 * everything up to the request and everything after the response — and, uniquely for this service,
 * that **nothing it can be handed makes generation fail**. It sits on the generation path rather
 * than behind an endpoint someone is waiting on, so its contract is not "answer or report an error"
 * but "improve the brief or get out of the way".
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

/** The site, the brief and the deterministic answer the service is asked to improve on. */
function subject() {
  const document = scenario('small-entertaining').document;
  const analysis = analyseSite(document);
  const constraints = resolveConstraints(
    document.brief,
    BUDGET_POSITIONS[0]!,
    analysis.scale.designedArea,
  );
  const requirements = interpretRequirements(document.brief, analysis, constraints);
  const fallback = buildBriefs(document.brief, requirements, analysis);
  return { brief: document.brief, analysis, requirements, fallback };
}

/** An envelope the model might plausibly return: the default, with the intent read differently. */
function envelopeFrom(fallback: DesignBrief[], over: Partial<DesignBrief> = {}): string {
  return JSON.stringify({
    briefs: fallback.map((brief) => ({ ...brief, ...over })),
    notes: 'Three readings of the same brief.',
  });
}

function service(create: () => unknown, values: Record<string, string> = {}) {
  return new DesignBriefService(
    client(create) as unknown as Anthropic,
    config({ DESIGN_BRIEF_LLM: 'true', ...values }),
  );
}

describe('the strategic brief service', () => {
  /* ---------------------------------------------------------------- the gate */

  it('is unavailable with no key, however the flag is set', () => {
    expect(new DesignBriefService(null, config({ DESIGN_BRIEF_LLM: 'true' })).available).toBe(
      false,
    );
    expect(new DesignBriefService(null, config()).available).toBe(false);
  });

  /**
   * Off by default, and this is the assertion that keeps it that way. Step 4 generates the moment
   * a user arrives on it, so a default-on model call would spend on every visit to a screen people
   * open to look around.
   */
  it('is off unless the flag is explicitly true', async () => {
    const subjectOf = subject();
    const create = vi.fn(() => message(envelopeFrom(subjectOf.fallback)));
    const instance = new DesignBriefService(
      client(create) as unknown as Anthropic,
      config({ DESIGN_BRIEF_LLM: undefined as unknown as string }),
    );

    expect(instance.available).toBe(false);
    const briefs = await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    expect(briefs).toBe(subjectOf.fallback);
    expect(create).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- the request */

  it('sends the standing rules under a cache breakpoint, and the site after them', async () => {
    const subjectOf = subject();
    const create = vi.fn(() => message(envelopeFrom(subjectOf.fallback)));
    const instance = service(create);

    await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    const request = create.mock.calls[0]![0] as Record<string, unknown>;
    const system = request.system as { text: string; cache_control?: unknown }[];

    expect(system[0]!.text).toBe(DESIGN_BRIEF_RULES);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });

    /* The site summary changes every call, so it must sit *after* the breakpoint, not in it. */
    const messages = request.messages as { role: string; content: string }[];
    expect(messages[0]!.content).toContain('THE SITE');
    expect(system.map((block) => block.text).join('')).not.toContain('THE SITE');
  });

  it('asks for structured output against the hand-written schema, with thinking left on', async () => {
    const subjectOf = subject();
    const create = vi.fn(() => message(envelopeFrom(subjectOf.fallback)));

    await service(create).write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    const request = create.mock.calls[0]![0] as Record<string, unknown>;
    const output = request.output_config as { effort: string; format: { schema: unknown } };

    expect(output.format.schema).toBe(DESIGN_BRIEF_JSON_SCHEMA);
    expect(output.effort).toBe('low');
    /* `max_tokens` caps thinking and text together, so it has to leave room for both. */
    expect(request.max_tokens).toBe(16_000);
    expect(request).not.toHaveProperty('thinking');
  });

  /**
   * No coordinates in the prompt, and this is the check rather than the convention.
   *
   * The site analysis is full of rings and centres; what the model gets is areas, a shape word and
   * two room dimensions. A number that could be acted on positionally would invite exactly the
   * reasoning the architecture puts in the engine.
   */
  it('tells the model nothing it could place something with', async () => {
    const subjectOf = subject();
    const create = vi.fn(() => message(envelopeFrom(subjectOf.fallback)));

    await service(create).write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    const request = create.mock.calls[0]![0] as Record<string, unknown>;
    const prompt = (request.messages as { content: string }[])[0]!.content;

    for (const vertex of subjectOf.analysis.boundary) {
      expect(prompt).not.toContain(`${vertex.x},${vertex.y}`);
    }
    expect(prompt).not.toMatch(/\bx\s*[:=]/);
    expect(prompt).not.toMatch(/\by\s*[:=]/);
  });

  /* ---------------------------------------------------------------- the response */

  it('takes what the model decided, reconciled against what was asked for', async () => {
    const subjectOf = subject();
    const create = () => message(envelopeFrom(subjectOf.fallback, { intent: 'relaxation' }));

    const briefs = await service(create).write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    expect(briefs.map((brief) => brief.intent)).toEqual(['relaxation', 'relaxation', 'relaxation']);
  });

  /**
   * The contract that makes this safe to switch on, asserted against every way it can go wrong.
   *
   * Nobody is waiting on this call — a user is waiting on a garden — so a model that refuses, times
   * out, returns prose, returns nothing or returns the wrong shape must all produce the same thing:
   * the brief the generator would have written anyway.
   */
  it('falls back to the deterministic brief on every kind of failure', async () => {
    const subjectOf = subject();

    const failures: [string, () => unknown][] = [
      ['a refusal', () => message('', 'refusal')],
      ['an empty answer', () => message('')],
      ['prose instead of JSON', () => message('I think a terrace would be lovely.')],
      ['JSON of the wrong shape', () => message(JSON.stringify({ briefs: [], notes: '' }))],
      [
        'two briefs instead of three',
        () => message(JSON.stringify({ briefs: subjectOf.fallback.slice(0, 2), notes: '' })),
      ],
      [
        'a thrown API error',
        () => {
          throw new Anthropic.APIConnectionError({ message: 'unreachable' });
        },
      ],
      [
        'a timeout',
        () => {
          throw new Error('Request timed out.');
        },
      ],
    ];

    for (const [name, create] of failures) {
      const briefs = await service(create).write(
        subjectOf.brief,
        subjectOf.analysis,
        subjectOf.requirements,
        subjectOf.fallback,
      );

      expect(briefs, name).toBe(subjectOf.fallback);
    }
  });

  /* ---------------------------------------------------------------- the cache */

  /**
   * A set of three and a reroll of one slot ask the same strategic question, and the answer cannot
   * depend on the seed — so paying twice would be paying for nothing. Keyed on the rendered inputs
   * rather than on the document, so nudging a boundary vertex on an earlier step does not either.
   */
  it('answers a repeated question from the cache rather than the model', async () => {
    const subjectOf = subject();
    const create = vi.fn(() => message(envelopeFrom(subjectOf.fallback, { intent: 'showcase' })));
    const instance = service(create);

    const once = await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );
    const twice = await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(twice).toEqual(once);
  });

  it('asks again when the brief actually changed', async () => {
    const subjectOf = subject();
    const create = vi.fn(() => message(envelopeFrom(subjectOf.fallback)));
    const instance = service(create);

    await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );
    await instance.write(
      { ...subjectOf.brief, maintenance: 'low' },
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    expect(create).toHaveBeenCalledTimes(2);
  });

  /**
   * A refusal is not an answer, and caching one would be wrong twice over: it would disable the
   * feature for ten minutes, and it would come back as an array the caller can no longer tell apart
   * from a real answer by identity — which is how it distinguishes them.
   */
  it('does not remember a refusal', async () => {
    const subjectOf = subject();
    let calls = 0;
    const create = vi.fn(() => {
      calls += 1;
      if (calls === 1) return message('', 'refusal');
      return message(envelopeFrom(subjectOf.fallback, { intent: 'showcase' }));
    });
    const instance = service(create);

    const first = await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );
    const second = await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    expect(first).toBe(subjectOf.fallback);
    expect(second.every((brief) => brief.intent === 'showcase')).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  /* A failure must not be cached, or one outage would disable the feature for ten minutes. */
  it('does not remember a failure', async () => {
    const subjectOf = subject();
    let calls = 0;
    const create = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return message(envelopeFrom(subjectOf.fallback, { intent: 'family' }));
    });
    const instance = service(create);

    const first = await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );
    const second = await instance.write(
      subjectOf.brief,
      subjectOf.analysis,
      subjectOf.requirements,
      subjectOf.fallback,
    );

    expect(first).toBe(subjectOf.fallback);
    expect(second.every((brief) => brief.intent === 'family')).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
