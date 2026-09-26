import type { DesiredFeature, FunctionalZoneType, LayoutArchetypeId } from '@garden-studio/schema';
import type {
  LocalPoint,
  LocalRect,
  LocalShape,
  RouteTier,
  SlotKind,
} from '../../layout/sketch.js';

/**
 * A garden as a composition: what it is organised around, where its rooms are, how you move
 * between them, where the eye lands — decided before a single footprint is fitted.
 *
 * The layer the generator went without. It used to go from "the brief asked for a pergola" straight
 * to "what fits in the far-room slot", and the far-room slot was an anchor that happened to sit on
 * the lawn — so the pergola stood on the grass, a diagonal line of stepping stones was cut across the
 * grass to reach it, and the lawn was whatever the beds left behind. Every one of those things was
 * legal. None of them was designed.
 *
 * A composition is decided in the order a designer draws: the open space is reserved first and the
 * rooms go in **bays** round it rather than on it; the ways between them run in **corridors** along
 * its edge rather than across it; one thing terminates the view; the planting is what is left, named
 * for what it does. Everything is in the design frame — `u` out from the doors, `v` along the wall —
 * and nothing here touches the boundary or a database. `compose-sketch.ts` turns it into the
 * `LayoutSketch` the rest of the pipeline already understands.
 */

/**
 * Why a thing is in the plan, in one word.
 *
 * Recorded on the element by the pass that put it there (`DesignElement.purpose`), so "why is this
 * here" has an answer after the plan is stored. The scorer's `orphan-feature` asks it of every
 * feature on a plan that carries the vocabulary at all.
 */
export const PURPOSES = [
  'terrace',
  'dining-room',
  'lounge',
  'destination',
  'focal',
  'play',
  'utility-store',
  'productive',
  'water',
  'access-route',
  'utility-route',
  'garden-route',
  'decorative-route',
  'axis',
  'transition',
  'backdrop-planting',
  'framing-planting',
  'screening-planting',
  'threshold-planting',
  'focal-tree',
  'framing-tree',
  'screening-tree',
  'backdrop-tree',
  'arrival',
  'passage',
] as const;
export type ElementPurpose = (typeof PURPOSES)[number];

/**
 * The shape language a composition speaks. A plan may mix them, but deliberately: a curved lawn in
 * a rectilinear garden is a decision, a gravel circle in one is usually an accident.
 */
export type GeometryLanguage = 'rectilinear' | 'soft_organic' | 'formal_symmetric';

/** A room's place in the composition, carved out of the border or a corner rather than the lawn. */
export interface Bay {
  /** Equal to the slot kind it replaces, so repairs and the explanation keep their vocabulary. */
  id: string;
  kind: SlotKind;
  /** The functional zone of the feature it was reserved for, which is what assignment keys on. */
  zoneId: FunctionalZoneType;
  /** The feature it was reserved for, or `null` for a spare room the plot can carry. */
  feature: DesiredFeature | null;
  rect: LocalRect;
  purpose: ElementPurpose;
  turn?: boolean;
  minSize?: { width: number; depth: number };
}

/** The open ground: the lawn, or gravel where grass is not wanted. Reserved before anything else. */
export interface OpenSpace {
  /** The panel's bounding rectangle, which the corridors and bays were measured against. */
  rect: LocalRect;
  /** What is actually drawn: the rectangle notched round any bay that had to reach into it. */
  shape: LocalShape;
  category: 'lawn' | 'gravel-mulch';
}

/** A strip of ground kept for a route, so the route runs beside the lawn rather than across it. */
export interface Corridor {
  name: string;
  /** The route it was kept for, so a refused room takes its corridor with it. */
  route?: string;
  rect: LocalRect;
}

/** A route as the composition means it, before the router finds the legal line. */
export interface CirculationEdge {
  name: string;
  from: LocalPoint | { terrace: true };
  to: { slot: string; or?: string[] } | { gate: true };
  via: LocalPoint[];
  tier: RouteTier;
  purpose: ElementPurpose;
  /** The route this one leaves, by name: a spur off a trunk, joined where it starts. */
  branch?: string;
}

export interface TreePlan {
  at: LocalPoint;
  role: 'focal' | 'framing' | 'screening' | 'backdrop';
  purpose: ElementPurpose;
}

export interface PlantingMass {
  name: string;
  shape: LocalShape;
  purpose: ElementPurpose;
}

export interface GardenComposition {
  archetype: LayoutArchetypeId;
  language: GeometryLanguage;
  terrace: LocalRect;
  openSpace: OpenSpace | null;
  bays: Bay[];
  corridors: Corridor[];
  circulation: CirculationEdge[];
  /** What terminates the view down the garden: a bay's feature, a tree, or nothing. */
  focal: { kind: 'feature'; bay: string } | { kind: 'tree'; at: LocalPoint } | null;
  masses: PlantingMass[];
  trees: TreePlan[];
  /** The formal plan's paved line down the middle, as a strip. */
  axis: LocalRect | null;
  /** Where along it the axis stops beside something it serves. */
  axisStops: number[];
  decisions: { kind: string; text: string }[];
}
