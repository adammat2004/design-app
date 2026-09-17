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

const target = {
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
} as const;

const footprint = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['rect', 'point', 'strip'] },
    width: { type: 'number', description: 'Metres. For rect and strip.' },
    depth: { type: 'number', description: 'Metres. For rect.' },
    radius: { type: 'number', description: 'Metres. For point.' },
  },
} as const;

export const INTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
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
            required: ['kind', 'target', 'towards'],
            properties: {
              kind: { type: 'string', const: 'move' },
              target,
              towards: { type: 'string', enum: ['house', 'boundary', 'zone', 'element'] },
              zone: { type: 'string', enum: ZONE_IDS },
              elementId: {
                type: 'string',
                description:
                  'Required when towards is "element": the id, from the inventory, of the thing to move it nearer. Must not be one of the targets.',
              },
              away: { type: 'boolean', description: 'Move away from it rather than towards it.' },
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
            properties: {
              kind: { type: 'string', const: 'attach' },
              target: {
                ...target,
                description:
                  'The surfaces whose furniture should travel with them. Use this after moving or resizing something people sit or eat on, so the table does not end up on the grass.',
              },
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
            required: ['kind', 'category', 'name', 'footprint'],
            properties: {
              kind: { type: 'string', const: 'add' },
              category: { type: 'string', enum: ELEMENT_CATEGORIES },
              name: { type: 'string', description: 'What to label it on the plan.' },
              footprint,
              zone: { type: 'string', enum: ZONE_IDS },
              affinity: {
                type: 'string',
                enum: ['near-house', 'far-from-house', 'along-boundary', 'any'],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'objective'],
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
                description: 'With objective "avoid": the elements the path should stop crossing.',
                items: { type: 'string' },
              },
              connectElementId: {
                type: 'string',
                description: 'With objective "connect": the element the path should reach.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target', 'to'],
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
                  'With to "element": the element to line up with. Not the target itself.',
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
            required: ['kind'],
            properties: {
              kind: { type: 'string', const: 'reduce-cost' },
              maxChanges: { type: 'integer' },
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
