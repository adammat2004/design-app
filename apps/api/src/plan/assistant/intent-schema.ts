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
        'One or two sentences to the user, in British English, in the conditional — "I have proposed", never "I have made". The changes have not happened yet.',
    },
    intents: {
      type: 'array',
      description: 'What to propose. Empty when the message is a question rather than a request.',
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
              towards: { type: 'string', enum: ['house', 'boundary', 'zone'] },
              zone: { type: 'string', enum: ZONE_IDS },
              away: { type: 'boolean', description: 'Move away from it rather than towards it.' },
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
