import {
  geometryOutline,
  type DesignElement,
  type ElementCategory,
  type GardenZone,
  type HouseFootprint,
  type PlanGeometry,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';
import { materialFor } from '../archetypes.js';
import { styleCornerRadius, type DesignConstraints } from '../constraints.js';
import type { FillService } from '../fill.service.js';
import { passageBorderWidth, usableWidth, type ZoneRole } from '../layout/zone-roles.js';
import { placeable } from './placeable.js';

/**
 * How deep the planted band against the fence runs, in metres.
 *
 * Wide enough to clear `MIN_FILL_SIDE` — a narrower band is rejected piece by piece as a sliver and
 * the border never appears at all — and about what a real mixed border is: deep enough to plant in
 * layers, shallow enough to reach the back of.
 *
 * **2.2 m, and the old 1.5 was the bottom of that range rather than the middle of it.** A bed a
 * metre and a half deep holds two ranks of plants: something at the back and something in front of
 * it, which is a strip rather than a border, and it is why a generated plan's planting reads as an
 * edging round a lawn where the traced reference's reads as the body of the garden. The reference's
 * own beds run from 2.2 to 6.9 m. Three ranks is the least a layered planting needs, and 2.2 m is
 * what three ranks of the shrubs, grasses and perennials `planting.ts` specifies actually occupy.
 * `passageBorderWidth` still narrows it where a bed that deep would block the way past the house,
 * so nothing here can close an access lane.
 */
const BORDER_WIDTH = 2.2;

export interface BordersContext {
  fill: FillService;
  /** The garden room the grammar composed in, or `null` where there was nothing to compose round. */
  grammarRoom: Point[] | null;
  /** Whether there was a composition at all: `false` only where there was nothing to compose round. */
  composed: boolean;
  designed: DesignElement[];
  lawn: DesignElement | null;
  featureLayer: DesignElement[];
  frontFills: DesignElement[];
  zones: GardenZone[];
  zoneById: Map<ZoneId, GardenZone>;
  roles: Map<ZoneId, ZoneRole>;
  /** Zones that plant themselves: the front, and the room the grammar composed. */
  skip: (ZoneId | undefined)[];
  house: HouseFootprint | null;
  boundary: Point[];
  houseRing: Point[] | null;
  scopePolygon: Point[] | null;
  /** What the no-grammar pass must clear, grown by the bands it lays. */
  obstacles: Point[][];
  constraints: DesignConstraints;
  index: number;
  nextId: () => string;
  accentCount: number;
  accents: ElementCategory[];
}

/**
 * The planting against the fences, beyond what the composition drew.
 *
 * On a plan with a garden room, a border in every zone but the front and the room itself — by the
 * zone's role, as deep as leaves a side return a way past the house — cut round everything already
 * laid. With no room to compose in, the old pass: a band against the fence, then the largest
 * remainders as accent beds.
 */
export async function fenceBorders(context: BordersContext): Promise<DesignElement[]> {
  const out: DesignElement[] = [];
  if (context.grammarRoom) {
    const rooms: Point[][] = context.designed.map((e) => geometryOutline(e.shape));
    if (context.lawn) rooms.push(geometryOutline(context.lawn.shape));
    for (const element of context.featureLayer) {
      if (element.category === 'furniture' || element.category === 'existing-feature') continue;
      rooms.push(geometryOutline(element.shape));
    }
    for (const element of context.frontFills) rooms.push(geometryOutline(element.shape));
    /*
     * **On a composed plan the band stops at the garden room.** Everything inside the room was
     * composed — every cell is lawn, a room, a corridor or a planting mass named for what it does —
     * so a band grown from the fence there could only land on what the composition kept clear: a
     * corridor, and the margin either side of the path laid down it. That is where most of the
     * plan's "path cuts through planting" and "squeezes between two things" came from. The side
     * returns beside the house and whatever lies outside the room are still banded, as before.
     */
    if (context.composed) rooms.push(context.grammarRoom);

    /*
     * Fence borders in every zone but two, by role — see `layout/zone-roles.ts`.
     *
     * The *main* zone gets none here: its planting is the composition's own masses — the rear
     * border, the side beds and the flanks, composed with the lawn rather than left over from it. (This
     * loop used to ask `borderRegions` for a 0.45 m band there, which the sliver guard rejected
     * on every plan; the call was dead and is gone.) The *front* gets none either: `front.ts`
     * lays its own beds and hedge.
     *
     * A *passage* gets a bed along its fence only as deep as leaves a way past the house, and
     * none at all when even the thinnest survivable bed would block it — a side return is a way
     * past first. A *secondary* side or a *remote* zone gets the full border, as before.
     */
    for (const zone of context.zones) {
      if (context.skip.includes(zone.id)) continue;

      const role = context.roles.get(zone.id) ?? 'remote';
      /*
       * Measured on the *unclipped* zone. How much room there is to walk past the house is a
       * physical fact about the plot, not about what the user ticked — a 4 m side return whose
       * redesign area covers 2 m of it still has to reserve the access lane, and measuring the
       * clipped piece would conclude the side was too narrow to plant at all.
       */
      const full = context.zoneById.get(zone.id) ?? zone;
      const usable = role === 'passage' && context.house ? usableWidth(full, context.house) : null;
      const width =
        role === 'passage' && usable !== null
          ? passageBorderWidth(usable, BORDER_WIDTH)
          : BORDER_WIDTH;
      if (width <= 0) continue;

      const pieces = await context.fill.borderRegions(context.boundary, zone.polygon, rooms, width);

      pieces.forEach((ring, order) => {
        const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
        if (!placeable(shape, context.houseRing, context.boundary, context.scopePolygon)) return;

        out.push({
          id: context.nextId(),
          category: 'planting-bed',
          role: 'fill',
          fillKind: 'accent',
          shape,
          zone: zone.id,
          /*
           * A different planting per piece: the drifts. A border of one species round the whole
           * garden reads as a hedge; shrubs, then grasses, then a mixed border reads as planted.
           */
          material: materialFor('planting-bed', context.constraints, context.index + order),
        });
      });
    }
  } else {
    /*
     * No room to sketch in — no house, or the back garden out of scope — so the fill is the
     * old pass: a border band against the fence, then the largest remainders as accent beds.
     */
    for (const zone of context.zones) {
      const bands = await context.fill.borderRegions(
        context.boundary,
        zone.polygon,
        context.obstacles,
        BORDER_WIDTH,
      );

      bands.forEach((ring, order) => {
        const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
        if (!placeable(shape, context.houseRing, context.boundary, context.scopePolygon)) return;

        out.push({
          id: context.nextId(),
          category: 'planting-bed',
          role: 'fill',
          fillKind: 'accent',
          shape,
          zone: zone.id,
          material: materialFor('planting-bed', context.constraints, context.index + order),
        });

        context.obstacles.push(geometryOutline(shape));
      });
    }

    for (const zone of context.zones) {
      const regions = await context.fill.accentRegions(
        zone.polygon,
        context.obstacles,
        context.accentCount,
      );

      regions.forEach((ring, order) => {
        const category = context.accents[order % context.accents.length]!;

        out.push({
          id: context.nextId(),
          category,
          role: 'fill',
          fillKind: 'accent',
          shape: {
            kind: 'polygon',
            points: ring,
            cornerRadius: styleCornerRadius(context.constraints.style),
          },
          zone: zone.id,
          material: materialFor(category, context.constraints, context.index + order),
        });
      });
    }
  }

  return out;
}
