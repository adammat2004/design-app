import { ELEMENT_CATEGORIES, MATERIAL_IDS, ZONE_IDS } from './vocabulary.js';

/**
 * The JSON Schema handed to the model, mirroring `AssistantIntentEnvelopeSchema`.
 *
 * Hand-written rather than generated. The SDK's `zodOutputFormat` helper requires Zod v4 and this
 * project's schemas are Zod v3, so converting would mean migrating the shared package for one
 * call site. There is a test asserting the two agree — that every branch here parses under the
 * Zod schema, and that the enums are the same lists.
 *
 * Two constraints of the structured-outputs feature shape this:
 *
 *  - every object needs `additionalProperties: false` and an explicit `required`;
 *  - numeric and string *bounds* are not supported, so the ranges live only in the Zod schema and
 *    are enforced when the response is parsed. The planner clamps anyway, so a model that asks to
 *    make something ten times bigger gets told what it actually got.
 */

/**
 * The one shape every verb that acts on existing elements takes, written once.
 *
 * It was inlined at nine sites, which is nine objects for the grammar compiler to build instead of
 * one. `$defs` with an internal `$ref` is on the structured-outputs supported list; an *external*
 * `$ref` is not, and none is used here — every reference below is `#/$defs/...`.
 */
const $defs = {
  target: {
    type: 'object',
    additionalProperties: false,
    required: ['elementIds'],
    properties: {
      elementIds: {
        type: 'array',
        description: 'Ids copied exactly from the inventory. Never invent one.',
        items: { type: 'string' },
      },
    },
  },
} as const;

/**
 * A reference, and deliberately nothing beside it.
 *
 * Draft 2020-12 allows keywords next to `$ref`, but this compiler is not documented as honouring
 * them and `allOf` with `$ref` is explicitly unsupported — so a branch with something extra to say
 * about its target says it on the branch. See `attach`.
 */
const target = { $ref: '#/$defs/target' } as const;

const footprint = {
  type: 'object',
  additionalProperties: false,
  /*
   * All four required, with `0` standing for "not this kind of footprint".
   *
   * Zod keeps the honest shape — `IntentFootprintSchema` is a discriminated union where a point has
   * a radius and no width — and a `z.object` strips keys outside its own branch, so the `0`s never
   * reach the planner and the `.min(0.3)` bounds are never consulted for a key that is not there.
   */
  required: ['kind', 'width', 'depth', 'radius'],
  properties: {
    kind: { type: 'string', enum: ['rect', 'point', 'strip'] },
    width: { type: 'number', description: 'Metres, for rect and strip. 0 for a point.' },
    depth: { type: 'number', description: 'Metres, for rect. 0 for a point or a strip.' },
    radius: { type: 'number', description: 'Metres, for point. 0 for a rect or a strip.' },
  },
} as const;

export const INTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  $defs,
  required: ['reply', 'intents', 'suggestions'],
  properties: {
    reply: {
      type: 'string',
      description:
        'One or two sentences to the user, in British English, in the future tense — "I\'ll enlarge the terrace". You are about to do this and they are about to watch it happen. Never the past tense: some lines may be refused, and the editor reports what actually landed.',
    },
    intents: {
      type: 'array',
      description:
        'What to do, ordered the way a designer works: surfaces, then circulation, then planting, then lighting. Empty when the message is a question rather than a request.',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'factor'],
            properties: {
              kind: { type: 'string', const: 'resize' },
              target,
              factor: {
                type: 'number',
                description: 'Scale factor. 1.25 is "a bit bigger", 0.75 is "a bit smaller".',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'towards', 'elementId', 'away'],
            properties: {
              kind: { type: 'string', const: 'move' },
              target,
              towards: { type: 'string', enum: ['house', 'boundary', 'zone', 'element'] },
              zone: { type: 'string', enum: ZONE_IDS },
              elementId: {
                type: 'string',
                description:
                  'The id, from the inventory, of the thing to move it nearer, when towards is "element". Empty string otherwise. Must not be one of the targets.',
              },
              away: {
                type: 'boolean',
                description: 'Move away from it rather than towards it. False unless asked.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'edge', 'metres'],
            properties: {
              kind: { type: 'string', const: 'reshape' },
              target,
              edge: {
                type: 'string',
                enum: ['towards-house', 'away-from-house'],
                description: 'Which side of the shape to move. Its other sides stay put.',
              },
              metres: {
                type: 'number',
                description:
                  'How far to move that side. Positive deepens it, negative pulls it back. Use this for "make the border deeper" — a resize would make it longer as well.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target'],
            description:
              'Take the furniture with it. The targets are the surfaces whose furniture should travel with them — use this after moving or resizing something people sit or eat on, so the table does not end up on the grass.',
            properties: {
              kind: { type: 'string', const: 'attach' },
              target,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'materialId'],
            properties: {
              kind: { type: 'string', const: 'material' },
              target,
              materialId: { type: 'string', enum: MATERIAL_IDS },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'category'],
            properties: {
              kind: { type: 'string', const: 'recategorise' },
              target,
              category: { type: 'string', enum: ELEMENT_CATEGORIES },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'category', 'name', 'footprint', 'affinity'],
            properties: {
              kind: { type: 'string', const: 'add' },
              category: { type: 'string', enum: ELEMENT_CATEGORIES },
              name: { type: 'string', description: 'What to label it on the plan.' },
              footprint,
              zone: { type: 'string', enum: ZONE_IDS },
              affinity: {
                type: 'string',
                enum: ['near-house', 'far-from-house', 'along-boundary', 'any'],
                description: 'Where it wants to sit. "any" unless they said.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'objective', 'avoidElementIds', 'connectElementId'],
            properties: {
              kind: { type: 'string', const: 'reroute' },
              target,
              objective: {
                type: 'string',
                enum: ['direct', 'avoid', 'connect'],
                description:
                  'What the path should achieve: a straighter line, getting clear of things, or reaching something else. Never the points of the path — the planner draws those.',
              },
              avoidElementIds: {
                type: 'array',
                description:
                  'With objective "avoid": the elements the path should stop crossing. Empty otherwise.',
                items: { type: 'string' },
              },
              connectElementId: {
                type: 'string',
                description:
                  'With objective "connect": the element the path should reach. Empty string otherwise.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'to', 'elementId'],
            properties: {
              kind: { type: 'string', const: 'rotate' },
              target,
              to: {
                type: 'string',
                enum: ['house', 'boundary', 'element'],
                description:
                  'What to square it to. There is no angle: the planner turns it the shortest way that lines it up and still fits.',
              },
              elementId: {
                type: 'string',
                description:
                  'With to "element": the element to line up with. Empty string otherwise. Not the target itself.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target'],
            properties: {
              kind: { type: 'string', const: 'remove' },
              target,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'maxChanges'],
            properties: {
              kind: { type: 'string', const: 'reduce-cost' },
              maxChanges: {
                type: 'integer',
                description: 'How many things to change at most. 5 unless they said otherwise.',
              },
            },
          },
        ],
      },
    },
    suggestions: {
      type: 'array',
      description: 'Three or four short follow-up prompts the user might tap next.',
      items: { type: 'string' },
    },
  },
} as const;
