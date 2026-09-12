import { FEATURE_KINDS, FEATURE_STATUSES, GARDEN_ANCHORS, ZONE_IDS } from './garden-vocabulary.js';

/**
 * The JSON Schema handed to the model, mirroring `GardenEnvelopeSchema`.
 *
 * Hand-written for the reason `intent-schema.ts` is: the SDK's `zodOutputFormat` helper needs Zod
 * v4 and the shared package is v3, so generating it would mean migrating the whole package for one
 * call site. There is a test asserting the two agree — every branch here parses under the Zod
 * schema, and the enums are the same lists.
 *
 * The same two constraints of structured outputs apply: every object needs
 * `additionalProperties: false` and an explicit `required`, and numeric and string *bounds* are not
 * supported — so ranges live only in the Zod schema and are enforced when the response is parsed.
 */

const size = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['rect', 'point'] },
    width: { type: 'number', description: 'Metres. For rect.' },
    depth: { type: 'number', description: 'Metres. For rect.' },
    radius: { type: 'number', description: 'Metres. For point.' },
  },
} as const;

export const GARDEN_ACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'actions', 'suggestions'],
  properties: {
    reply: {
      type: 'string',
      description:
        'One or two sentences to the user, in British English, in the past tense — "Added a shed and two trees." The changes are applied straight away, so do not use the conditional.',
    },
    actions: {
      type: 'array',
      description:
        'What to record. Empty when the message is a question rather than a description of their garden.',
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'feature', 'at'],
            properties: {
              kind: { type: 'string', const: 'add' },
              feature: { type: 'string', enum: FEATURE_KINDS },
              at: {
                type: 'string',
                enum: GARDEN_ANCHORS,
                description:
                  'Read relative to their house and garden doors, not to the screen. "left" and "right" are as you stand at the doors looking down the garden.',
              },
              zone: { type: 'string', enum: ZONE_IDS },
              count: {
                type: 'integer',
                description: 'How many of this thing, in this place. "Two trees" is count 2.',
              },
              size,
              name: { type: 'string', description: 'Only when they named it themselves.' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'featureId', 'to'],
            properties: {
              kind: { type: 'string', const: 'move' },
              featureId: {
                type: 'string',
                description: 'Copied exactly from the inventory. Never invent one.',
              },
              to: { type: 'string', enum: GARDEN_ANCHORS },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'featureId', 'factor'],
            properties: {
              kind: { type: 'string', const: 'resize' },
              featureId: { type: 'string' },
              factor: {
                type: 'number',
                description: 'Scale factor. 1.25 is "a bit bigger", 0.75 is "a bit smaller".',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'featureId'],
            properties: {
              kind: { type: 'string', const: 'delete' },
              featureId: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'featureId', 'status'],
            properties: {
              kind: { type: 'string', const: 'status' },
              featureId: { type: 'string' },
              status: {
                type: 'string',
                enum: FEATURE_STATUSES,
                description:
                  'keep: the design must work around it. remove: it may go. replace: keep the space, change the thing.',
              },
              replaceWith: {
                type: 'string',
                description: 'Only meaningful with status replace. What they want there instead.',
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'zones'],
            properties: {
              kind: { type: 'string', const: 'scope' },
              zones: {
                type: 'array',
                description: 'Which gardens to redesign. Only when they actually say.',
                items: { type: 'string', enum: ZONE_IDS },
              },
            },
          },
        ],
      },
    },
    suggestions: {
      type: 'array',
      description: 'Up to four short follow-ups the user might tap next, in their words.',
      items: { type: 'string' },
    },
  },
} as const;
