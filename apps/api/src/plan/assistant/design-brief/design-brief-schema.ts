import {
  BRIEF_EMPHASES,
  BRIEF_SLOTS,
  CIRCULATION_STYLES,
  DESIRED_FEATURES,
  FOCAL_STRATEGIES,
  FUNCTIONAL_ZONES,
  GARDEN_INTENTS,
  LAYOUT_ARCHETYPES,
  PRIORITY_TIERS,
  PRIVACY_STRATEGIES,
} from './design-brief-vocabulary.js';

/**
 * The JSON Schema handed to the model, mirroring `DesignBriefEnvelopeSchema`.
 *
 * Hand-written for the reason `intent-schema.ts` and `garden-action-schema.ts` are: the SDK's
 * `zodOutputFormat` helper needs Zod v4 and the shared package is v3, so generating it would mean
 * migrating the whole package for one call site. There is a test asserting the two agree.
 *
 * The same two constraints of structured outputs apply: every object needs
 * `additionalProperties: false` and an explicit `required`, and numeric and string *bounds* are not
 * supported — so "at most three archetypes" and "at most 400 characters of rationale" live only in
 * the Zod schema and are enforced when the response is parsed.
 *
 * **Every field here is categorical, and that is the whole design.** There is nowhere to put a
 * coordinate, a dimension or a distance: a model decides what the garden is *for* and the
 * deterministic engine decides where everything goes. The same property `DesignIntent` and
 * `GardenAction` have, and there is a test walking these property names to keep it true.
 */

const brief = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'intent',
    'emphasis',
    'primaryZone',
    'secondaryZones',
    'supportingZones',
    'archetypeShortlist',
    'circulation',
    'focal',
    'privacy',
    'featurePriorities',
    'excludedFeatures',
    'rationale',
  ],
  properties: {
    id: {
      type: 'string',
      enum: BRIEF_SLOTS,
      description:
        'Which of the three concepts this is. A is the recommendation and should be the most direct reading of what they asked for; B and C are genuine alternatives, not variations.',
    },
    intent: {
      type: 'string',
      enum: GARDEN_INTENTS,
      description: 'What this garden is chiefly for.',
    },
    emphasis: {
      type: 'string',
      enum: BRIEF_EMPHASES,
      description:
        'What this concept leans towards, and the main thing that makes the three differ: social, open, planted or productive.',
    },
    primaryZone: {
      type: 'string',
      enum: FUNCTIONAL_ZONES,
      description:
        'The one room the whole plan is organised around. It must be a room something they asked for actually goes in.',
    },
    secondaryZones: {
      type: 'array',
      description: 'Rooms that matter after the primary one. Up to four.',
      items: { type: 'string', enum: FUNCTIONAL_ZONES },
    },
    supportingZones: {
      type: 'array',
      description: 'Rooms that serve the others — utility, planting, circulation. Up to six.',
      items: { type: 'string', enum: FUNCTIONAL_ZONES },
    },
    archetypeShortlist: {
      type: 'array',
      description:
        'The compositions worth trying for this concept, best first, one to three of them. The engine scores what the plot actually allows, so a shortlist is a preference rather than a choice.',
      items: { type: 'string', enum: LAYOUT_ARCHETYPES },
    },
    circulation: {
      type: 'string',
      enum: CIRCULATION_STYLES,
      description: 'How you are meant to move through it.',
    },
    focal: {
      type: 'string',
      enum: FOCAL_STRATEGIES,
      description:
        'Where the eye lands from the garden doors. Use none rather than naming something the garden does not contain.',
    },
    privacy: {
      type: 'string',
      enum: PRIVACY_STRATEGIES,
      description: 'What this concept does about being overlooked.',
    },
    featurePriorities: {
      type: 'array',
      description:
        'Every space they asked for, ranked. Only things they actually ticked; at most four essentials.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['feature', 'tier', 'reason'],
        properties: {
          feature: { type: 'string', enum: DESIRED_FEATURES },
          tier: {
            type: 'string',
            enum: PRIORITY_TIERS,
            description:
              'essential: the concept is pointless without it. preferred: it should be there. optional: include it if the plot allows.',
          },
          reason: {
            type: 'string',
            description: 'One short clause saying why it sits there, in British English.',
          },
        },
      },
    },
    excludedFeatures: {
      type: 'array',
      description:
        'Anything they asked for that this concept deliberately leaves out. Only things they ticked, and only with a real reason — leave the list empty rather than inventing one.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['feature', 'reason'],
        properties: {
          feature: { type: 'string', enum: DESIRED_FEATURES },
          reason: {
            type: 'string',
            description:
              'What it would have cost to include it, in one sentence the owner would accept.',
          },
        },
      },
    },
    rationale: {
      type: 'string',
      description:
        'One short paragraph in British English saying what this concept is trying to be. Written to the owner, not about the software.',
    },
  },
} as const;

export const DESIGN_BRIEF_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['briefs', 'notes'],
  properties: {
    briefs: {
      type: 'array',
      description: 'Exactly three, one for slot A, one for B and one for C, in that order.',
      items: brief,
    },
    notes: {
      type: 'string',
      description:
        'A sentence or two on how the three differ from each other. Not shown to the owner; it is there so the reasoning is inspectable.',
    },
  },
} as const;
