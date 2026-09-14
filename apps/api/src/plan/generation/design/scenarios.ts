import {
  PlanDocumentSchema,
  rectangleHouse,
  rectanglePlotOutline,
  suggestedAccess,
  type DesiredFeature,
  type GardenBrief,
  type PlanDocument,
} from '@garden-studio/schema';

/**
 * The situations a garden designer has to be able to handle, as documents.
 *
 * Seven plots chosen because each one breaks a different assumption the current generator makes,
 * and each has an expectation a person could check by looking at the drawing. They are shared by
 * the unit tests and the evaluation harness deliberately: a scenario that only a test knows about
 * cannot be reported on, and a benchmark that measures a different garden from the one the test
 * pins is two sources for one claim.
 *
 * Every one is a plain `PlanDocument`, built through `suggestedAccess` so the doors, the side gate
 * and the street edge are inferred exactly as step 1 would infer them — which means the scenarios
 * exercise the real access model rather than a convenient one.
 *
 * No seeds and no expectations here. The scenario is the *input*; what should come out of it is the
 * test's business, and the harness only reports what did.
 */

export interface Scenario {
  key: string;
  title: string;
  /** What a designer should do with this plot, in one sentence. Printed by the harness. */
  expectation: string;
  document: PlanDocument;
}

interface Shape {
  width: number;
  depth: number;
  houseWidth: number;
  houseDepth: number;
  /** Where the house's centre sits down the plot. Defaults to the back wall of the plot. */
  houseY?: number;
  /** A plot with a corner taken out of it, given as the L's return. */
  lShape?: { limbWidth: number; limbDepth: number };
  /**
   * Degrees clockwise from screen-up to true north.
   *
   * Every one of these plots puts the house at the far end of the plot in +y, so at the default
   * orientation the garden lies north of the house and is in its shadow all afternoon. That is a
   * perfectly real kind of garden and a bad thing for *all* the fixtures to be: the harness cannot
   * tell a sun rule that discriminates from one that always fails. Turning a couple of them round
   * gives the principle something to be right about in both directions.
   */
  orientation?: number;
}

function document(shape: Shape, brief: Partial<GardenBrief>, located = true): PlanDocument {
  const vertices = (
    shape.lShape
      ? lOutline(shape.width, shape.depth, shape.lShape.limbWidth, shape.lShape.limbDepth)
      : rectanglePlotOutline({ width: shape.width, depth: shape.depth })
  ).map((point, index) => ({ ...point, id: `v${index}` }));

  return PlanDocumentSchema.parse({
    version: 3,
    unit: 'm',
    site: suggestedAccess(
      PlanDocumentSchema.shape.site.parse({
        vertices,
        closed: true,
        house: rectangleHouse(
          { x: shape.width / 2, y: shape.houseY ?? shape.depth - shape.houseDepth / 2 },
          shape.houseWidth,
          shape.houseDepth,
        ),
        selectedZoneIds: ['back', 'left', 'right'],
        orientation: shape.orientation ?? 0,
        /*
         * Manchester. A real latitude, so the sun principle has something to say — and stated
         * rather than assumed, which is the whole rule about `location`. The one scenario without
         * it is there to prove the unlocated path scores on eight principles rather than nine.
         */
        ...(located ? { location: { latitude: 53.4, longitude: -2.98 } } : {}),
      }),
    ),
    brief: {
      purpose: '',
      desiredFeatures: [],
      featuresOther: '',
      budget: 'medium',
      maintenance: 'medium',
      style: 'modern',
      styleOther: '',
      ...brief,
    },
  });
}

/**
 * An L-shaped plot: a bite out of the corner **furthest from the house**, which sits at the far end
 * of the plot (+y). That is where a real L-shaped garden's notch is — a neighbour's plot cutting
 * into the bottom of yours — and it is the case the grammar finds hard, because the room behind the
 * door wall is then a shape no single rectangle fits.
 */
function lOutline(width: number, depth: number, limbWidth: number, limbDepth: number) {
  return [
    { x: 0, y: 0 },
    { x: width - limbWidth, y: 0 },
    { x: width - limbWidth, y: limbDepth },
    { x: width, y: limbDepth },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
}

const EVERYTHING: DesiredFeature[] = [
  'seating',
  'dining',
  'pergola',
  'firePit',
  'hotTub',
  'outdoorKitchen',
  'gardenRoom',
  'greenhouse',
  'vegPatch',
  'plantingBeds',
  'lawn',
  'water',
  'play',
  'storage',
  'lighting',
];

export const SCENARIOS: Scenario[] = [
  {
    key: 'small-entertaining',
    title: 'Small entertaining garden, too much asked of it',
    expectation:
      'Does not include everything. Dining and the terrace survive; the lower-priority features are excluded with reasons rather than crammed in.',
    document: document(
      { width: 8, depth: 14, houseWidth: 6, houseDepth: 4 },
      {
        purpose: 'We have friends over constantly and want somewhere proper to eat outside.',
        desiredFeatures: [
          'seating',
          'dining',
          'pergola',
          'outdoorKitchen',
          'firePit',
          'water',
          'storage',
          'plantingBeds',
          'lighting',
        ],
      },
    ),
  },

  {
    key: 'long-narrow',
    title: 'Long narrow garden',
    expectation:
      'A sequential layout rather than one room: zones in order down the length, and a route that connects them without running the full width.',
    document: document(
      { width: 6, depth: 28, houseWidth: 5, houseDepth: 5 },
      {
        purpose: 'A long thin garden that currently feels like a corridor.',
        desiredFeatures: ['seating', 'lawn', 'firePit', 'storage', 'plantingBeds'],
        style: 'cottage',
      },
    ),
  },

  {
    key: 'wide-shallow',
    title: 'Wide shallow garden',
    expectation:
      'Side-by-side zoning along the house wall rather than a long-axis plan. A formal axis should not be offered at all.',
    document: document(
      /*
       * 22 × 15 m with the house across the far end, so the *garden* is 22 × 11 — the shape this
       * scenario is about. The first version said `depth: 9` meaning the garden and got the plot:
       * with a 4 m house in it the room behind the doors was 4.5 m deep, which is not a wide
       * shallow garden but a courtyard, and the compositions said so.
       */
      { width: 22, depth: 15, houseWidth: 11, houseDepth: 4, houseY: 13, orientation: 180 },
      {
        purpose: 'Wide and shallow: it needs to feel like more than a strip behind the house.',
        desiredFeatures: ['seating', 'dining', 'lawn', 'plantingBeds', 'storage'],
      },
    ),
  },

  {
    key: 'side-gate-shed',
    title: 'Side gate and a shed',
    expectation:
      'The store goes where the bins can reach it — near the side gate, on the boundary, out of the view from the doors.',
    document: document(
      { width: 12, depth: 18, houseWidth: 8, houseDepth: 5 },
      {
        purpose: 'Somewhere to keep the mower and the bins that is not the middle of the garden.',
        desiredFeatures: ['seating', 'storage', 'lawn', 'plantingBeds'],
      },
    ),
  },

  {
    key: 'family-play',
    title: 'Family garden with a play area',
    expectation:
      'The play area is visible from the house and well clear of anything hazardous. The lawn stays continuous.',
    document: document(
      { width: 14, depth: 20, houseWidth: 9, houseDepth: 5, orientation: 180 },
      {
        purpose: 'Two small children. We need to be able to see them from the kitchen.',
        desiredFeatures: ['seating', 'play', 'lawn', 'storage', 'firePit', 'plantingBeds'],
      },
    ),
  },

  {
    key: 'modern-vs-natural',
    title: 'The same plot, read as modern',
    expectation:
      'Cleaner geometry and stronger alignment than the naturalistic reading of the identical plot.',
    document: document(
      { width: 13, depth: 19, houseWidth: 9, houseDepth: 5 },
      {
        purpose: 'Clean lines, not fussy.',
        desiredFeatures: ['seating', 'dining', 'lawn', 'plantingBeds', 'water'],
        style: 'modern',
      },
    ),
  },

  {
    key: 'natural-twin',
    title: 'The same plot, read as naturalistic',
    expectation:
      'Curves, deeper planting and a less direct route than the modern reading of the identical plot.',
    document: document(
      { width: 13, depth: 19, houseWidth: 9, houseDepth: 5 },
      {
        purpose: 'Relaxed and planted, nothing too straight.',
        desiredFeatures: ['seating', 'dining', 'lawn', 'plantingBeds', 'water'],
        style: 'cottage',
      },
    ),
  },

  {
    key: 'overloaded',
    title: 'Everything, on a plot that cannot hold it',
    expectation:
      'Gracefully excludes the lower-priority features with reasons. No fragmented zones, no feature crammed against another.',
    document: document(
      { width: 10, depth: 16, houseWidth: 7, houseDepth: 4 },
      {
        purpose: 'We would like all of it, honestly.',
        desiredFeatures: EVERYTHING,
        budget: 'premium',
      },
    ),
  },

  {
    key: 'l-shaped',
    title: 'L-shaped plot',
    expectation:
      'Designs the deep limb rather than proposing geometry across the notch and losing it to the sampler.',
    document: document(
      {
        width: 14,
        depth: 20,
        houseWidth: 8,
        houseDepth: 5,
        lShape: { limbWidth: 5, limbDepth: 9 },
      },
      {
        purpose: 'An awkward shape with a return down one side.',
        desiredFeatures: ['seating', 'lawn', 'storage', 'plantingBeds', 'firePit'],
      },
    ),
  },

  {
    key: 'unlocated',
    title: 'A plan with no location set',
    expectation:
      'Scores on eight principles rather than nine, and says nothing at all about sun or shade.',
    document: document(
      { width: 12, depth: 18, houseWidth: 8, houseDepth: 5 },
      {
        purpose: 'A perfectly ordinary garden whose owner never told us where it is.',
        desiredFeatures: ['seating', 'lawn', 'plantingBeds', 'storage'],
      },
      false,
    ),
  },
];

export function scenario(key: string): Scenario {
  const found = SCENARIOS.find((entry) => entry.key === key);
  if (!found) throw new Error(`No scenario named ${key}`);
  return found;
}
