import type { DesiredFeature } from '@garden-studio/schema';
import { bed, clampRect, extents } from '../../knowledge/archetypes/shared.js';
import { FEATURE_LIBRARY, placementLadder } from '../../knowledge/feature-library.js';
import {
  BED_MIN_DEPTH,
  terraceFloor,
  type LocalPoint,
  type LocalRect,
  type Room,
  type SketchRequest,
  type SlotKind,
} from '../../layout/sketch.js';
import { inRect, rectsOverlap } from './cells.js';
import {
  BACK_GAP_MIN,
  BAY_GAP,
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
 * Where a courtyard can hold a room: on the wall opposite the doors, and in the corner by the house.
 * **Not on the floor.** The floor is the terrace, which realisation treats as an obstacle, so a room
 * placed on it could never be seated — the hand-drawn plan offered two such places and its features
 * fell to the sampler. A feature with neither is reported, and one the brief calls essential makes
 * the composition decline to that plan.
 */
const HOSTS: SlotKind[] = ['axis-end', 'utility'];

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
export function court(room: Room, request: SketchRequest): Court {
  const { depth, width, uMin } = extents(room);
  const s = request.scale;

  /* Deep enough to plant in layers, capped so the room keeps a floor. */
  const rearDepth = Math.min(Math.max(bed(s), depth * 0.18), depth * MAX_BED_SHARE);
  const sideDepth = Math.min(Math.max(BED_MIN_DEPTH, width * 0.12), width * MAX_BED_SHARE);

  const rear = keep(
    clampRect({ u0: room.uMax - rearDepth, u1: room.uMax, v0: room.vMin, v1: room.vMax }, room),
    (rect) => rect.u1 - rect.u0 >= BED_MIN_DEPTH,
  );
  const floorFar = rear ? rear.u0 : room.uMax;
  const left = keep(
    clampRect({ u0: uMin, u1: floorFar, v0: room.vMin, v1: room.vMin + sideDepth }, room),
    (rect) => rect.v1 - rect.v0 >= BED_MIN_DEPTH,
  );
  const right = keep(
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
  const layout = court(room, request);
  const { uMin } = extents(room);
  const minimum = terraceFloor(room);
  const g = request.gateSide === 'left' ? -1 : 1;

  let floor: LocalRect = { ...layout.floor };
  let beds = layout.beds.map((entry) => ({ ...entry, rect: { ...entry.rect } }));
  const sideName = g > 0 ? 'Right border' : 'Left border';

  /*
   * Room is **carved**, not found. The hand-drawn courtyard had fixed places — a corner by the house
   * about a metre deep and a strip of the rear border — that no store and no fire pit fitted, so every
   * one fell to the sampler. Here each room takes the space it needs and the floor gives it up, never
   * below the terrace's own floor: the store in the corner by the house on the gate side, with the
   * bed along that side running on from it; the one thing to look at in the rear band, which deepens
   * to hold it.
   */
  const carve = (want: Want, taken: Bay[]): LocalRect | null => {
    if (want.kind === 'utility') {
      const fence = g > 0 ? room.vMax : room.vMin;
      /* Long side to the house first, then long side to the side fence where that leaves the floor. */
      for (const [across, deep] of [
        [want.width, want.depth],
        [want.depth, want.width],
      ] as const) {
        const inner = fence - g * across;
        const rect: LocalRect = {
          u0: uMin,
          u1: uMin + deep,
          v0: Math.min(inner, fence),
          v1: Math.max(inner, fence),
        };
        const next: LocalRect =
          g > 0
            ? { ...floor, v1: Math.min(floor.v1, inner - BAY_GAP) }
            : { ...floor, v0: Math.max(floor.v0, inner + BAY_GAP) };
        if (next.v1 - next.v0 < minimum.width || rect.u1 > floor.u1 - 1) continue;
        if (taken.some((bay) => rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9))) continue;
        if (!seats(want, rect)) continue;
        floor = next;
        beds = beds.filter((entry) => entry.name !== sideName);
        const along: LocalRect = {
          u0: rect.u1 + BAY_GAP,
          u1: floor.u1,
          v0: Math.min(inner, fence),
          v1: Math.max(inner, fence),
        };
        if (along.u1 - along.u0 >= BED_MIN_DEPTH) beds.push({ name: sideName, rect: along });
        return rect;
      }
      return null;
    }
    if (want.kind === 'axis-end') {
      const back = room.uMax - BACK_GAP_MIN;
      const rect: LocalRect = {
        u0: back - want.depth,
        u1: back,
        v0: -want.width / 2,
        v1: want.width / 2,
      };
      const far = Math.min(floor.u1, rect.u0 - 0.1);
      if (far - floor.u0 < minimum.depth) return null;
      if (taken.some((bay) => rectsOverlap(bay.rect, rect, BAY_GAP - 1e-9))) return null;
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
    }
    return null;
  };

  const terraceFeature: DesiredFeature | null = request.features.includes('seating')
    ? 'seating'
    : request.features.includes('dining')
      ? 'dining'
      : null;
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
      const want = wantFor(feature, kind, s);
      const rect = carve(want, bays);
      if (!rect || !seats(want, rect)) continue;
      bays.push(bayOf(want, rect));
      placed = true;
      break;
    }
    if (!placed) {
      if (isEssential(feature, index)) return null;
      dropped.push(feature);
    }
  }
  beds = beds.filter(
    (entry) =>
      entry.rect.u1 - entry.rect.u0 >= BED_MIN_DEPTH &&
      entry.rect.v1 - entry.rect.v0 >= BED_MIN_DEPTH,
  );

  const PURPOSE: Record<string, PlantingMass['purpose']> = {
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
  const corner = corners.find(
    (at) =>
      masses.some((mass) => mass.shape.kind === 'polygon' && insideLocal(at, mass.shape.points)) &&
      !bays.some((bay) => inRect(at, bay.rect)),
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

/** A rectangle, or nothing when it is too small to be the thing it claims to be. */
function keep(rect: LocalRect | null, viable: (rect: LocalRect) => boolean): LocalRect | null {
  return rect && viable(rect) ? rect : null;
}
