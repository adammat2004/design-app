import type { Point } from '../geometry/primitives.js';
import type { BoundaryKind } from './boundary-style.js';
import type { SiteForBoundaries } from './boundary-styles.js';
import { effectiveBoundaryRuns, enclosureKindOf } from './enclosures.js';
import { ENCLOSURE_KINDS } from './enclosure.js';
import { heightFor } from './heights.js';
import { polylineLength } from '../geometry/shapes.js';
import { elementArea, type DesignElement } from './concepts.js';
import { bedMix, mixCounts } from './plants/mixes.js';
import { speciesById, type PlantSpecies } from './plants/species.js';
import { isPlacedPlant } from './quantities.js';
import { levelBands, stepFlight } from './levels.js';
import { materialLabel } from './materials.js';
import { resolveSymbol, SYMBOLS } from './symbols.js';

/**
 * The lengths and counts a plan is specified in beside its areas.
 *
 * `planSchedule` answers "how much of each material": square metres, slab counts, edging by the
 * metre. It could never answer how long the fences are, how much retaining wall a raised terrace
 * needs, how many steps come down off it or how many of each light fitting there are — although
 * every one of those numbers was already derivable here: `boundaryRuns` measures each side,
 * `levelBands` carries a face length it said nothing summed, and `stepFlight` counts risers. This is
 * the pass that sums them.
 *
 * Nothing is stored and nothing is measured afresh — it reads the resolvers the renderer and the
 * shadow model already trust, so a number here cannot disagree with what is drawn. Hidden elements
 * are left out for the reason `planSchedule` leaves them out: a schedule that counts what the plan
 * does not show is a schedule nobody can check.
 */

export type TakeoffGroup = 'planting' | 'enclosure' | 'boundary' | 'levels' | 'lighting';

export interface TakeoffLine {
  group: TakeoffGroup;
  label: string;
  /** Metres, for what is bought or built by length. */
  lengthM: number | null;
  /** How many, for what is counted: fittings, steps. */
  count: number | null;
  /** Square metres, where the face of a thing is what gets priced — a retaining wall's. */
  areaSqm: number | null;
  /** A short qualifier: a height, how many flights. */
  detail: string | null;
}

const BOUNDARY_LABELS: Record<BoundaryKind, string> = {
  fence: 'Fence',
  wall: 'Wall',
  hedge: 'Hedge',
  railing: 'Railing',
  screen: 'Screen',
  open: 'Open boundary',
};

export interface TakeoffInput {
  elements: DesignElement[];
  /** The property's sides and what they are made of. Absent means no boundary lines. */
  site?: SiteForBoundaries;
  /** The house footprint, which retaining faces never run along. */
  house?: Point[];
}

export function planTakeoff({ elements, site, house }: TakeoffInput): TakeoffLine[] {
  const shown = elements.filter((element) => !element.hidden);
  return [
    ...plantingLines(shown),
    ...enclosureLines(shown),
    ...boundaryLines(site, shown),
    ...levelLines(shown, house),
    ...lightingLines(shown),
  ];
}

/**
 * Plants to order, by species: every bed's mix counted at its species' own centres, and every tree
 * and specimen shrub that names one. The same hornbeam in a hedge mix and standing on its own is one
 * line, because it is one order.
 *
 * A bed with no mix and a plant with no species are left out rather than guessed — the schedule
 * still carries their area and count by material, which is what is honestly known about them.
 */
function plantingLines(elements: DesignElement[]): TakeoffLine[] {
  const bySpecies = new Map<string, { species: PlantSpecies; count: number; massed: boolean }>();
  const add = (species: PlantSpecies, count: number, massed: boolean) => {
    const entry = bySpecies.get(species.id) ?? { species, count: 0, massed: false };
    entry.count += count;
    entry.massed ||= massed;
    bySpecies.set(species.id, entry);
  };

  for (const element of elements) {
    if (element.category !== 'planting-bed') continue;
    if (isPlacedPlant(element)) {
      const species = speciesById(element.plantId);
      if (species) add(species, 1, false);
      continue;
    }
    const mix = bedMix(element);
    if (!mix) continue;
    for (const line of mixCounts(mix, elementArea(element))) {
      if (line.count > 0) add(line.species, line.count, true);
    }
  }

  return [...bySpecies.values()]
    .sort((a, b) => b.count - a.count || a.species.common.localeCompare(b.species.common))
    .map(({ species, count, massed }) => ({
      group: 'planting' as const,
      label: species.common,
      lengthM: null,
      count,
      areaSqm: null,
      detail: massed ? `${species.botanical} · ${species.spacing.toFixed(2)} m centres` : species.botanical,
    }));
}

/**
 * What the design builds along its lines, by kind, material and height: "Screen — slatted cedar,
 * 1.8 m: 6.2 m, new". Measured along the centreline, which is how a fence is ordered.
 */
function enclosureLines(elements: DesignElement[]): TakeoffLine[] {
  const byKey = new Map<string, { label: string; height: number; length: number; kind: string; kept: boolean }>();
  for (const element of elements) {
    if (element.category !== 'enclosure' || element.shape.kind !== 'polyline') continue;
    const kind = enclosureKindOf(element);
    const height = Math.round(heightFor(element) * 10) / 10;
    const material = element.material ?? ENCLOSURE_KINDS[kind].material;
    /* A fence kept from step 2 is on the list, but as what is there already, never as an order. */
    const kept = element.status === 'keep';
    const key = `${kind}:${material}:${height}:${kept}`;
    const entry = byKey.get(key) ?? {
      label: kind === 'open' ? 'Boundary opened' : `${ENCLOSURE_KINDS[kind].label} — ${materialLabel(material)}`,
      height,
      length: 0,
      kind,
      kept,
    };
    entry.length += polylineLength(element.shape.points);
    byKey.set(key, entry);
  }

  return [...byKey.values()]
    .sort((a, b) => b.length - a.length)
    .map((entry) => ({
      group: 'enclosure' as const,
      label: entry.label,
      lengthM: entry.length,
      count: null,
      areaSqm: null,
      detail:
        entry.kind === 'open'
          ? 'taken down'
          : `${entry.height.toFixed(1)} m high, ${entry.kept ? 'kept' : 'new'}`,
    }));
}

/**
 * The property's sides, by what they are and how tall.
 *
 * These are the boundaries as step 1 recorded them, less whatever the design replaces: a proposed
 * screen along the left fence takes that stretch out of this group and into the one above, so a
 * metre of boundary is never counted as both the old fence and the new screen. An open side is left
 * out because there is nothing along it to measure.
 */
function boundaryLines(site: SiteForBoundaries | undefined, elements: DesignElement[]): TakeoffLine[] {
  if (!site) return [];

  const byKind = new Map<string, { kind: BoundaryKind; height: number; length: number }>();
  for (const run of effectiveBoundaryRuns(site, elements).survey) {
    if (run.kind === 'open') continue;
    const height = Math.round(run.height * 10) / 10;
    const key = `${run.kind}:${height}`;
    const entry = byKind.get(key) ?? { kind: run.kind, height, length: 0 };
    entry.length += run.length;
    byKind.set(key, entry);
  }

  return [...byKind.values()]
    .sort((a, b) => b.length - a.length)
    .map((entry) => ({
      group: 'boundary' as const,
      label: BOUNDARY_LABELS[entry.kind],
      lengthM: entry.length,
      count: null,
      areaSqm: null,
      detail: `${entry.height.toFixed(1)} m high`,
    }));
}

/**
 * Retaining faces by what they are built of, then the steps.
 *
 * A face's length is what `levelBands` measures and its area is length × rise, which is how a
 * retaining wall is actually priced — a metre of wall holding up 150 mm and a metre holding up a
 * metre are not the same job. A plain upstand in the host's own paving gets its own line rather
 * than being folded into a walling material it is not made of.
 */
function levelLines(elements: DesignElement[], house: Point[] | undefined): TakeoffLine[] {
  const byWalling = new Map<string, { label: string; length: number; area: number }>();
  for (const band of levelBands(elements, house ? { house } : {})) {
    const key = band.walling ?? 'upstand';
    const entry = byWalling.get(key) ?? {
      label: band.walling ? `Retaining wall — ${materialLabel(band.walling)}` : 'Retaining upstand',
      length: 0,
      area: 0,
    };
    entry.length += band.length;
    entry.area += band.length * band.rise;
    byWalling.set(key, entry);
  }

  const lines: TakeoffLine[] = [...byWalling.values()]
    .sort((a, b) => b.length - a.length)
    .map((entry) => ({
      group: 'levels' as const,
      label: entry.label,
      lengthM: entry.length,
      count: null,
      areaSqm: entry.area,
      detail: null,
    }));

  let flights = 0;
  let risers = 0;
  for (const element of elements) {
    if (resolveSymbol(element) !== 'steps') continue;
    const flight = stepFlight(element.elevation ?? 0);
    if (!flight) continue;
    flights += 1;
    risers += flight.risers;
  }
  if (flights > 0) {
    lines.push({
      group: 'levels',
      label: 'Steps',
      lengthM: null,
      count: risers,
      areaSqm: null,
      detail: flights === 1 ? 'one flight' : `${flights} flights`,
    });
  }

  return lines;
}

/**
 * Fittings by type. The schedule groups lighting by *finish*, which is what a supplier's catalogue
 * is ordered by; this is what an electrician counts, and the two are both true of one plan.
 */
function lightingLines(elements: DesignElement[]): TakeoffLine[] {
  const bySymbol = new Map<string, number>();
  for (const element of elements) {
    if (element.category !== 'lighting') continue;
    const symbol = resolveSymbol(element);
    const label = symbol ? SYMBOLS[symbol].label : 'Light fitting';
    bySymbol.set(label, (bySymbol.get(label) ?? 0) + 1);
  }

  return [...bySymbol.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({
      group: 'lighting' as const,
      label,
      lengthM: null,
      count,
      areaSqm: null,
      detail: null,
    }));
}
