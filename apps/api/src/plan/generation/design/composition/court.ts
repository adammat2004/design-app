import type { DesiredFeature } from '@garden-studio/schema';
import { bed, clampRect, extents } from '../../knowledge/archetypes/shared.js';
import { FEATURE_SPECS } from '../../archetypes.js';
import { FEATURE_LIBRARY, placementLadder } from '../../knowledge/feature-library.js';
import {
  BED_MIN_DEPTH,
  terraceFloor,
  type LocalPoint,
  type LocalRect,
  type Room,
  type SketchRequest,
  type SlotKind,
  terraceClaim,
} from '../../layout/sketch.js';
import { MAINTENANCE_GAP } from '../evaluate/buildability.js';
import { inRect, rectsOverlap } from './cells.js';
import {
  BACK_GAP_MIN,
  BAY_GAP,
  FENCE_GAP,
  PROTECTED,
  bayOf,
  describeBay,
  insideLocal,
  rectPoints,
  seats,
  wantFor,
  type ComposeInput,
  type Want,
} from './compose.js';
import type { Bay, CirculationEdge, GardenComposition, PlantingMass, TreePlan } from './types.js';

/**
 * The courtyard, composed: a room rather than a view.
 *
 * The paving is the floor and runs corner to corner; the planting is deep against the walls; there
 * is one thing worth looking at on the wall opposite the doors; nothing stands in the middle,
 * because the middle is where you stand. There is no open ground to reserve — `openSpace` is `null`,
 * which is what tells the sketch and the fill pass this is a courtyard — so what composing adds over
 * the hand-drawn plan is the rest of the discipline: every room in a bay the fitter will actually
 * seat it in, a purpose on every element, a tree placed for a reason, and a feature with no bay
 * reported rather than stood wherever the sampler found paving.
 */

/** The deepest a wall bed goes: past this the room stops being a room. */
const MAX_BED_SHARE = 0.28;

/**
 * How far over the sliver guard a side bed is drawn. A bed drawn at exactly `BED_MIN_DEPTH` is
 * refused once PostGIS has simplified its edges, so on a room under ten metres wide — where a
 * share of the width comes out under the guard — both side beds vanished and a third of the
 * courtyard read as bare ground.
 */
const BED_MARGIN = 0.1;

/**
 * Where a courtyard can hold a room: on the wall opposite the doors, and in the corner by the house.
 * **Not on the floor.** The floor is the terrace, which realisation treats as an obstacle, so a room
 * placed on it could never be seated — the hand-drawn plan offered two such places and its features
 * fell to the sampler. A feature with neither is reported, and one the brief calls essential makes
 * the composition decline to that plan.
 */
const HOSTS: SlotKind[] = ['axis-end', 'utility', 'terrace-end', 'beside-terrace', 'far-room'];

export interface Court {
  floor: LocalRect;
  beds: { name: string; rect: LocalRect }[];
  focal: LocalRect | null;
  utility: LocalRect | null;
}

/**
 * The floor, the beds round it and the one thing worth looking at.
 *
 * The beds come first and the floor is what is left, which is the inversion that makes this a
 * composition rather than a fallback: in the other plans the terrace takes its size and the
 * planting gets the remainder, and that is how a courtyard ends up as paving with a strip round it.
 *
 * **Each bed is resolved by name and the floor is derived from which ones survived.** The first
 * version collected them into a list and then both named them by index and sized the floor by
 * counting them; on a room too shallow for a rear border the side beds shuffled up and a side bed
 * came out labelled "Rear border". Positional coupling between three independent decisions.
 */
export function court(room: Room, request: SketchRequest, floorShare = 1): Court {
  const { depth, width, uMin } = extents(room);
  const s = request.scale;

  /*
   * Deep enough to plant in layers, capped so the room keeps a floor. `floorShare` is the
   * candidate's terrace depth read the other way round: a smaller floor is deeper planting.
   */
  const deepen = 2 - floorShare;
  const rearDepth = Math.min(Math.max(bed(s), depth * 0.18) * deepen, depth * MAX_BED_SHARE);
  /*
   * Planting is the upkeep in a courtyard, so a low-upkeep one keeps it to the wall opposite the
   * doors and paves to the side fences — which is also what the old plan drew by accident, when
   * side beds under ten metres wide fell below the sliver guard and vanished.
   */
  const sides = request.maintenance !== 'low';
  const sideDepth = Math.min(
    Math.max(BED_MIN_DEPTH + BED_MARGIN, width * 0.12) * deepen,
    width * MAX_BED_SHARE,
  );

  const rear = keep(
    clampRect({ u0: room.uMax - rearDepth, u1: room.uMax, v0: room.vMin, v1: room.vMax }, room),
    (rect) => rect.u1 - rect.u0 >= BED_MIN_DEPTH,
  );
  const floorFar = rear ? rear.u0 : room.uMax;
  const left = !sides
    ? null
    : keep(
        clampRect({ u0: uMin, u1: floorFar, v0: room.vMin, v1: room.vMin + sideDepth }, room),
        (rect) => rect.v1 - rect.v0 >= BED_MIN_DEPTH,
      );
  const right = !sides
    ? null
    : keep(
        clampRect({ u0: uMin, u1: floorFar, v0: room.vMax - sideDepth, v1: room.vMax }, room),
        (rect) => rect.v1 - rect.v0 >= BED_MIN_DEPTH,
      );

  const beds = [
    rear ? { name: 'Rear border', rect: rear } : null,
    left ? { name: 'Left border', rect: left } : null,
    right ? { name: 'Right border', rect: right } : null,
  ].filter((entry): entry is { name: string; rect: LocalRect } => entry !== null);

  /* The floor is what the beds leave, so it can never overlap one. */
  const floorRect = clampRect(
    {
      u0: uMin,
      u1: floorFar,
      v0: left ? left.v1 : room.vMin,
      v1: right ? right.v0 : room.vMax,
    },
    room,
  );
  /* Never below the terrace's own floor: a room too small to hold a table is not improved by
   * planting the space a table would have used. */
  const minimum = terraceFloor(room);
  const floor: LocalRect = floorRect ?? {
    u0: uMin,
    u1: uMin + Math.min(depth, minimum.depth),
    v0: -Math.min(width, minimum.width) / 2,
    v1: Math.min(width, minimum.width) / 2,
  };

  const focal = rear
    ? clampRect(
        {
          u0: rear.u0 - 0.2,
          u1: rear.u1,
          v0: -Math.min(1.8 * s, width * 0.25),
          v1: Math.min(1.8 * s, width * 0.25),
        },
        room,
      )
    : null;

  const utility = clampRect(
    {
      u0: uMin,
      u1: uMin + Math.min(1.6 * s, depth * 0.3),
      v0: room.vMax - Math.min(2.2 * s, width * 0.3),
      v1: room.vMax,
    },
    room,
  );

  return { floor, beds, focal, utility };
}

export function composeCourt(input: ComposeInput): GardenComposition | null {
  const { request, room } = input;
  const s = request.scale;
  const layout = court(room, request, input.params.terraceDepth);
  const { uMin } = extents(room);
  const minimum = terraceFloor(room);
  const g = request.gateSide === 'left' ? -1 : 1;

  let floor: LocalRect = { ...layout.floor };
  let beds = layout.beds.map((entry) => ({ ...entry, rect: { ...entry.rect } }));

  /*
   * Room is **carved**, not found. The hand-drawn courtyard had fixed places — a corner by the house
   * about a metre deep and a strip of the rear border — that no store and no fire pit fitted, so every
   * one fell to the sampler. Here each room takes the space it needs and the floor gives it up, never
   * below the terrace's own floor: the store in the corner by the house on the gate side, with the
   * bed along that side running on from it; the one thing to look at in the rear band, which deepens
   * to hold it.
   */
  /**
   * A room in the corner by the house, against the side fence on `side` (`+1` towards `vMax`): the
   * floor gives up that width, and the bed along that side runs on from the room. The store takes
   * the gate side, where the bins come in; an outdoor kitchen takes the other, by the house it is
   * carried out of.
   *
   * A store goes long side to the house first, where it takes least of the floor's depth; a kitchen
   * goes long side to the fence first, because a counter runs along a wall and that keeps the cook
   * facing the table rather than the house.
   */
  const carveCorner = (want: Want, taken: Bay[], side: 1 | -1): LocalRect | null => {
    const fence = (side > 0 ? room.vMax : room.vMin) - side * standoff(want.feature);
    const bedName = side > 0 ? 'Right border' : 'Left border';
    const houseFirst: [number, number][] = [
      [want.width, want.depth],
      [want.depth, want.width],
    ];
    const orientations = want.kind === 'beside-terrace' ? houseFirst.reverse() : houseFirst;
    for (const [across, deep] of orientations) {
      const inner = fence - side * across;
      const rect: LocalRect = {
        u0: uMin,
        u1: uMin + deep,
        v0: Math.min(inner, fence),
        v1: Math.max(inner, fence),
      };
      const next: LocalRect =
        side > 0
          ? { ...floor, v1: Math.min(floor.v1, inner - BAY_GAP) }
          : { ...floor, v0: Math.max(floor.v0, inner + BAY_GAP) };
      if (next.v1 - next.v0 < minimum.width || rect.u1 > floor.u1 - 1) continue;
      if (taken.some((bay) => rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9))) continue;
      if (!seats(want, rect)) continue;
      floor = next;
      beds = beds.filter((entry) => entry.name !== bedName);
      const along: LocalRect = {
        u0: rect.u1 + BAY_GAP,
        u1: floor.u1,
        v0: Math.min(inner, fence),
        v1: Math.max(inner, fence),
      };
      if (along.u1 - along.u0 >= BED_MIN_DEPTH) beds.push({ name: bedName, rect: along });
      return rect;
    }
    return null;
  };

  /**
   * A room in the rear band, which deepens to hold it: centred on the view for the one thing worth
   * looking at, in the corner away from the gate for anything else that belongs at the far end — a
   * fire pit, a pool, a room of its own. Never taking the floor under the terrace's own.
   */
  const carveRear = (want: Want, taken: Bay[], centred: boolean): LocalRect | null => {
    const back = room.uMax - BACK_GAP_MIN;
    const away = g > 0 ? room.vMin : room.vMax;
    const [v0, v1] = centred
      ? [-want.width / 2, want.width / 2]
      : g > 0
        ? [away + FENCE_GAP, away + FENCE_GAP + want.width]
        : [away - FENCE_GAP - want.width, away - FENCE_GAP];
    const rect: LocalRect = { u0: back - want.depth, u1: back, v0: v0!, v1: v1! };
    const far = Math.min(floor.u1, rect.u0 - 0.1);
    if (far - floor.u0 < minimum.depth) return null;
    if (taken.some((bay) => rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9))) return null;
    if (!seats(want, rect)) return null;
    floor = { ...floor, u1: far };
    beds = beds.map((entry) =>
      entry.name === 'Rear border'
        ? { ...entry, rect: { ...entry.rect, u0: far } }
        : { ...entry, rect: { ...entry.rect, u1: Math.min(entry.rect.u1, far) } },
    );
    if (!beds.some((entry) => entry.name === 'Rear border')) {
      beds.push({
        name: 'Rear border',
        rect: { u0: far, u1: room.uMax, v0: room.vMin, v1: room.vMax },
      });
    }
    return rect;
  };

  /**
   * A dining area at the floor's far end, on the side away from the gate — or on the gate side, for
   * the variation that keeps the away side planted: the courtyard's second room, reached across the
   * first. The floor gives up that depth, and whatever of the strip the
   * table does not take is planted as a screen between the two rooms rather than left as a gap.
   */
  const carveDining = (want: Want, taken: Bay[]): LocalRect | null => {
    const u1 = floor.u1;
    const u0 = u1 - want.depth;
    if (u0 - BAY_GAP - floor.u0 < minimum.depth) return null;
    const low = g > 0 !== (input.params.lawnBias === 'away');
    const kitchen = kitchenBeside(u1, low, taken);
    const edge = kitchen ? (low ? kitchen.v1 + BAY_GAP : kitchen.v0 - BAY_GAP) : null;
    const from = low ? Math.max(floor.v0, edge ?? -Infinity) : Math.min(floor.v1, edge ?? Infinity);
    const across = Math.min(want.width, low ? floor.v1 - from : from - floor.v0);
    const [v0, v1] = low ? [from, from + across] : [from - across, from];
    const rect: LocalRect = { u0, u1, v0, v1 };
    if (taken.some((bay) => rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9))) return null;
    if (!seats(want, rect)) return null;
    if (kitchen) {
      paired = kitchen;
      cutSideBeds(kitchen);
    }
    const rest: LocalRect = low
      ? { u0, u1, v0: v1 + BAY_GAP, v1: floor.v1 }
      : { u0, u1, v0: floor.v0, v1: v0 - BAY_GAP };
    if (rest.v1 - rest.v0 >= BED_MIN_DEPTH && rest.u1 - rest.u0 >= BED_MIN_DEPTH) {
      beds.push({ name: 'Dining screen', rect: rest });
    }
    floor = { ...floor, u1: u0 - BAY_GAP };
    return rect;
  };

  /**
   * The outdoor kitchen that goes with a dining area carved at the far end, reserved when the
   * dining is: against the side fence level with the table, in the band the side bed would have
   * taken, so the walk from the grill to the table is a step rather than the length of the floor.
   * Laid by the house instead, it was six metres from the table it serves.
   */
  let paired: LocalRect | null = null;
  /*
   * A store belongs against the fence; anything else built stands far enough off it to be
   * maintained — the scorer's own clearance, so a room carved here is never one it complains about.
   */
  const standoff = (feature: DesiredFeature | null) =>
    feature && FEATURE_LIBRARY[feature].boundaryAffinity !== 'prefers' ? MAINTENANCE_GAP + 0.05 : 0;
  const kitchenBeside = (u1: number, low: boolean, taken: Bay[]): LocalRect | null => {
    if (
      !wanted.includes('outdoorKitchen') ||
      bays.some((bay) => bay.feature === 'outdoorKitchen')
    ) {
      return null;
    }
    const kitchen = wantFor(
      'outdoorKitchen',
      'beside-terrace',
      s,
      input.language,
      request.primaryZone,
    );
    /* Long side to the fence: a counter runs along a wall. */
    const across = Math.min(kitchen.width, kitchen.depth);
    const deep = Math.max(kitchen.width, kitchen.depth);
    const fence = low
      ? room.vMin + standoff('outdoorKitchen')
      : room.vMax - standoff('outdoorKitchen');
    const rect: LocalRect = {
      u0: u1 - deep,
      u1,
      v0: low ? fence : fence - across,
      v1: low ? fence + across : fence,
    };
    if (rect.u0 < uMin) return null;
    if (taken.some((bay) => rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9))) return null;
    return seats(kitchen, rect) ? rect : null;
  };

  /** A side bed with a room standing in its band gives way round it, before and after. */
  const cutSideBeds = (rect: LocalRect) => {
    beds = beds.flatMap((entry) => {
      if (entry.name === 'Rear border' || !rectsOverlap(entry.rect, rect, 0)) return [entry];
      return [
        { ...entry, rect: { ...entry.rect, u1: rect.u0 - BAY_GAP } },
        { ...entry, rect: { ...entry.rect, u0: rect.u1 + BAY_GAP } },
      ].filter((piece) => piece.rect.u1 - piece.rect.u0 >= BED_MIN_DEPTH);
    });
  };

  const carve = (want: Want, taken: Bay[]): LocalRect | null => {
    switch (want.kind) {
      case 'utility':
        return carveCorner(want, taken, g > 0 ? 1 : -1);
      case 'beside-terrace':
        if (paired && !taken.some((bay) => rectsOverlap(bay.rect, paired!, BAY_GAP - 1e-9))) {
          return paired;
        }
        return carveCorner(want, taken, g > 0 ? -1 : 1);
      case 'axis-end':
        return carveRear(want, taken, true);
      case 'far-room':
        return carveRear(want, taken, input.params.destination === 'far-centre');
      case 'terrace-end':
        return carveDining(want, taken);
      default:
        return null;
    }
  };

  const terraceFeature = terraceClaim(request.features, request.primaryZone);
  const wanted = request.features.filter(
    (feature) => feature !== terraceFeature && !FEATURE_LIBRARY[feature].composed,
  );
  const essentials = request.essential;
  const isEssential = (feature: DesiredFeature, index: number) =>
    essentials ? essentials.includes(feature) : index < PROTECTED;

  const bays: Bay[] = [];
  const dropped: string[] = [];
  for (const [index, feature] of wanted.entries()) {
    let placed = false;
    for (const kind of placementLadder(feature)) {
      if (!HOSTS.includes(kind) || bays.some((bay) => bay.kind === kind)) continue;
      const want = wantFor(feature, kind, s, input.language, request.primaryZone);
      const rect = carve(want, bays);
      if (!rect || !seats(want, rect)) continue;
      bays.push(bayOf(want, rect));
      placed = true;
      break;
    }
    if (!placed) {
      /*
       * A courtyard drawn as the last resort — where no composition could keep a lawn — never
       * declines: it reports what it could not seat, because there is nothing left to decline to.
       */
      if (isEssential(feature, index) && !input.params.lastResort) return null;
      dropped.push(feature);
    }
  }
  beds = beds.filter(
    (entry) =>
      entry.rect.u1 - entry.rect.u0 >= BED_MIN_DEPTH &&
      entry.rect.v1 - entry.rect.v0 >= BED_MIN_DEPTH,
  );

  const PURPOSE: Record<string, PlantingMass['purpose']> = {
    'Dining screen': 'threshold-planting',
    'Rear border': 'backdrop-planting',
    'Left border': 'framing-planting',
    'Right border': 'framing-planting',
  };
  const masses: PlantingMass[] = beds.map(({ name, rect }) => ({
    name,
    shape: { kind: 'polygon', points: rectPoints(rect) },
    purpose: PURPOSE[name] ?? 'framing-planting',
  }));

  /* One tree, in a far corner, never in the middle: a courtyard with a specimen in the centre is a
   * courtyard you walk round the edge of. The first corner inside a bed and clear of every room. */
  const trees: TreePlan[] = [];
  const corners: LocalPoint[] = [
    { u: room.uMax - 1.5, v: room.vMin + 1.5 },
    { u: room.uMax - 1.5, v: room.vMax - 1.5 },
    { u: room.uMax - 0.8, v: room.vMin + 0.8 },
    { u: room.uMax - 0.8, v: room.vMax - 0.8 },
  ];
  /*
   * The first corner that is planted, free, and clear of anything built — or failing that, the one
   * furthest from it: a crown may reach over a bed or a pool but not through a store or a kitchen,
   * so the corner beside one is refused when the tree is planted and the courtyard is left with
   * none.
   */
  const built = bays.filter(
    (bay) => bay.feature && FEATURE_SPECS[bay.feature].category === 'structure',
  );
  const clearance = (at: LocalPoint) =>
    Math.min(Infinity, ...built.map((bay) => rectGap(at, bay.rect)));
  const corner = corners
    .filter(
      (at) =>
        masses.some(
          (mass) => mass.shape.kind === 'polygon' && insideLocal(at, mass.shape.points),
        ) && !bays.some((bay) => inRect(at, bay.rect)),
    )
    .reduce<LocalPoint | undefined>(
      (best, at) =>
        best && Math.min(clearance(best), TREE_CLEAR) >= Math.min(clearance(at), TREE_CLEAR)
          ? best
          : at,
      undefined,
    );
  if (corner) trees.push({ at: corner, role: 'backdrop', purpose: 'backdrop-tree' });

  const circulation: CirculationEdge[] = request.gateSide
    ? [
        {
          name: 'Side path',
          from: { u: 0, v: g * (room.vMax - room.vMin) },
          to: { gate: true },
          via: [],
          tier: 'primary',
          purpose: 'access-route',
        },
      ]
    : [];

  const focalBay = bays.find((bay) => bay.kind === 'axis-end');
  const decisions: GardenComposition['decisions'] = [
    {
      kind: 'courtyard',
      text: `Designed the garden as a courtyard: a paved floor corner to corner, planting deep against the walls${focalBay ? `, and the ${describeBay(focalBay)} on the wall opposite the doors` : ''}. Nothing stands in the middle, because the middle is where you stand.`,
    },
  ];
  if (input.params.lastResort) {
    decisions.push({
      kind: 'last-resort-courtyard',
      text: 'No composition worth trying could keep a lawn here and hold what the brief most wants, so the garden is designed as a room: the paving is the floor, and each space is carved off it.',
    });
  }
  if (dropped.length > 0) {
    decisions.push({
      kind: 'no-room',
      text: `A courtyard has no room for ${dropped.join(', ')} without standing it in the middle of the floor.`,
    });
  }

  return {
    archetype: input.archetype,
    language: input.language,
    terrace: floor,
    openSpace: null,
    bays,
    corridors: [],
    circulation,
    focal: focalBay
      ? { kind: 'feature', bay: focalBay.id }
      : corner
        ? { kind: 'tree', at: corner }
        : null,
    masses,
    trees,
    axis: null,
    axisStops: [],
    decisions,
  };
}

/** Past this a crown is clear of a room whatever the species: a corner that far off is as good as any. */
const TREE_CLEAR = 3;

/** How far a point is from a rectangle; nought inside it. */
function rectGap(at: LocalPoint, rect: LocalRect): number {
  const du = Math.max(rect.u0 - at.u, 0, at.u - rect.u1);
  const dv = Math.max(rect.v0 - at.v, 0, at.v - rect.v1);
  return Math.hypot(du, dv);
}

/** A rectangle, or nothing when it is too small to be the thing it claims to be. */
function keep(rect: LocalRect | null, viable: (rect: LocalRect) => boolean): LocalRect | null {
  return rect && viable(rect) ? rect : null;
}
