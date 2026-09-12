import {
  FeatureKindSchema,
  FeatureStatusSchema,
  GardenActionSchema,
  GardenAnchorSchema,
  GardenEnvelopeSchema,
  ZoneIdSchema,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { GARDEN_ACTION_JSON_SCHEMA } from './garden-action-schema.js';

/**
 * The JSON Schema is hand-written, so this is what keeps it honest.
 *
 * The failure it exists to catch is silent: a branch or an enum value that drifts between the two
 * means the model returns something the Zod parse then rejects, and the user sees "the assistant
 * returned something unexpected" with nothing in the logs about which field.
 *
 * The same shape of test as `intent.service.test.ts`'s, deliberately — if one of them grows a
 * better check, the other should get it too.
 */
describe('the hand-written JSON Schema agrees with the Zod schema', () => {
  const branches = GARDEN_ACTION_JSON_SCHEMA.properties.actions.items.anyOf;

  it('describes every action kind the Zod union accepts', () => {
    const kinds = branches.map((branch) => branch.properties.kind.const);

    expect([...kinds].sort()).toEqual(['add', 'delete', 'move', 'resize', 'scope', 'status']);
  });

  it('accepts one example of every branch', () => {
    const examples = [
      { kind: 'add', feature: 'shed', at: 'back-left', count: 1 },
      { kind: 'move', featureId: 'f1', to: 'along-right-fence' },
      { kind: 'resize', featureId: 'f1', factor: 1.25 },
      { kind: 'delete', featureId: 'f1' },
      { kind: 'status', featureId: 'f1', status: 'keep', replaceWith: null },
      { kind: 'scope', zones: ['back'] },
    ];

    for (const example of examples) {
      expect(GardenActionSchema.safeParse(example).success, example.kind).toBe(true);
    }
  });

  it('offers the model only feature kinds, places, statuses and zones that exist', () => {
    const add = branches.find((branch) => branch.properties.kind.const === 'add')!;
    const status = branches.find((branch) => branch.properties.kind.const === 'status')!;
    const scope = branches.find((branch) => branch.properties.kind.const === 'scope')!;

    expect([...add.properties.feature.enum]).toEqual([...FeatureKindSchema.options]);
    expect([...add.properties.at.enum]).toEqual([...GardenAnchorSchema.options]);
    expect([...status.properties.status.enum]).toEqual([...FeatureStatusSchema.options]);
    expect([...scope.properties.zones.items.enum]).toEqual([...ZoneIdSchema.options]);
  });

  /*
   * Structured outputs refuses a schema with a missing `additionalProperties` or `required`, and
   * the error names the whole schema rather than the branch — so this is far cheaper to find here.
   */
  it('closes every object and states what each branch requires', () => {
    expect(GARDEN_ACTION_JSON_SCHEMA.additionalProperties).toBe(false);

    for (const branch of branches) {
      expect(branch.additionalProperties, branch.properties.kind.const).toBe(false);
      expect(branch.required.length, branch.properties.kind.const).toBeGreaterThan(0);
      expect(branch.required, branch.properties.kind.const).toContain('kind');
    }
  });

  /* Eight is the cap: a single sentence that described more is one to ask a question about. */
  it('caps how much one message can record', () => {
    const action = { kind: 'delete', featureId: 'f1' };

    const envelopeOf = (count: number) =>
      GardenEnvelopeSchema.safeParse({
        reply: 'ok',
        actions: Array.from({ length: count }, () => action),
        suggestions: [],
      }).success;

    expect(envelopeOf(8)).toBe(true);
    expect(envelopeOf(9)).toBe(false);
  });

  /*
   * The property the whole design rests on, asserted rather than trusted: there is nowhere in the
   * action vocabulary to put a coordinate, so "the assistant never writes coordinates" is a fact
   * about the type rather than a line in a prompt.
   */
  it('has nowhere to put a coordinate', () => {
    /*
     * Property *names*, walked, rather than a regex over the serialised schema — "centre" is a
     * perfectly good anchor value ("back-centre"), so a text search finds it and proves nothing.
     * What matters is that no field is called x, y, centre or points.
     */
    const names = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;

      if (record.properties && typeof record.properties === 'object') {
        for (const key of Object.keys(record.properties)) names.add(key);
      }
      for (const value of Object.values(record)) walk(value);
    };
    walk(GARDEN_ACTION_JSON_SCHEMA);

    expect(names.size).toBeGreaterThan(0);
    // Note `at` is fine and is not on this list: it is the anchor, an enum of place names.
    for (const forbidden of ['x', 'y', 'centre', 'center', 'coordinates', 'points']) {
      expect(names, forbidden).not.toContain(forbidden);
    }

    // And the type refuses one even if a model tried.
    expect(
      GardenActionSchema.safeParse({ kind: 'add', feature: 'shed', at: { x: 4, y: 2 } }).success,
    ).toBe(false);
  });
});
