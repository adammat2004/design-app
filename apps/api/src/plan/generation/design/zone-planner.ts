import type { DesignBrief, DesiredFeature, FunctionalZoneType } from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../knowledge/feature-library.js';
import type { LayoutArchetype } from '../knowledge/archetypes/types.js';
import { adjacencyOf } from '../knowledge/archetypes/shared.js';
import type { Room, SketchRequest } from '../layout/sketch.js';
import type { CandidateParams, FunctionalZone, SiteAnalysis, ZonePlan } from './types.js';

/**
 * The rooms a garden is made of, and where each one goes.
 *
 * The stage the generator never had. It went straight from "the brief asked for a pergola" to "what
 * fits in the `terrace-end` slot", so a pergola was a thing in a position rather than part of the
 * dining room — and nothing could ask whether the dining room held together, because there was no
 * dining room to ask about.
 *
 * Two steps, in this order and for a reason:
 *
 * 1. **The brief decides what rooms there are**, from the features that survived the capacity cut.
 *    A zone with nothing to put in it is not a room, and inventing one would have the plan claim a
 *    space it never draws.
 * 2. **The archetype decides where they go**, because that is what a composition *is*. The same
 *    three rooms are arranged one way by a terrace-and-lawn plan and another by a wide shallow one.
 *
 * Pure, and the rectangles are in the design frame — `u` out from the door, `v` along the wall — so
 * a plot drawn at any angle gets the same plan.
 */

/**
 * What each kind of room wants, in square metres at suburban scale.
 *
 * `min` is the point below which it stops being the room it claims to be, and it is derived from
 * what the room holds rather than declared: a terrace is its furniture plus the margin round it,
 * which is the rule `TERRACE_FLOOR` already follows. `ideal` and `max` are judgement, and they
 * scale with the plot through `sizeFactor` at the point of use.
 */
const ZONE_AREAS: Record<FunctionalZoneType, { min: number; ideal: number; max: number }> = {
  terrace: { min: 11, ideal: 22, max: 45 },
  dining: { min: 9, ideal: 16, max: 30 },
  lounge: { min: 6, ideal: 12, max: 24 },
  play: { min: 9, ideal: 18, max: 40 },
  lawn: { min: 12, ideal: 45, max: 200 },
  utility: { min: 4, ideal: 8, max: 18 },
  productive: { min: 6, ideal: 14, max: 40 },
  planting: { min: 4, ideal: 25, max: 120 },
  water: { min: 1, ideal: 6, max: 20 },
  destination: { min: 6, ideal: 14, max: 30 },
  transition: { min: 2, ideal: 8, max: 30 },
  arrival: { min: 4, ideal: 16, max: 60 },
  passage: { min: 2, ideal: 6, max: 20 },
};

/**
 * Where each kind of room goes when nothing else decides.
 *
 * The archetype overrides this with real rectangles; this is the vocabulary answer, which is what a
 * composition that cannot host a room falls back to and what the explanation quotes.
 */
const ZONE_PLACEMENT: Record<FunctionalZoneType, FunctionalZone['placement']> = {
  terrace: 'at-door',
  dining: 'door-end',
  lounge: 'side-return',
  play: 'far-away-side',
  lawn: 'mid',
  utility: 'far-gate-side',
  productive: 'far-gate-side',
  planting: 'perimeter',
  water: 'axis-end',
  destination: 'far',
  transition: 'perimeter',
  arrival: 'front',
  passage: 'side-return',
};

export interface ZonePlanRequest {
  brief: DesignBrief;
  site: SiteAnalysis;
  archetype: LayoutArchetype;
  params: CandidateParams;
  room: Room;
  request: SketchRequest;
  /** The features that survived the capacity cut, in priority order. */
  placing: DesiredFeature[];
}

export function planZones(input: ZonePlanRequest): ZonePlan {
  const zones = roomsFor(input);
  const primaryId = primaryOf(zones, input.brief);

  /*
   * The archetype places them. A zone it has no room for comes back with `rect: null` rather than
   * being dropped — the brief asked for it, and losing it silently is the failure the explanation
   * exists to prevent. The layout generator then falls through to the sampler for its features.
   */
  const placed = input.archetype
    .zonePattern(zones, input.room, input.params, input.request)
    .map((zone) => (input.archetype.hosts.includes(zone.type) ? zone : { ...zone, rect: null }));

  return { zones: placed, adjacency: adjacencyOf(placed, primaryId), primaryId };
}

/**
 * The rooms this brief actually needs.
 *
 * Derived from the features rather than from the brief's zone lists, and the two can differ:
 * `secondaryZones` says what the concept would *like* to be organised into, and this says what it
 * has anything to put in. Where they disagree the features win, because they are what gets drawn.
 */
export function roomsFor(
  input: Pick<ZonePlanRequest, 'brief' | 'site' | 'placing'>,
): FunctionalZone[] {
  const { brief, site, placing } = input;
  const scale = site.scale.sizeFactor;

  const byType = new Map<FunctionalZoneType, DesiredFeature[]>();
  for (const feature of placing) {
    const type = FEATURE_LIBRARY[feature].zone;
    byType.set(type, [...(byType.get(type) ?? []), feature]);
  }

  /*
   * Every garden has a terrace at the doors and planting round the edges, whether or not anything
   * was ticked for either. They are what makes a plan a garden rather than objects on grass, and
   * both are composed by passes that run anyway.
   */
  if (!byType.has('terrace')) byType.set('terrace', []);
  if (!byType.has('planting')) byType.set('planting', []);
  /* And a lawn, unless the brief excluded one. */
  const lawnExcluded = brief.excludedFeatures.some((entry) => entry.feature === 'lawn');
  if (!lawnExcluded && !byType.has('lawn')) byType.set('lawn', []);

  const zones: FunctionalZone[] = [];
  for (const [type, features] of byType) {
    const area = ZONE_AREAS[type];
    zones.push({
      id: type,
      type,
      importance: importanceOf(type, brief),
      features,
      area: {
        min: area.min,
        /* The ideal and the ceiling follow the plot; the floor never does — a table is a table. */
        ideal: area.ideal * scale,
        max: area.max * scale,
      },
      placement: ZONE_PLACEMENT[type],
      rect: null,
    });
  }

  /*
   * Ordered by importance so every later pass — slot assignment, scoring, the explanation — walks
   * the rooms in the order the design cares about them.
   */
  const rank = { primary: 0, secondary: 1, supporting: 2 } as const;
  return zones.sort((a, b) => rank[a.importance] - rank[b.importance]);
}

function importanceOf(type: FunctionalZoneType, brief: DesignBrief): FunctionalZone['importance'] {
  if (type === brief.primaryZone) return 'primary';
  if (brief.secondaryZones.includes(type)) return 'secondary';
  /* A terrace is never merely supporting: it is where you come out of the house. */
  if (type === 'terrace') return 'secondary';
  return 'supporting';
}

/**
 * Which room the plan is organised around.
 *
 * The brief proposes and the rooms dispose. A brief whose primary zone did not survive the capacity
 * cut falls back to the most important room that did, and to the terrace in the last resort — which
 * always exists. Claiming a primary zone the plan has nothing to put in is the same silent fiction
 * as naming a focal point the garden does not contain.
 */
function primaryOf(zones: FunctionalZone[], brief: DesignBrief): string {
  const wanted = zones.find((zone) => zone.type === brief.primaryZone);
  if (wanted) return wanted.id;
  return (zones.find((zone) => zone.importance !== 'supporting') ?? zones[0])?.id ?? 'terrace';
}

/** The zone a feature belongs to in this plan, or `null` when no room claims it. */
export function zoneFor(plan: ZonePlan, feature: DesiredFeature): FunctionalZone | null {
  return plan.zones.find((zone) => zone.features.includes(feature)) ?? null;
}

/** Every room the composition found a place for. */
export function placedZones(plan: ZonePlan): FunctionalZone[] {
  return plan.zones.filter((zone) => zone.rect !== null);
}
