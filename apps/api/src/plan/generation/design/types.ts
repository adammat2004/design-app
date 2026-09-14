import type {
  DesignScope,
  DesiredFeature,
  FunctionalZoneType,
  LayoutArchetypeId,
  ZoneImportance,
  GardenIntent,
  GardenZone,
  Opening,
  PlacedFeature,
  Point,
  ResolvedGate,
  SiteShape,
  ZoneId,
} from '@garden-studio/schema';
import type { DesignConstraints, PlotScale } from '../constraints.js';
import type { DesignFrame, LocalBox } from '../layout/frame.js';
import type { LocalRect } from '../layout/sketch.js';
import type { ZoneRole } from '../layout/zone-roles.js';

/**
 * The design agent's own types: what it reads about a site and what it decides before geometry.
 *
 * These are **not** in `@garden-studio/schema` and should not move there. A `SiteAnalysis` is an
 * opinion about a plot, derived fresh every generation, read by nothing but the generator and
 * stored nowhere — the same argument `archetypes.ts` makes for `FEATURE_SPECS`. What crosses the
 * wire is the `DesignBrief`, the `DesignScore` and the `ConceptExplanation`, and those are shared
 * because a client may one day render them.
 */

/**
 * A door resolved to where it actually is, so the analysis never re-derives an opening.
 *
 * `openingSegment` and friends return `null` rather than guessing, and a door that no longer fits
 * its wall is a state the model can reach — so an exit that could not be resolved is simply not in
 * the list, and the analysis says `primary: null` rather than inventing a threshold.
 */
export interface ResolvedExit {
  opening: Opening;
  centre: Point;
  /** Unit vector out of the house through the door. */
  outward: Point;
  width: number;
}

/**
 * One side of the property, with what is on the other side of it.
 *
 * `exposure` is the honest three-way answer. The street edge is stated by the user; a side a gate
 * opens onto is known to be reachable; everything else is `neighbour` only where the boundary style
 * says something was built along it, and `unknown` otherwise. Privacy scoring reads this, and it
 * must never claim a neighbour where the document records nothing — the same refusal `location`
 * makes about latitude.
 */
export interface SiteEdge {
  /** The vertex the edge starts at: how every other module names a boundary edge. */
  vertexId: string;
  start: Point;
  end: Point;
  length: number;
  /** Inward unit normal: into the plot. */
  inward: Point;
  exposure: 'street' | 'neighbour' | 'unknown';
  /** What is built along it, from `site.boundaryStyles`. */
  kind: string;
  height: number;
  /** Which side of the design frame it lies on, when there is a frame. */
  side: 'back' | 'left' | 'right' | 'front' | null;
}

/** A part of the plot the grammar cannot design: too narrow, or beyond the room's half-plane. */
export interface AwkwardArea {
  zone: ZoneId;
  ring: Point[];
  reason: 'narrow-return' | 'beyond-room' | 'no-house';
  area: number;
}

/**
 * Everything the design agent knows about the site before it decides anything.
 *
 * Deterministic and pure: the same document always produces the same analysis, and no query is
 * issued. The PostGIS-derived parts of a generation (the clipped zones and rooms) arrive separately
 * in a `GenerationContext`, because those depend on the redesign area rather than on the site.
 */
export interface SiteAnalysis {
  boundary: Point[];
  /** The whole plot, in square metres. `scale.designedArea` is what is actually in scope. */
  plotArea: number;
  scale: PlotScale;

  house: {
    ring: Point[];
    centre: Point;
    rotation: number;
    storeys: number;
    width: number;
    depth: number;
  } | null;

  /** The frame off the garden door: origin at the door, `u` out, `v` along the wall. */
  frame: DesignFrame | null;
  /**
   * The garden behind the door wall, **unscoped** — the plot clipped to the half-plane, exactly
   * what `gardenRoom` returns. The scoped room is a PostGIS result and lives on the generation
   * context; this is the pure fact about the plot, and it is what the fixture test measures.
   */
  room: Point[] | null;
  box: LocalBox | null;
  /** The front frame and room, on the same terms. */
  frontFrame: DesignFrame | null;
  frontRoom: Point[] | null;

  shape: SiteShape;
  /** The room's depth out from the door and width along the wall, when there is a room. */
  roomDepth: number | null;
  roomWidth: number | null;

  /** Every zone the plot has, unclipped — a zone's identity is a fact about where the house is. */
  zones: GardenZone[];
  roles: Map<ZoneId, ZoneRole>;
  /** How wide each zone is level with the house; `null` where nothing of it is. */
  usableWidths: Map<ZoneId, number | null>;
  /** The zone the garden room's centroid lands in: where the grammar composes. */
  mainZoneId: ZoneId | null;
  frontZoneId: ZoneId | null;
  scope: DesignScope;

  exits: { primary: ResolvedExit | null; garden: ResolvedExit[]; front: ResolvedExit | null };
  gates: ResolvedGate[];
  /** The gate a side path starts at: never the street frontage, pedestrian before driveway. */
  sideGate: ResolvedGate | null;
  gateSide: 'left' | 'right' | null;

  edges: SiteEdge[];
  /** The line out of the doors to the far end of the room: what a focal point terminates. */
  primaryAxis: { from: Point; to: Point } | null;
  /** The ±30° wedge from the primary exit: what you see standing at the doors. */
  viewCone: Point[] | null;

  /** Existing features the user said to keep, with the outline they occupy. */
  retained: { feature: PlacedFeature; ring: Point[] }[];
  awkward: AwkwardArea[];

  /**
   * Where the shade falls mid-afternoon in midsummer, and which way the sun is then.
   *
   * `null` without `site.location`, and that is a refusal rather than a gap: solar altitude is a
   * function of latitude, so there is no shadow that is true of anywhere. The sun principle scores
   * nothing at all when this is null and its weight is redistributed.
   */
  sun: { towards: Point; shade: Point[][] } | null;
}

/**
 * What a candidate has decided so far, recorded as it decides it.
 *
 * Appended by the pass that takes the decision, which is what keeps the explanation honest: it
 * cannot claim the shed went by the gate unless the pass that puts sheds by gates ran and produced
 * an element to name.
 */
export interface Decision {
  kind: string;
  text: string;
  subjects: string[];
}

/**
 * The user's requirements, read out of the brief rather than taken from it literally.
 *
 * `capacity` is the count of features this plot can carry — the successor to `featureAttempts`,
 * which cut the list in brief order. Here the cut is by tier, so the thing that gets dropped is the
 * least wanted rather than the last ticked.
 */
export interface Requirements {
  intent: GardenIntent;
  /** Every requested feature with the tier it earned, most wanted first. */
  priorities: {
    feature: DesiredFeature;
    tier: 'essential' | 'preferred' | 'optional';
    reason: string;
  }[];
  /** How many placed features the plot and budget can carry. Composed features do not count. */
  capacity: number;
  /** Words lifted from the brief's prose that the intent was inferred from. Explanation only. */
  keywords: string[];
  constraints: DesignConstraints;
}

/* ---------------------------------------------------------------- zones */

/**
 * Where a room goes, said in terms a plot of any shape can answer.
 *
 * Not a coordinate and not a compass direction. "Far, on the gate's side" is true of a rectangle, an
 * L and a wedge alike, and it survives the plot being drawn at any angle — which is the same reason
 * the garden assistant's anchors are a bounded vocabulary rather than a point.
 */
export type ZonePlacement =
  | 'at-door'
  | 'door-end'
  | 'beside-door'
  | 'far'
  | 'far-gate-side'
  | 'far-away-side'
  | 'far-centre'
  | 'axis-end'
  | 'mid'
  | 'side-return'
  | 'front'
  | 'perimeter';

/**
 * A room in the garden, positioned before anything is placed in it.
 *
 * **A zone is not a feature**, and the distinction is the point of the whole layer. The dining zone
 * holds the terrace, the pergola, the table and the planting round them; it is the *zone* that gets
 * a place in the composition, and the features are then fitted inside it. The old generator had only
 * slots, so a pergola was "whatever fits `terrace-end`" rather than "part of the dining room", and
 * nothing could ask whether the dining room held together.
 *
 * `rect` is in the design frame — `u` out from the door, `v` along the wall — and is `null` for a
 * zone whose place the archetype could not find, or whose geometry lives outside the frame
 * altogether (the side return beside the house is the one of those).
 */
export interface FunctionalZone {
  id: string;
  type: FunctionalZoneType;
  importance: ZoneImportance;
  /** The requested features this zone claims, most wanted first. */
  features: DesiredFeature[];
  /** Square metres: the least worth having, what it wants, and the most worth giving it. */
  area: { min: number; ideal: number; max: number };
  placement: ZonePlacement;
  rect: LocalRect | null;
}

/**
 * The rooms, and which of them should touch.
 *
 * `adjacency` is what the circulation planner turns into routes in Phase 3 and what the grouping
 * principle reads meanwhile. Pairs of zone ids, undirected.
 */
export interface ZonePlan {
  zones: FunctionalZone[];
  adjacency: [string, string][];
  /** The zone the whole plan is organised around. Always present in `zones`. */
  primaryId: string;
}

/**
 * The axes a layout may vary along, within one archetype.
 *
 * Deliberately tiny. Phase 3 enumerates these into candidates, and a parameter that does not
 * provably change the placed result only makes the diversity filter count identical gardens as
 * different. Each of these moves real geometry: `terraceDepth` threads through the terrace, the
 * courtyard test and both lawn edges; `lawnBias` decides which side gets the deep border and which
 * the mowing strip; `destination` moves the far room across the garden.
 *
 * Two axes from the first draft are **not** here. `utilitySide` is not a choice — the shed goes on
 * the gate's side by rule, and there is a test for it. `terraceAlign` needs the door's offset along
 * its wall, which `SketchRequest` does not carry yet.
 */
export interface CandidateParams {
  archetype: LayoutArchetypeId;
  /** Multiplier on the terrace's wanted depth. The floor still governs. */
  terraceDepth: 0.85 | 1 | 1.15;
  lawnBias: 'gate' | 'away' | 'centre';
  destination: 'far-diagonal' | 'far-centre' | 'axis-end';
  /** How many of the lowest-priority features to leave out before laying anything. */
  priorityCut: 0 | 1 | 2;
}

/**
 * What the repair stage changed about one particular candidate.
 *
 * **Separate from `CandidateParams`, and the separation is the point.** A parameter is an axis the
 * enumeration already walks — every value of `terraceDepth` is previewed and scored for every
 * composition — so a repair that only moved a parameter would be searching a space that has already
 * been searched exhaustively, and could never find anything the loop had not already rejected. What
 * a repair can do that enumeration cannot is act on a *measured fault in this arrangement*: move the
 * one feature the scorer named, take the next approach to the one path that pinches, leave out the
 * one thing there was no room for. Those are targeted at a subject, so they cannot be enumerated.
 *
 * **Every field here is honoured by realisation as well as by the preview**, and that is a rule
 * rather than an aspiration: a repair accepted on a reading of a drawing the real pipeline then
 * ignores is worse than no repair at all, because the score would claim an improvement the garden
 * does not have. Adding a field means plumbing it into `concepts.service.ts` in the same change.
 *
 * The empty value is `NO_ADJUSTMENTS`, and a candidate carrying it draws exactly what it drew before
 * the repair stage existed.
 */
export interface LayoutAdjustments {
  /** Features left out beyond the capacity cut, because the plan was better without them. */
  dropped: DesiredFeature[];
  /**
   * Slots a feature may not take, so it falls through to the next rung of its own ladder. This is
   * the whole of `move-to-zone`: the fitter is first-fit, so removing the slot it chose is how you
   * ask it for its second answer without teaching it to rank.
   */
  avoidSlots: { feature: DesiredFeature; slot: string }[];
  /** Per route name, how many legal approaches to pass over. See `routeBetween`'s `skip`. */
  reroute: Record<string, number>;
  /** A floor under every route's width, raising it above what `circulationFor` asked for. */
  routeWidth: number | null;
  /** How far along the nudge ladder a sketched tree starts. */
  treeNudge: number;
}

export const NO_ADJUSTMENTS: LayoutAdjustments = {
  dropped: [],
  avoidSlots: [],
  reroute: {},
  routeWidth: null,
  treeNudge: 0,
};

/** Whether anything was actually changed, so a caller can skip work an empty set implies. */
export function hasAdjustments(adjustments: LayoutAdjustments): boolean {
  return (
    adjustments.dropped.length > 0 ||
    adjustments.avoidSlots.length > 0 ||
    Object.keys(adjustments.reroute).length > 0 ||
    adjustments.routeWidth !== null ||
    adjustments.treeNudge > 0
  );
}

/** Whether this feature is barred from this slot. */
export function slotBarred(
  adjustments: LayoutAdjustments,
  feature: DesiredFeature,
  slot: string,
): boolean {
  return adjustments.avoidSlots.some((entry) => entry.feature === feature && entry.slot === slot);
}
