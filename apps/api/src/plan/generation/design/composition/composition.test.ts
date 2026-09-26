import { describe, expect, it } from 'vitest';
import type { CandidateParams } from '../types.js';
import { defaultParams } from '../../knowledge/archetypes/types.js';
import {
  BED_MIN_DEPTH,
  LAWN_FLOOR,
  type LocalPoint,
  type Room,
  type SketchRequest,
} from '../../layout/sketch.js';
import { gridOver, inRect, loopsOf, outlineWithout, cellCentre, signedArea } from './cells.js';
import { composeBeside } from './beside.js';
import { composeCourt } from './court.js';
import { composeGarden, CORRIDOR, SERVE } from './compose.js';
import { composeSketch } from './compose-sketch.js';
import type { GardenComposition, GeometryLanguage } from './types.js';

/**
 * The composition, held to what makes it a composition.
 *
 * Not a golden file. The templates were pinned to a nanometre, which proved the numbers had not
 * moved and nothing about whether they were a garden. These are the properties a designer would
 * check on a plan with a pencil: nothing stands on the lawn, every route runs beside it, every room
 * is reached, the lawn is still a lawn, the store is out of the view, the formal plan is symmetric.
 * Every one is asserted across the plot shapes that exercise every branch.
 */

function request(over: Partial<SketchRequest> = {}): SketchRequest {
  return {
    features: ['seating', 'storage', 'firePit', 'pergola'],
    scale: 1,
    style: 'modern',
    lawnAllowed: true,
    gateSide: 'right',
    houseWallLength: 8,
    doorWidth: 2.4,
    ...over,
  };
}

function room(over: Partial<Room> = {}): Room {
  return { uMin: 0, uMax: 14, vMin: -7, vMax: 7, ...over };
}

const CASES: {
  name: string;
  request: SketchRequest;
  room: Room;
  destination?: CandidateParams['destination'];
}[] = [
  { name: 'suburban', request: request(), room: room() },
  { name: 'far-centre', request: request(), room: room(), destination: 'far-centre' },
  { name: 'gate-left', request: request({ gateSide: 'left' }), room: room() },
  { name: 'no-gate', request: request({ gateSide: null }), room: room() },
  {
    name: 'family',
    request: request({ features: ['seating', 'play', 'storage', 'water'] }),
    room: room({ uMax: 16 }),
  },
  {
    name: 'working',
    request: request({ features: ['seating', 'storage', 'vegPatch', 'greenhouse'] }),
    room: room({ uMax: 18 }),
  },
  {
    name: 'small',
    request: request({ scale: 0.7, features: ['seating', 'storage'] }),
    room: room({ uMax: 8, vMin: -4, vMax: 4 }),
  },
  {
    name: 'large',
    request: request({ scale: 2.1 }),
    room: room({ uMax: 26, vMin: -13, vMax: 13 }),
  },
  { name: 'long-narrow', request: request(), room: room({ uMax: 24, vMin: -3, vMax: 3 }) },
  {
    name: 'no-lawn',
    request: request({ lawnAllowed: false, style: 'lowMaintenance' }),
    room: room(),
  },
  {
    name: 'wide-shallow',
    request: request({ features: ['seating', 'storage', 'firePit', 'play'] }),
    room: room({ uMax: 9, vMin: -11, vMax: 11 }),
  },
  {
    name: 'spare-room',
    request: request({ features: ['seating', 'storage'], extraRooms: 1 }),
    room: room({ uMax: 18 }),
  },
];

type Composed =
  | 'terrace_and_lawn'
  | 'sweeping_lawn'
  | 'formal_axis'
  | 'destination_garden'
  | 'linear_sequence'
  | 'side_by_side';
const LANGUAGES: { archetype: Composed; language: GeometryLanguage }[] = [
  { archetype: 'terrace_and_lawn', language: 'rectilinear' },
  { archetype: 'sweeping_lawn', language: 'soft_organic' },
  { archetype: 'formal_axis', language: 'formal_symmetric' },
  { archetype: 'destination_garden', language: 'rectilinear' },
  { archetype: 'destination_garden', language: 'soft_organic' },
  { archetype: 'linear_sequence', language: 'rectilinear' },
  { archetype: 'side_by_side', language: 'rectilinear' },
];

function composeAll(): { name: string; composition: GardenComposition; room: Room }[] {
  const out: { name: string; composition: GardenComposition; room: Room }[] = [];
  for (const entry of CASES) {
    for (const { archetype, language } of LANGUAGES) {
      const params = {
        ...defaultParams(archetype),
        ...(entry.destination ? { destination: entry.destination } : {}),
      };
      const compose = archetype === 'side_by_side' ? composeBeside : composeGarden;
      const composition = compose({
        archetype,
        language,
        request: entry.request,
        room: entry.room,
        params,
      });
      const label =
        archetype === 'destination_garden'
          ? language === 'soft_organic'
            ? 'destination-soft'
            : 'destination'
          : archetype === 'linear_sequence'
            ? 'sequence'
            : archetype === 'side_by_side'
              ? 'beside'
              : language;
      if (composition) out.push({ name: `${entry.name}/${label}`, composition, room: entry.room });
    }
  }
  return out;
}

const COMPOSED = composeAll();

/** Whether a point is inside a ring in (u, v). */
function inside(point: LocalPoint, ring: LocalPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.v > point.v !== b.v > point.v) {
      const u = ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u;
      if (point.u < u) hit = !hit;
    }
  }
  return hit;
}

function lawnOf(composition: GardenComposition): LocalPoint[] {
  const shape = composition.openSpace!.shape;
  if (shape.kind !== 'polygon') throw new Error('a composed lawn is always a polygon');
  return shape.points;
}

describe('the cells a composition is cut from', () => {
  it('traces a rectangle notched at a corner as one outline with one inside corner', () => {
    const outline = outlineWithout({ u0: 0, u1: 10, v0: 0, v1: 6 }, [
      { u0: 7, u1: 10, v0: 4, v1: 6 },
    ]);
    expect(outline).not.toBeNull();
    expect(outline!.length).toBe(6);
    expect(Math.abs(signedArea(outline!))).toBeCloseTo(60 - 6, 9);
  });

  it('refuses a cut that would leave a hole in the middle', () => {
    expect(
      outlineWithout({ u0: 0, u1: 10, v0: 0, v1: 6 }, [{ u0: 4, u1: 6, v0: 2, v1: 4 }]),
    ).toBeNull();
  });

  it('refuses a cut that would split the panel in two', () => {
    expect(
      outlineWithout({ u0: 0, u1: 10, v0: 0, v1: 6 }, [{ u0: 4, u1: 6, v0: -1, v1: 7 }]),
    ).toBeNull();
  });

  it('keeps two lobes that touch only at a corner as two outlines', () => {
    const grid = gridOver({ u0: 0, u1: 2, v0: 0, v1: 2 }, [{ u0: 1, u1: 1, v0: 1, v1: 1 }]);
    const loops = loopsOf(grid, (i, j) => {
      const c = cellCentre(grid, i, j);
      return (c.u < 1 && c.v < 1) || (c.u > 1 && c.v > 1);
    });
    expect(loops.filter((loop) => loop.outer).length).toBe(2);
  });
});

describe('a composed garden', () => {
  it('composes every plot that is not a courtyard, in every language', () => {
    expect(COMPOSED.length).toBeGreaterThanOrEqual(CASES.length * 2);
  });

  it('stands nothing on the lawn but a play area', () => {
    for (const { name, composition } of COMPOSED) {
      const lawn = lawnOf(composition);
      for (const bay of composition.bays) {
        if (bay.feature === 'play') continue;
        const centre = { u: (bay.rect.u0 + bay.rect.u1) / 2, v: (bay.rect.v0 + bay.rect.v1) / 2 };
        expect(inside(centre, lawn), `${name}: ${bay.feature ?? 'spare'} in ${bay.kind}`).toBe(
          false,
        );
      }
    }
  });

  it('keeps every corridor off the lawn', () => {
    for (const { name, composition } of COMPOSED) {
      const lawn = lawnOf(composition);
      for (const corridor of composition.corridors) {
        const centre = {
          u: (corridor.rect.u0 + corridor.rect.u1) / 2,
          v: (corridor.rect.v0 + corridor.rect.v1) / 2,
        };
        expect(inside(centre, lawn), `${name}: ${corridor.name}`).toBe(false);
      }
    }
  });

  it('leaves the lawn a lawn', () => {
    for (const { name, composition } of COMPOSED) {
      const area = Math.abs(signedArea(lawnOf(composition)));
      expect(area, name).toBeGreaterThanOrEqual(LAWN_FLOOR.area - 1e-6);
      const rect = composition.openSpace!.rect;
      expect(Math.min(rect.u1 - rect.u0, rect.v1 - rect.v0), name).toBeGreaterThanOrEqual(
        LAWN_FLOOR.minDimension - 1e-6,
      );
    }
  });

  it('reaches every room at the far end: a path ends at it or runs past its face', () => {
    for (const { name, composition } of COMPOSED) {
      const far = composition.bays.filter((bay) =>
        ['utility', 'utility-2', 'far-room', 'lawn-far', 'axis-end'].includes(bay.kind),
      );
      for (const bay of far) {
        const reached = composition.circulation.some((edge) => {
          if ('slot' in edge.to && (edge.to.slot === bay.id || (edge.to.or ?? []).includes(bay.id)))
            return true;
          return edge.via.some((point) => distanceToRect(point, bay.rect) <= SERVE + 1e-6);
        });
        /* The formal axis serves what stands on it, and what it stops beside. */
        const axis = composition.axis;
        const axial =
          axis !== null &&
          ((bay.rect.v0 <= 0 && bay.rect.v1 >= 0) ||
            composition.axisStops.some(
              (u) => distanceToRect({ u, v: 0 }, bay.rect) <= SERVE + 1e-6,
            ));
        /* Within a stride of the terrace, the scorer's own rule: you are already standing on it. */
        const beside = distanceBetween(bay.rect, composition.terrace) <= NO_PATH_NEEDED;
        expect(
          reached || axial || beside,
          `${name}: ${bay.feature ?? 'spare'} in ${bay.kind}`,
        ).toBe(true);
      }
    }
  });

  it('never runs a primary or secondary route across the lawn', () => {
    for (const { name, composition } of COMPOSED) {
      const lawn = lawnOf(composition);
      for (const edge of composition.circulation) {
        if (edge.tier === 'decorative') continue;
        for (const point of edge.via) {
          expect(inside(point, lawn), `${name}: ${edge.name} at (${point.u}, ${point.v})`).toBe(
            false,
          );
        }
      }
    }
  });

  it('gives every room and every path a reason', () => {
    for (const { name, composition } of COMPOSED) {
      for (const bay of composition.bays) expect(bay.purpose, name).toBeTruthy();
      for (const edge of composition.circulation) expect(edge.purpose, name).toBeTruthy();
      for (const tree of composition.trees) expect(tree.purpose, name).toBeTruthy();
      for (const mass of composition.masses) expect(mass.purpose, name).toBeTruthy();
    }
  });

  it('plants every tree in a bed, never on the lawn', () => {
    for (const { name, composition } of COMPOSED) {
      const lawn = lawnOf(composition);
      for (const tree of composition.trees) {
        expect(inside(tree.at, lawn), `${name}: ${tree.role} tree`).toBe(false);
      }
    }
  });

  it('puts something at the end of the view', () => {
    for (const { name, composition } of COMPOSED) {
      expect(composition.focal, name).not.toBeNull();
    }
  });

  it('keeps the store out of the view from the doors on a garden wide enough to', () => {
    const cone: LocalPoint[] = [
      { u: 0, v: 0 },
      { u: 14, v: -1.84 },
      { u: 14, v: 1.84 },
    ];
    for (const { name, composition } of COMPOSED.filter(
      (entry) => entry.room.vMax - entry.room.vMin >= 10,
    )) {
      for (const bay of composition.bays.filter((b) => b.kind === 'utility')) {
        const centre = { u: (bay.rect.u0 + bay.rect.u1) / 2, v: (bay.rect.v0 + bay.rect.v1) / 2 };
        expect(inside(centre, cone), name).toBe(false);
      }
    }
  });

  it('mirrors the formal plan about the door axis', () => {
    for (const { name, composition } of COMPOSED.filter((entry) =>
      entry.name.endsWith('formal_symmetric'),
    )) {
      const rect = composition.openSpace!.rect;
      expect(rect.v0 + rect.v1, name).toBeCloseTo(0, 6);
      expect(composition.axis, name).not.toBeNull();
      const walks = composition.corridors.filter((corridor) => corridor.name.endsWith('corridor'));
      if (walks.length === 2) {
        const [a, b] = walks.map((corridor) => (corridor.rect.v0 + corridor.rect.v1) / 2);
        expect(a! + b!, name).toBeCloseTo(0, 6);
      }
    }
  });

  it('keeps a corridor at least a route wide', () => {
    /*
     * Measured across the way a route runs, not as the smaller side: a corridor down the garden can
     * be shorter than it is wide where the room it reaches stands a stride from the terrace, and it
     * is still exactly a route wide.
     */
    const runsAlongU = (name: string) =>
      /(gate|away) corridor$|^fence corridor$|^lawn entrance$/.test(name);
    for (const { name, composition } of COMPOSED) {
      for (const corridor of composition.corridors) {
        const across = runsAlongU(corridor.name)
          ? corridor.rect.v1 - corridor.rect.v0
          : corridor.rect.u1 - corridor.rect.u0;
        expect(across, `${name}: ${corridor.name}`).toBeGreaterThanOrEqual(CORRIDOR - 1e-6);
      }
    }
  });

  it('reserves a spare room when the plot can carry one', () => {
    const spare = COMPOSED.filter((entry) => entry.name.startsWith('spare-room'));
    expect(spare.length).toBeGreaterThan(0);
    for (const { name, composition } of spare) {
      expect(
        composition.bays.some((bay) => bay.zoneId === 'lounge'),
        name,
      ).toBe(true);
    }
  });

  it('names every route once, because a repair finds a route by its name', () => {
    for (const { name, composition } of COMPOSED) {
      const names = composition.circulation.map((edge) => edge.name);
      expect(new Set(names).size, name).toBe(names.length);
    }
  });

  it('is the same garden twice', () => {
    expect(composeAll()).toEqual(COMPOSED);
  });

  it('declines a courtyard rather than drawing a lawn it cannot hold', () => {
    const composition = composeGarden({
      archetype: 'terrace_and_lawn',
      language: 'rectilinear',
      request: request({ scale: 0.6 }),
      room: room({ uMax: 4.5, vMin: -3.5, vMax: 3.5 }),
      params: defaultParams('terrace_and_lawn'),
    });
    expect(composition).toBeNull();
  });
});

describe('a destination garden', () => {
  const DESTINATION = COMPOSED.filter((entry) => entry.name.endsWith('/destination'));

  it('is composed on every plot deep enough to have a far end and a reason to go there', () => {
    const names = DESTINATION.map((entry) => entry.name);
    for (const expected of ['suburban', 'family', 'large', 'long-narrow', 'no-lawn']) {
      expect(names, expected).toContain(`${expected}/destination`);
    }
  });

  it('stands the destination beyond the lawn, with a path along its front or past its side', () => {
    for (const { name, composition } of DESTINATION) {
      const destination = composition.bays.find((bay) => bay.kind === 'far-room');
      expect(destination, name).toBeDefined();
      const alongFront = composition.corridors.some(
        (corridor) =>
          corridor.name.endsWith('row') && corridor.rect.u1 >= destination!.rect.u0 - 1e-6,
      );
      expect(destination!.rect.u0 - composition.openSpace!.rect.u1, name).toBeGreaterThanOrEqual(
        (alongFront ? CORRIDOR : 0) - 1e-6,
      );
    }
  });

  it('runs one path down a garden too narrow for two, and branches off it to the destination', () => {
    const narrow = DESTINATION.find((entry) => entry.name === 'long-narrow/destination');
    expect(narrow).toBeDefined();
    const paths = narrow!.composition.circulation.filter((edge) => edge.purpose !== 'access-route');
    const trunks = paths.filter((edge) => !edge.branch);
    expect(trunks.map((edge) => edge.name)).toEqual(['Path to the shed']);
    const branch = paths.find((edge) => edge.branch === 'Path to the shed');
    expect(branch && 'slot' in branch.to ? branch.to.slot : null).toBe('far-room');
  });

  it('reaches the destination down the side of the lawn, never across it', () => {
    for (const { name, composition } of DESTINATION) {
      const destination = composition.bays.find((bay) => bay.kind === 'far-room')!;
      const routes = composition.circulation.filter(
        (edge) =>
          'slot' in edge.to &&
          (edge.to.slot === destination.id || (edge.to.or ?? []).includes(destination.id)),
      );
      expect(routes.length, name).toBeGreaterThan(0);
      expect(
        routes.every((edge) => edge.tier !== 'decorative'),
        name,
      ).toBe(true);
    }
  });

  it('puts the destination at the end of the view when it is centred', () => {
    const centred = DESTINATION.filter(({ composition }) => {
      const bay = composition.bays.find((b) => b.kind === 'far-room')!;
      return bay.rect.v0 <= 0 && bay.rect.v1 >= 0;
    });
    expect(centred.length).toBeGreaterThan(0);
    for (const { name, composition } of centred) {
      expect(composition.focal, name).toEqual({ kind: 'feature', bay: 'far-room' });
    }
  });

  it('declines a plot with nothing worth walking to', () => {
    const composition = composeGarden({
      archetype: 'destination_garden',
      language: 'rectilinear',
      request: request({ features: ['seating', 'storage', 'vegPatch'] }),
      room: room({ uMax: 18 }),
      params: defaultParams('destination_garden'),
    });
    expect(composition).toBeNull();
  });
});

describe('a sequence of rooms', () => {
  const SEQUENCE = COMPOSED.filter((entry) => entry.name.endsWith('/sequence'));

  it('is composed on the long narrow plot', () => {
    expect(SEQUENCE.map((entry) => entry.name)).toContain('long-narrow/sequence');
  });

  it('enters the lawn through an opening in a planted divider', () => {
    for (const { name, composition } of SEQUENCE) {
      const entrance = composition.corridors.find((corridor) => corridor.name === 'lawn entrance');
      expect(entrance, name).toBeDefined();
      expect(entrance!.rect.v0 <= 0 && entrance!.rect.v1 >= 0, name).toBe(true);
      expect(
        composition.masses.some((mass) => mass.name === 'Dividing border'),
        name,
      ).toBe(true);
    }
  });

  it('keeps a far room beyond the lawn even with nothing to walk to', () => {
    const composition = composeGarden({
      archetype: 'linear_sequence',
      language: 'rectilinear',
      request: request({ features: ['seating', 'storage', 'greenhouse'] }),
      room: room({ uMax: 24, vMin: -3, vMax: 3 }),
      params: defaultParams('linear_sequence'),
    });
    expect(composition).not.toBeNull();
    expect(composition!.bays.find((bay) => bay.kind === 'far-room')?.feature).toBe('greenhouse');
  });
});

describe('a side-by-side garden', () => {
  const BESIDE = COMPOSED.filter((entry) => entry.name.endsWith('/beside'));

  it('is composed on the wide shallow plot', () => {
    expect(BESIDE.map((entry) => entry.name)).toContain('wide-shallow/beside');
  });

  it('lays the lawn beside the terrace rather than behind it', () => {
    for (const { name, composition } of BESIDE) {
      const lawn = composition.openSpace!.rect;
      const t = composition.terrace;
      expect(lawn.v0 >= t.v1 - 1e-6 || lawn.v1 <= t.v0 + 1e-6, name).toBe(true);
      expect(lawn.u0, name).toBeLessThan(t.u1);
    }
  });

  it("puts the room in the lawn's far corner, off the grass, with a path to it", () => {
    const wide = BESIDE.find((entry) => entry.name === 'wide-shallow/beside')!;
    const far = wide.composition.bays.find((bay) => bay.kind === 'far-room');
    expect(far?.feature).toBe('firePit');
    expect(
      wide.composition.circulation.some(
        (edge) => 'slot' in edge.to && edge.to.slot === far!.id && edge.tier !== 'decorative',
      ),
    ).toBe(true);
  });
});

describe('a courtyard', () => {
  const small = () =>
    composeCourt({
      archetype: 'courtyard',
      language: 'rectilinear',
      request: request({ scale: 0.6, features: ['seating', 'water', 'storage'] }),
      room: room({ uMax: 6, vMin: -3.5, vMax: 3.5 }),
      params: defaultParams('courtyard'),
    });

  it('is a room with no open ground reserved, and the sketch says so', () => {
    const composition = small();
    expect(composition).not.toBeNull();
    expect(composition!.openSpace).toBeNull();
    const sketch = composeSketch(composition!, room({ uMax: 6, vMin: -3.5, vMax: 3.5 }));
    expect(sketch.courtyard).toBe(true);
    expect(sketch.lawn).toBeNull();
  });

  it('puts the one thing worth looking at on the wall opposite the doors', () => {
    const composition = small()!;
    expect(composition.focal).toEqual({ kind: 'feature', bay: 'axis-end' });
    expect(composition.bays.find((bay) => bay.kind === 'axis-end')?.feature).toBe('water');
  });

  it('never stands a room on the floor', () => {
    const composition = small()!;
    for (const bay of composition.bays) {
      const centre = { u: (bay.rect.u0 + bay.rect.u1) / 2, v: (bay.rect.v0 + bay.rect.v1) / 2 };
      expect(inRect(centre, composition.terrace), bay.id).toBe(false);
    }
  });

  it('gives every bed and tree a purpose', () => {
    const composition = small()!;
    for (const mass of composition.masses) expect(mass.purpose).toBeTruthy();
    for (const tree of composition.trees) expect(tree.purpose).toBeTruthy();
  });
});

describe('planting shaped by what it is for', () => {
  const compose = (
    privacy?: SketchRequest['privacy'],
    lowSides: SketchRequest['lowSides'] = ['left', 'right'],
  ) =>
    composeGarden({
      archetype: 'terrace_and_lawn',
      language: 'rectilinear',
      request: request(privacy ? { privacy, lowSides } : { lowSides }),
      room: room(),
      params: defaultParams('terrace_and_lawn'),
    })!;

  it('plants a screen against both side fences where the brief asks to screen the neighbours', () => {
    const screened = compose('screen-neighbours');
    const lawn = screened.openSpace!.rect;
    expect(lawn.v0 - room().vMin).toBeGreaterThanOrEqual(BED_MIN_DEPTH);
    expect(room().vMax - lawn.v1).toBeGreaterThanOrEqual(BED_MIN_DEPTH);
    expect(
      screened.masses.filter((mass) => mass.name === 'Screening border').length,
    ).toBeGreaterThan(0);
    for (const mass of screened.masses.filter((m) => m.name === 'Screening border')) {
      expect(mass.purpose).toBe('screening-planting');
    }
  });

  it('runs the path inside the screen rather than along the fence', () => {
    for (const corridor of compose('enclose').corridors.filter((c) =>
      c.name.endsWith(' corridor'),
    )) {
      const fromFence = Math.min(corridor.rect.v0 - room().vMin, room().vMax - corridor.rect.v1);
      expect(fromFence, corridor.name).toBeGreaterThanOrEqual(BED_MIN_DEPTH - 1e-6);
    }
  });

  it('plants no screen in front of a fence tall enough to be one', () => {
    const behindFences = compose('screen-neighbours', []);
    const lawn = behindFences.openSpace!.rect;
    expect(Math.min(lawn.v0 - room().vMin, room().vMax - lawn.v1)).toBeLessThan(BED_MIN_DEPTH);
  });

  it('keeps one side a mowing edge where nothing asked for a screen', () => {
    const open = compose();
    const lawn = open.openSpace!.rect;
    const nearer = Math.min(lawn.v0 - room().vMin, room().vMax - lawn.v1);
    expect(nearer).toBeLessThan(BED_MIN_DEPTH);
  });
});

describe('a composed sketch', () => {
  it('says what it is, so the realisation honours it', () => {
    for (const { name, composition, room: r } of COMPOSED) {
      const sketch = composeSketch(composition, r);
      expect(sketch.composed, name).toBeDefined();
      expect(sketch.composed!.treeRoles.length, name).toBe(sketch.trees.length);
      expect(sketch.composed!.bedPurposes.length, name).toBe(sketch.beds.length);
      /* A bay is a slot of the same id, so a repair that bars a slot bars the bay. */
      for (const bay of composition.bays) {
        expect(
          sketch.slots.some((slot) => slot.id === bay.id && slot.purpose === bay.purpose),
          name,
        ).toBe(true);
      }
    }
  });
});

/** The scorer's `NO_PATH_NEEDED`: this close to the terrace a room needs no path of its own. */
const NO_PATH_NEEDED = 2.5;

function distanceBetween(
  a: { u0: number; u1: number; v0: number; v1: number },
  b: { u0: number; u1: number; v0: number; v1: number },
): number {
  const du = Math.max(0, a.u0 - b.u1, b.u0 - a.u1);
  const dv = Math.max(0, a.v0 - b.v1, b.v0 - a.v1);
  return Math.hypot(du, dv);
}

function distanceToRect(
  point: LocalPoint,
  rect: { u0: number; u1: number; v0: number; v1: number },
): number {
  if (inRect(point, rect)) return 0;
  const du = Math.max(rect.u0 - point.u, 0, point.u - rect.u1);
  const dv = Math.max(rect.v0 - point.v, 0, point.v - rect.v1);
  return Math.hypot(du, dv);
}
