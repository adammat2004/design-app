import {
  GardenBriefSchema,
  PlanDocumentSchema,
  rectangleHouse,
  rectanglePlotOutline,
  suggestedAccess,
  type DesignElement,
  type DesiredFeature,
  type GardenBrief,
  type PlanDocument,
} from '@garden-studio/schema';
import { gardenBuilder, panel, rect } from './test-garden.js';

/**
 * Nine gardens of deliberately different quality, on one plot, for the scorer to be measured by.
 *
 * The scorer has always been tested a rule at a time — build the fault, check it is reported — which
 * proves each principle fires and says nothing about whether the *total* ranks gardens the way a
 * designer would. This is the other half: whole plans, in pairs that differ only in composition, so
 * "is this scorer any good" becomes a question with an answer.
 *
 * Four pairs and a floor:
 *
 * ```
 *   entertaining-good   ┐                    a terrace that holds a table, the barbecue by it,
 *   entertaining-poor   ┘ same seven things  the store out of the view, one route that arrives
 *   family-good         ┐                    play in sight of the kitchen, clear of the fire
 *   family-poor         ┘ same six things    behind the shed, beside the fire, lawn in halves
 *   planted-good        ┐                    borders deep enough to plant, seating screened
 *   planted-poor        ┘ same six things    slivers, islands, a sofa against a low railing
 *   lowMaintenance-good ┐                    two materials, gravel, nothing to mow
 *   lowMaintenance-poor ┘ same five things   the same plan in grass: four materials, all of it edge
 *   scattered             the floor: every feature in its own corner, nothing connecting them
 * ```
 *
 * **Every pair holds its contents constant.** A good plan that also has more in it would be telling
 * us the scorer likes bigger gardens, which is not a claim anybody wants to make. What differs is
 * where things stand and how big they are.
 *
 * **The brief is part of the fixture.** Each garden carries the `GardenBrief` it is an answer to, so
 * the same garden can be scored against somebody else's brief and the difference reported — which is
 * the measurement that says whether the scorer reads a brief at all.
 *
 * Read by `scripts/eval-scorer.ts` and by `gallery.test.ts`. Neither asserts an absolute number: the
 * claims are relational, because a scorer pinned to 0.814 is a scorer nobody can improve.
 */

/* ---------------------------------------------------------------- the plot */

const WIDTH = 14;
const DEPTH = 18;
const HOUSE_DEPTH = 5;

/**
 * A 14 × 18 m plot with the house across the whole width of it, leaving a 14 × 13 m garden.
 *
 * Full width on purpose. On a plot with side returns the back zone is fenced to the house's width,
 * so a border drawn against the room's own edge is two and a half metres short of the fence and the
 * style principle reads it as an island floating in the middle of the garden. A terraced house is
 * both an ordinary British garden and the one whose room edges *are* its boundaries, which is what
 * lets a hand-built border behave like a generated one.
 */
export const GALLERY_SITE: PlanDocument = PlanDocumentSchema.parse({
  version: 3,
  unit: 'm',
  site: suggestedAccess(
    PlanDocumentSchema.shape.site.parse({
      vertices: rectanglePlotOutline({ width: WIDTH, depth: DEPTH }).map((point, index) => ({
        ...point,
        id: `v${index}`,
      })),
      closed: true,
      house: rectangleHouse({ x: WIDTH / 2, y: DEPTH - HOUSE_DEPTH / 2 }, WIDTH, HOUSE_DEPTH),
      selectedZoneIds: ['back'],
      /* South-facing, so the sun principle has something to be right about rather than always failing. */
      orientation: 180,
      location: { latitude: 53.4, longitude: -2.98 },
      /*
       * Three sides described and one of them low. Privacy scores nothing against an undescribed
       * boundary, so a plot that states none of them cannot discriminate between a seat tucked
       * behind planting and a seat on show — and a railing is the case where that distinction is
       * real: 1.1 m screens nobody.
       */
      boundaryStyles: [
        { edgeVertexId: 'v0', kind: 'fence' },
        { edgeVertexId: 'v1', kind: 'railing' },
        { edgeVertexId: 'v3', kind: 'fence' },
      ],
    }),
  ),
  brief: {
    purpose: '',
    desiredFeatures: [],
    featuresOther: '',
    budget: 'medium',
    maintenance: 'medium',
    style: 'modern',
  },
});

/** The garden: everything in front of the house wall. */
const ROOM_DEPTH = DEPTH - HOUSE_DEPTH;

export interface GalleryGarden {
  key: string;
  /** What this garden is, in one sentence, for the report to print beside its numbers. */
  description: string;
  /** The brief it is an answer to. The intent is inferred from it, never asserted here. */
  brief: GardenBrief;
  elements: DesignElement[];
  featureOf: Map<string, DesiredFeature>;
  /** The garden it should beat, or be beaten by. Pairs differ only in composition. */
  counterpart: string | null;
}

interface Built {
  elements: DesignElement[];
  featureOf: Map<string, DesiredFeature>;
}

function brief(over: Partial<GardenBrief>): GardenBrief {
  return GardenBriefSchema.parse({
    purpose: '',
    desiredFeatures: [],
    featuresOther: '',
    budget: 'medium',
    maintenance: 'medium',
    style: 'modern',
    ...over,
  });
}

/* ---------------------------------------------------------------- entertaining */

const ENTERTAINING = brief({
  purpose: 'We have friends over constantly and want somewhere proper to eat outside.',
  desiredFeatures: [
    'seating',
    'dining',
    'pergola',
    'outdoorKitchen',
    'storage',
    'plantingBeds',
    'lighting',
  ],
  budget: 'high',
  style: 'modern',
});

function entertaining(good: boolean): Built {
  const { feature, fill, path } = gardenBuilder(good ? 'eg' : 'ep');
  const featureOf = new Map<string, DesiredFeature>();
  const name = (element: DesignElement, id: DesiredFeature) => {
    featureOf.set(element.id, id);
    return element;
  };

  const base = fill('lawn', panel(WIDTH / 2, ROOM_DEPTH / 2, WIDTH, ROOM_DEPTH), {
    fillKind: 'base',
  });

  if (good) {
    const lawn = fill('lawn', panel(7, 6, 8, 5.4));
    const rearBed = fill('planting-bed', panel(8.6, 1.3, 10.4, 2.2));
    const leftBed = fill('planting-bed', panel(0.7, 6.3, 1.4, 6.4));
    const rightBed = fill('planting-bed', panel(13.1, 6.05, 1.8, 5.9));

    /*
     * The dining area is the generous one, because that is what an entertaining garden is. A plan
     * whose lounging patio dwarfs the space it claims to be organised around is the fault the
     * hierarchy principle now reports, and the counterpart below is where it is meant to show up.
     */
    const terrace = name(feature('Seating patio', rect(4.7, 10.9, 4.8, 3.8)), 'seating');
    const dining = name(feature('Dining terrace', rect(10.55, 10.9, 6.9, 3.8)), 'dining');
    /*
     * Both structures stand clear of the line out of the garden doors. The cone is fifteen degrees
     * and only a handspan wide against the house, so a pergola straddling the doorway is a real
     * fault — and one this garden is not meant to be demonstrating.
     */
    const pergola = name(
      feature('Dining pergola', rect(11.4, 10.9, 4.4, 3.2), {
        category: 'structure',
        material: 'softwood',
      }),
      'pergola',
    );
    const bbq = name(
      feature('Outdoor kitchen', rect(9.8, 9.7, 1.6, 1), {
        category: 'structure',
        material: 'softwood',
      }),
      'outdoorKitchen',
    );
    const shed = name(
      feature('Garden store', rect(1.6, 1.4, 2.2, 2), {
        category: 'structure',
        material: 'softwood',
      }),
      'storage',
    );
    /*
     * Stopping short of the store rather than at it. A route is "served" when a centreline point is
     * within 0.6 m of what it serves, and it runs "through" whatever its 1.2 m strip overlaps — so
     * the only honest approach is to arrive a little over half a metre off the face.
     */
    const route = path([
      { x: 3, y: 8.9 },
      { x: 2.2, y: 2.95 },
    ]);

    return {
      elements: [
        base,
        lawn,
        rearBed,
        leftBed,
        rightBed,
        terrace,
        dining,
        pergola,
        bbq,
        shed,
        route,
        ...lights(feature, [
          { x: 2, y: 8.6 },
          { x: 12, y: 8.6 },
        ]),
      ],
      featureOf,
    };
  }

  /* The same seven things, arranged by nobody. */
  const lawnLeft = fill('lawn', panel(3, 6, 4, 4));
  const lawnRight = fill('lawn', panel(11, 6, 4, 4));
  const bedOne = fill('planting-bed', panel(5, 2, 2, 1.5));
  const bedTwo = fill('planting-bed', panel(8.5, 2, 2, 1.5));
  const bedThree = fill('planting-bed', panel(11.5, 9, 2, 1.5));

  const terrace = name(feature('Seating patio', rect(2.5, 11.4, 3, 2.6)), 'seating');
  const dining = name(feature('Dining terrace', rect(11.5, 4, 4, 3)), 'dining');
  const pergola = name(
    feature('Dining pergola', rect(2.5, 4, 3.2, 3.2), {
      category: 'structure',
      material: 'softwood',
    }),
    'pergola',
  );
  const bbq = name(
    feature('Outdoor kitchen', rect(6.5, 11.5, 1.6, 1), {
      category: 'structure',
      material: 'softwood',
    }),
    'outdoorKitchen',
  );
  const shed = name(
    feature('Garden store', rect(7, 8.5, 2.2, 2), {
      category: 'structure',
      material: 'softwood',
    }),
    'storage',
  );
  const route = path([
    { x: 2.5, y: 10 },
    { x: 1, y: 6 },
    { x: 1, y: 2 },
    { x: 6.9, y: 7 },
  ]);

  return {
    elements: [
      base,
      lawnLeft,
      lawnRight,
      bedOne,
      bedTwo,
      bedThree,
      terrace,
      dining,
      pergola,
      bbq,
      shed,
      route,
    ],
    featureOf,
  };
}

/* ---------------------------------------------------------------- family */

const FAMILY = brief({
  purpose: 'Two small children. We need to be able to see them from the kitchen.',
  desiredFeatures: ['seating', 'play', 'lawn', 'storage', 'firePit', 'plantingBeds'],
  /* Natural rather than modern, because a family garden with bark in it needs the four materials. */
  style: 'cottage',
});

function family(good: boolean): Built {
  const { feature, fill, path } = gardenBuilder(good ? 'fg' : 'fp');
  const featureOf = new Map<string, DesiredFeature>();
  const name = (element: DesignElement, id: DesiredFeature) => {
    featureOf.set(element.id, id);
    return element;
  };

  const base = fill('lawn', panel(WIDTH / 2, ROOM_DEPTH / 2, WIDTH, ROOM_DEPTH), {
    fillKind: 'base',
  });
  const terrace = name(feature('Seating patio', rect(7, 10.9, 9, 3.8)), 'seating');

  if (good) {
    /* Generous, because slot A of a family brief reads the garden as one built round open ground. */
    const lawn = fill('lawn', panel(6.6, 5.55, 10.4, 6.9));
    const rearBed = fill('planting-bed', panel(5.4, 1.1, 8, 1.8));
    /* Full-length side borders: a screen a seat is actually behind, not a panel beside the lawn. */
    const leftBed = fill('planting-bed', panel(0.8, 7.5, 1.6, 9));
    const rightBed = fill('planting-bed', panel(13.2, 7.5, 1.6, 9));

    const play = name(
      feature('Play area', rect(6, 5.6, 4, 3.4), {
        category: 'gravel-mulch',
        material: 'play-bark',
      }),
      'play',
    );
    const fire = name(
      feature(
        'Fire pit',
        { kind: 'point', at: { x: 11, y: 2.6 }, radius: 1.3 },
        {
          material: 'stone-pavers',
        },
      ),
      'firePit',
    );
    const shed = name(
      feature('Garden store', rect(1.9, 1.5, 2.2, 2), {
        category: 'structure',
        material: 'softwood',
      }),
      'storage',
    );
    const toShed = path([
      { x: 3.4, y: 8.9 },
      { x: 2.6, y: 3 },
    ]);
    const toFire = path([
      { x: 11, y: 8.9 },
      { x: 11, y: 4.3 },
    ]);

    return {
      elements: [base, lawn, rearBed, leftBed, rightBed, terrace, play, fire, shed, toShed, toFire],
      featureOf,
    };
  }

  /* The play area where nobody can see it, the fire beside it, the lawn in two. */
  const lawnLeft = fill('lawn', panel(3.2, 5.6, 5.4, 6.4));
  const lawnRight = fill('lawn', panel(10.8, 5.6, 5.4, 6.4));
  const rearBed = fill('planting-bed', panel(7, 1.1, 5, 1.8));

  const play = name(
    feature('Play area', rect(12, 2.4, 3.6, 3.2), {
      category: 'gravel-mulch',
      material: 'play-bark',
    }),
    'play',
  );
  const fire = name(
    feature(
      'Fire pit',
      { kind: 'point', at: { x: 10.2, y: 4.4 }, radius: 1.3 },
      {
        material: 'stone-pavers',
      },
    ),
    'firePit',
  );
  const shed = name(
    feature('Garden store', rect(7, 8.4, 2.2, 2), {
      category: 'structure',
      material: 'softwood',
    }),
    'storage',
  );

  return {
    elements: [base, lawnLeft, lawnRight, rearBed, terrace, play, fire, shed],
    featureOf,
  };
}

/* ---------------------------------------------------------------- planted */

const PLANTED = brief({
  purpose: 'Somewhere quiet and green to sit. Relaxed and planted, nothing too straight.',
  desiredFeatures: ['seating', 'plantingBeds', 'lawn', 'water', 'storage'],
  style: 'cottage',
});

function planted(good: boolean): Built {
  const { feature, fill, path } = gardenBuilder(good ? 'pg' : 'pp');
  const featureOf = new Map<string, DesiredFeature>();
  const name = (element: DesignElement, id: DesiredFeature) => {
    featureOf.set(element.id, id);
    return element;
  };

  const base = fill('lawn', panel(WIDTH / 2, ROOM_DEPTH / 2, WIDTH, ROOM_DEPTH), {
    fillKind: 'base',
  });

  if (good) {
    const lawn = fill('lawn', panel(7, 6.4, 8.8, 5.6), { material: 'standard-turf' });
    const rearBed = fill('planting-bed', panel(7, 1.4, 13.6, 2.8), { material: 'mixed-border' });
    const leftBed = fill('planting-bed', panel(1, 6.4, 2, 5.6), { material: 'wildflower' });
    const rightBed = fill('planting-bed', panel(13, 6.4, 2, 5.6), { material: 'mixed-border' });

    const terrace = name(feature('Seating patio', rect(7, 10.9, 8, 3.8)), 'seating');
    const water = name(
      feature(
        'Water feature',
        { kind: 'point', at: { x: 7, y: 2.2 }, radius: 1.1 },
        {
          category: 'water-feature',
          material: 'formal-pool',
        },
      ),
      'water',
    );
    const shed = name(
      feature('Garden store', rect(12.3, 8.4, 2.2, 2), {
        category: 'structure',
        material: 'softwood',
      }),
      'storage',
    );
    const route = path([
      { x: 7, y: 8.9 },
      { x: 7, y: 3.5 },
    ]);

    return {
      elements: [base, lawn, rearBed, leftBed, rightBed, terrace, water, shed, route],
      featureOf,
    };
  }

  /* Beds too thin to plant, three of them adrift, and the sofa against the railing. */
  const lawn = fill('lawn', panel(7, 6.4, 11, 6.4));
  const thinRear = fill('planting-bed', panel(7, 0.3, 12, 0.6));
  const islandOne = fill('planting-bed', panel(4, 4, 1.6, 0.5));
  const islandTwo = fill('planting-bed', panel(8, 4, 1.6, 0.5));
  const islandThree = fill('planting-bed', panel(6, 8, 1.6, 0.5));

  const terrace = name(feature('Seating patio', rect(11.4, 10.9, 5, 3.8)), 'seating');
  const water = name(
    feature(
      'Water feature',
      { kind: 'point', at: { x: 1.4, y: 1.4 }, radius: 1.1 },
      {
        category: 'water-feature',
        material: 'formal-pool',
      },
    ),
    'water',
  );
  const shed = name(
    feature('Garden store', rect(7, 9, 2.2, 2), {
      category: 'structure',
      material: 'softwood',
    }),
    'storage',
  );

  return {
    elements: [base, lawn, thinRear, islandOne, islandTwo, islandThree, terrace, water, shed],
    featureOf,
  };
}

/* ---------------------------------------------------------------- low maintenance */

const LOW_MAINTENANCE = brief({
  purpose: 'We are both out all week and have no time for it. Minimal upkeep.',
  desiredFeatures: ['seating', 'plantingBeds', 'storage'],
  maintenance: 'low',
  style: 'lowMaintenance',
});

function lowMaintenance(good: boolean): Built {
  const { feature, fill, path } = gardenBuilder(good ? 'lg' : 'lp');
  const featureOf = new Map<string, DesiredFeature>();
  const name = (element: DesignElement, id: DesiredFeature) => {
    featureOf.set(element.id, id);
    return element;
  };

  if (good) {
    const base = fill('gravel-mulch', panel(WIDTH / 2, ROOM_DEPTH / 2, WIDTH, ROOM_DEPTH), {
      fillKind: 'base',
      material: 'decorative-gravel',
    });
    const court = fill('gravel-mulch', panel(7, 6.2, 9.6, 6), { material: 'decorative-gravel' });
    const rearBed = fill('planting-bed', panel(5, 1.4, 9.6, 2.8), { material: 'mixed-border' });
    const leftBed = fill('planting-bed', panel(1, 7.4, 2, 8.4), { material: 'mixed-border' });
    const rightBed = fill('planting-bed', panel(13, 7.4, 2, 8.4), { material: 'mixed-border' });

    const terrace = name(
      feature('Seating patio', rect(7, 10.9, 9, 3.8), { material: 'porcelain' }),
      'seating',
    );
    const shed = name(
      feature('Garden store', rect(11.9, 1.5, 2.2, 2), {
        category: 'structure',
        material: 'softwood',
      }),
      'storage',
    );
    /* Paved in the terrace's own porcelain: a minimalist plan is allowed two materials, and the
     * gravel is the second. A third would be the fault this garden is the counter-example to. */
    const route = path(
      [
        { x: 9.5, y: 8.9 },
        { x: 11, y: 3.05 },
      ],
      1.2,
      'Service path',
      { material: 'porcelain' },
    );

    return {
      elements: [base, court, rearBed, leftBed, rightBed, terrace, shed, route],
      featureOf,
    };
  }

  /*
   * The same five things and the same composition — and the wrong garden.
   *
   * Deliberately *not* a badly drawn plan: it is the good one with grass where the gravel was, a
   * second paving for the route and a third for the path edge. Any other brief would be pleased with
   * it. It is a mown panel with fifty metres of edge and four materials to keep apart, given to
   * somebody who said they have no time — which is the fault no principle can currently see, and the
   * reason this pair separates four times less than the other three.
   */
  const base = fill('lawn', panel(WIDTH / 2, ROOM_DEPTH / 2, WIDTH, ROOM_DEPTH), {
    fillKind: 'base',
  });
  const lawn = fill('lawn', panel(7, 6.2, 9.6, 6));
  const rearBed = fill('planting-bed', panel(5, 1.4, 9.6, 2.8), { material: 'mixed-border' });
  const leftBed = fill('planting-bed', panel(1, 7.4, 2, 8.4), { material: 'mixed-border' });
  const rightBed = fill('planting-bed', panel(13, 7.4, 2, 8.4), { material: 'mixed-border' });

  const terrace = name(
    feature('Seating patio', rect(7, 10.9, 9, 3.8), { material: 'porcelain' }),
    'seating',
  );
  const gravel = fill('gravel-mulch', panel(3.4, 8.4, 3, 1.4), { material: 'slate-chippings' });
  const shed = name(
    feature('Garden store', rect(11.9, 1.5, 2.2, 2), {
      category: 'structure',
      material: 'softwood',
    }),
    'storage',
  );
  const route = path([
    { x: 9.5, y: 8.9 },
    { x: 11, y: 3.05 },
  ]);

  return {
    elements: [base, lawn, rearBed, leftBed, rightBed, gravel, terrace, shed, route],
    featureOf,
  };
}

/* ---------------------------------------------------------------- the floor */

function scattered(): Built {
  const { feature, fill } = gardenBuilder('sc');
  const featureOf = new Map<string, DesiredFeature>();
  const name = (element: DesignElement, id: DesiredFeature) => {
    featureOf.set(element.id, id);
    return element;
  };

  const base = fill('lawn', panel(WIDTH / 2, ROOM_DEPTH / 2, WIDTH, ROOM_DEPTH), {
    fillKind: 'base',
  });

  return {
    elements: [
      base,
      name(feature('Seating patio', rect(1.8, 1.6, 3, 2.6)), 'seating'),
      name(feature('Dining terrace', rect(12.2, 1.6, 3, 2.6)), 'dining'),
      name(
        feature('Garden store', rect(7, 6.5, 2.2, 2), {
          category: 'structure',
          material: 'softwood',
        }),
        'storage',
      ),
      name(
        feature('Play area', rect(12, 10.6, 3, 3), {
          category: 'gravel-mulch',
          material: 'play-bark',
        }),
        'play',
      ),
      fill('planting-bed', panel(4, 9, 1.6, 1.2)),
      fill('planting-bed', panel(7, 11, 1.6, 1.2)),
      fill('planting-bed', panel(9.6, 4, 1.6, 1.2)),
    ],
    featureOf,
  };
}

/* ---------------------------------------------------------------- lighting */

/** A fitting is counted, never measured, so it is only here to answer the brief's lighting tick. */
function lights(
  feature: ReturnType<typeof gardenBuilder>['feature'],
  at: { x: number; y: number }[],
): DesignElement[] {
  return at.map((point) =>
    feature(
      'Spike light',
      { kind: 'point', at: point, radius: 0.08 },
      {
        category: 'lighting',
        material: 'brushed-steel',
        symbol: 'light-spike',
      },
    ),
  );
}

/* ---------------------------------------------------------------- the gallery */

/**
 * Four trees down the two side boundaries, given to **every** garden in the gallery.
 *
 * Every pair holds its contents constant, so a fixture that gains trees has to gain them on both
 * sides of the pair — what differs between a good garden and its counterpart is still only where
 * things stand and how big they are. The reason they are here at all is that the `canopy` principle
 * asks a question none of these gardens could answer: hand-built to isolate circulation, grouping
 * and proportion, not one of the nine had a tree in it, so all nine were reported as bare and the
 * principle discriminated between none of them. A well-composed garden has trees; leaving them out
 * was a gap in the fixtures rather than a finding about the scorer.
 *
 * Down the sides and never at the far end, deliberately: a tree within `FOCAL_REACH` of the axis's
 * end terminates the view, which is exactly the fault `planted-poor` and `family-poor` are built to
 * exhibit. A fixture change that quietly repairs the fault a pair exists to show would make the
 * pair agree about a garden nobody looked at.
 */
function boundaryTrees(prefix: string): DesignElement[] {
  const garden = gardenBuilder(`${prefix}-t`);
  return [
    garden.tree({ x: 1.6, y: 4.5 }),
    garden.tree({ x: 1.6, y: 9.5 }),
    garden.tree({ x: WIDTH - 1.6, y: 4.5 }),
    garden.tree({ x: WIDTH - 1.6, y: 9.5 }),
  ];
}

function entry(
  key: string,
  description: string,
  gardenBrief: GardenBrief,
  built: Built,
  counterpart: string | null,
): GalleryGarden {
  return {
    key,
    description,
    brief: gardenBrief,
    ...built,
    elements: [...built.elements, ...boundaryTrees(key)],
    counterpart,
  };
}

export const GALLERY: GalleryGarden[] = [
  entry(
    'entertaining-good',
    'Terrace across the doors, dining beside it, the barbecue within reach, the store out of the view, one route that arrives.',
    ENTERTAINING,
    entertaining(true),
    'entertaining-poor',
  ),
  entry(
    'entertaining-poor',
    'The same seven things: a terrace too small for a table, the barbecue nine metres from it, the store in the sightline, a route that wanders.',
    ENTERTAINING,
    entertaining(false),
    'entertaining-good',
  ),
  entry(
    'family-good',
    'Play in the middle of the view from the kitchen, well clear of the fire, on one continuous lawn.',
    FAMILY,
    family(true),
    'family-poor',
  ),
  entry(
    'family-poor',
    'The same six things: play hidden in the far corner, the fire two metres from it, the lawn cut in half by the shed.',
    FAMILY,
    family(false),
    'family-good',
  ),
  entry(
    'planted-good',
    'Borders deep enough to plant on three sides, the seating screened from the low railing, water closing the view.',
    PLANTED,
    planted(true),
    'planted-poor',
  ),
  entry(
    'planted-poor',
    'The same six things: half-metre slivers, three beds adrift in the lawn, the sofa against the railing, the water out of sight.',
    PLANTED,
    planted(false),
    'planted-good',
  ),
  entry(
    'lowMaintenance-good',
    'Gravel where the lawn would have been, two materials, three deep beds, nothing to mow.',
    LOW_MAINTENANCE,
    lowMaintenance(true),
    'lowMaintenance-poor',
  ),
  entry(
    'lowMaintenance-poor',
    'The same five things, well composed, and the wrong garden: a mown panel, fifty metres of lawn edge and four materials, for somebody with no time.',
    LOW_MAINTENANCE,
    lowMaintenance(false),
    'lowMaintenance-good',
  ),
  entry(
    'scattered',
    'The floor: every feature in its own corner, nothing connecting them, no open ground at all.',
    ENTERTAINING,
    scattered(),
    null,
  ),
];

export function gallery(key: string): GalleryGarden {
  const found = GALLERY.find((entryOf) => entryOf.key === key);
  if (!found) throw new Error(`No gallery garden named ${key}`);
  return found;
}

/** The four good/poor pairs, as the relational assertions read them. */
export const GALLERY_PAIRS: { better: string; worse: string }[] = [
  { better: 'entertaining-good', worse: 'entertaining-poor' },
  { better: 'family-good', worse: 'family-poor' },
  { better: 'planted-good', worse: 'planted-poor' },
  { better: 'lowMaintenance-good', worse: 'lowMaintenance-poor' },
];
