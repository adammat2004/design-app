import { z } from 'zod';
import type { ElementCategory } from './concepts.js';

/**
 * What a thing on the plan *is*, when it is not a surface.
 *
 * A pergola and a garden store are both `structure` built from `softwood`; a dining set and a
 * sun lounger are both `furniture`. Category and material between them cannot say which, and the
 * drawing has to — a pergola is posts and beams with a shadow under them, a shed is a roof with a
 * ridge. The symbol is the one word that settles it.
 *
 * On the document as a plain string, for the reason `material` is: a stored plan must not become
 * unparseable because this list was edited. `resolveSymbol` is where an unknown id becomes `null`,
 * which every consumer treats as "draw it the way you would with no symbol".
 *
 * The footprints here are **natural sizes**, what the generator places and what the editor offers
 * when a user adds one. They are never read back off a placed element: its rect or radius is the
 * geometry of record, and a sprite is fitted inside that, never the other way round.
 */
export const SymbolIdSchema = z.enum([
  /* ---- furniture ---- */
  'dining-set-4',
  'dining-set-6',
  'sofa-set',
  'lounger',
  'bbq',
  'fire-pit',
  'bench',
  'parasol',
  'planter',
  /* ---- play equipment ---- */
  'swing',
  'slide',
  'trampoline',
  /* ---- lighting ---- */
  'light-spike',
  'light-bollard',
  'light-recessed',
  'light-wall',
  /* ---- structures: drawn, not photographed ---- */
  'steps',
  'pergola',
  'shed',
  'gazebo',
  'raised-bed',
  'garden-room',
  'greenhouse',
  /*
   * The one structure that is a *product* rather than a built rectangle, and therefore the one
   * drawn from a photograph: a hot tub comes in a fixed size and looks the same in every garden,
   * which is what `furniture-fire-pit` already relies on. The two above it are whatever rectangle
   * the placer gave them at whatever rotation, so they are drawn from their own outline.
   */
  'hot-tub',
  /* ---- planting ---- */
  'specimen',
  /*
   * Shrubs by kind, and the reason they are symbols rather than texture.
   *
   * A planting bed draws its infill as a painted scatter — mass, mid, edge — and that is right: a
   * border is specified as a quantity per square metre, not as two hundred placed objects. But the
   * *structure* of a bed is placed. A designer positions the trees and the key shrubs and lets the
   * infill fill in around them, and a plan where none of that can be moved is a picture rather than
   * a design.
   *
   * So `backdrop` and `specimen` — the two structural roles in `PlantingRole` — are lifted out of
   * the painted stack and become these. Everything else stays a texture.
   */
  'shrub-evergreen',
  'shrub-flowering',
  'shrub-architectural',
  /*
   * The clipped one, which is a different kind of thing from the three above it: they are shrubs
   * allowed to make their own shape, and this is one held in somebody else's. It is what makes a
   * formal or architectural border read as deliberate from above, and there was no way to say it.
   */
  'shrub-topiary',
  /*
   * Trees by kind.
   *
   * Every tree in every plan was one canopy — one deciduous sprite family, chosen by seed, so a
   * garden's trees differed only in which variant they landed on. A tree is the most conspicuous
   * thing on a plan and the one a client asks about by name, and "a tree" is not an answer.
   *
   * The symbol is what makes a *choice* possible. `tree-evergreen` in particular could not exist
   * until now: the conifer sprites have been in the library since Phase D and were deliberately
   * kept out of the canopy pool, because with nothing choosing, a garden would have landed on a
   * random mix of broadleaf and conifer — and a random mix is not a design.
   */
  'tree-deciduous',
  'tree-ornamental',
  'tree-evergreen',
  'tree-multistem',
  'tree-fruit',
]);
export type SymbolId = z.infer<typeof SymbolIdSchema>;

export type SymbolFootprint =
  { kind: 'rect'; width: number; depth: number } | { kind: 'point'; radius: number };

export interface SymbolSpec {
  category: ElementCategory;
  label: string;
  footprint: SymbolFootprint;
  /** Metres tall, for the shadow it casts. Resolved by `heightFor` ahead of the material. */
  height: number;
  /**
   * Metres across at maturity, where that differs from the footprint it is planted at.
   *
   * **Recorded, not drawn.** The footprint is the geometry of record — the placer erodes by it and
   * the validator tessellates it — and this is the number a schedule would use to say "this will be
   * eight metres across in twenty years". Drawing it as a dashed ring is a CAD convention that
   * would read as clutter on a garden plan, so nothing renders it today; storing it now is what
   * makes the warning possible later without revisiting every tree in every saved plan.
   */
  spread?: number;
}

export const SYMBOLS: Record<SymbolId, SymbolSpec> = {
  'dining-set-4': {
    category: 'furniture',
    label: 'Dining set for four',
    footprint: { kind: 'rect', width: 2.4, depth: 2.4 },
    height: 0.75,
  },
  'dining-set-6': {
    category: 'furniture',
    label: 'Dining set for six',
    footprint: { kind: 'rect', width: 3.2, depth: 2.4 },
    height: 0.75,
  },
  'sofa-set': {
    category: 'furniture',
    label: 'Lounge set',
    footprint: { kind: 'rect', width: 3, depth: 2.4 },
    height: 0.8,
  },
  lounger: {
    category: 'furniture',
    label: 'Sun lounger',
    footprint: { kind: 'rect', width: 0.7, depth: 1.9 },
    height: 0.4,
  },
  bbq: {
    category: 'furniture',
    label: 'Barbecue',
    footprint: { kind: 'rect', width: 1.4, depth: 0.7 },
    height: 0.9,
  },
  'fire-pit': {
    category: 'furniture',
    label: 'Fire pit bowl',
    footprint: { kind: 'point', radius: 0.6 },
    height: 0.4,
  },
  bench: {
    category: 'furniture',
    label: 'Bench',
    footprint: { kind: 'rect', width: 1.6, depth: 0.6 },
    height: 0.9,
  },
  parasol: {
    category: 'furniture',
    label: 'Parasol',
    footprint: { kind: 'point', radius: 1.35 },
    height: 2.4,
  },
  planter: {
    category: 'furniture',
    label: 'Planter',
    footprint: { kind: 'rect', width: 0.6, depth: 0.6 },
    height: 0.9,
  },
  swing: {
    category: 'furniture',
    label: 'Swing',
    footprint: { kind: 'rect', width: 3, depth: 2 },
    height: 2.2,
  },
  slide: {
    category: 'furniture',
    label: 'Slide',
    footprint: { kind: 'rect', width: 1.2, depth: 2.6 },
    height: 1.6,
  },
  trampoline: {
    category: 'furniture',
    label: 'Trampoline',
    footprint: { kind: 'point', radius: 1.5 },
    height: 0.9,
  },
  /*
   * A flight of steps, and the one symbol whose *drawing* depends on a field rather than only on
   * its footprint: the tread count comes from `elevation` through `stepFlight`, so a flight that
   * climbs 450 mm draws three treads and one that climbs 900 draws five. Nothing is stored — see
   * `plan/levels.ts` for why a stored count is a count that can disagree with its own rise.
   *
   * `height` is 0 because a flight does not stand up off the ground; it *is* the ground, on its way
   * somewhere else. What it casts comes from its elevation, like every other raised surface.
   */
  steps: {
    category: 'structure',
    label: 'Steps',
    footprint: { kind: 'rect', width: 1.5, depth: 1.2 },
    height: 0,
  },
  /*
   * The four fittings, and why `height` is the fitting rather than where it is mounted.
   *
   * `height` feeds `projectShadow` alone, so it has to be how tall the *object* is: a wall light
   * mounted at two metres is a 120 mm box on a wall, not a two-metre block, and giving it its
   * mounting height would have every downlight throw a shadow the size of a wheelie bin. Two of
   * the four therefore sit under `MIN_SHADOW_HEIGHT` (0.15) and cast nothing at all, which is
   * correct: a light recessed into a tread has no daytime presence to speak of.
   */
  'light-spike': {
    category: 'lighting',
    label: 'Spike uplight',
    footprint: { kind: 'point', radius: 0.06 },
    height: 0.3,
  },
  'light-bollard': {
    category: 'lighting',
    label: 'Bollard light',
    footprint: { kind: 'point', radius: 0.08 },
    height: 0.6,
  },
  'light-recessed': {
    category: 'lighting',
    label: 'Recessed light',
    footprint: { kind: 'point', radius: 0.04 },
    height: 0.02,
  },
  'light-wall': {
    category: 'lighting',
    label: 'Wall light',
    footprint: { kind: 'rect', width: 0.22, depth: 0.12 },
    height: 0.12,
  },
  pergola: {
    category: 'structure',
    label: 'Pergola',
    footprint: { kind: 'rect', width: 3.6, depth: 3.6 },
    height: 2.4,
  },
  shed: {
    category: 'structure',
    label: 'Shed',
    footprint: { kind: 'rect', width: 2.5, depth: 2 },
    height: 2.3,
  },
  gazebo: {
    category: 'structure',
    label: 'Gazebo',
    footprint: { kind: 'rect', width: 3, depth: 3 },
    height: 2.8,
  },
  'raised-bed': {
    category: 'structure',
    label: 'Raised bed',
    footprint: { kind: 'rect', width: 2, depth: 1 },
    height: 0.45,
  },
  'garden-room': {
    category: 'structure',
    label: 'Garden room',
    footprint: { kind: 'rect', width: 4, depth: 3 },
    height: 2.6,
  },
  greenhouse: {
    category: 'structure',
    label: 'Greenhouse',
    footprint: { kind: 'rect', width: 3, depth: 2.4 },
    height: 2.4,
  },
  /*
   * Height is the tub, not the deck it may be sunk into. `heightFor` feeds `projectShadow` and a
   * hot tub really is a waist-high box; a raised deck around one is the deck's own `elevation`.
   */
  'hot-tub': {
    category: 'structure',
    label: 'Hot tub',
    footprint: { kind: 'rect', width: 2.4, depth: 2.4 },
    height: 0.9,
  },
  specimen: {
    category: 'planting-bed',
    label: 'Specimen shrub',
    footprint: { kind: 'point', radius: 0.75 },
    height: 1.2,
  },
  /*
   * Shrubs, sized as the structural planting in a border: big enough to read as individual objects
   * on the plan, which is what separates them from the infill drawn around them.
   *
   * **Sized as the shrub is in five years, not as it arrives.** They were 1.2 to 1.4 m across, which
   * is a two-litre pot rather than a plant, and a back-of-border viburnum, hydrangea or philadelphus
   * is nearer two metres. Drawn at the smaller size they read as infill among the infill — the one
   * thing structural planting exists not to do — and a border of them still showed mulch between
   * every one. The plan drawing is of a garden that has grown, which is what the maturity control
   * says out loud everywhere else.
   */
  'shrub-evergreen': {
    category: 'planting-bed',
    label: 'Evergreen shrub',
    footprint: { kind: 'point', radius: 0.85 },
    height: 1.5,
    spread: 1.9,
  },
  'shrub-flowering': {
    category: 'planting-bed',
    label: 'Flowering shrub',
    footprint: { kind: 'point', radius: 0.95 },
    height: 1.7,
    spread: 2.1,
  },
  'shrub-architectural': {
    category: 'planting-bed',
    label: 'Architectural shrub',
    footprint: { kind: 'point', radius: 0.8 },
    height: 1.5,
    spread: 1.7,
  },
  /*
   * A clipped ball: box, yew or ilex, kept at the size it is bought at.
   *
   * Deliberately the one shrub that does **not** grow into the others' size, because a topiary is
   * defined by being held — that is the whole of what it contributes to a border, and it is why a
   * formal or architectural planting reads as deliberate from above where a mass of mounds does
   * not. Small enough to sit in front of the backdrop rather than in it.
   */
  'shrub-topiary': {
    category: 'planting-bed',
    label: 'Clipped ball',
    footprint: { kind: 'point', radius: 0.45 },
    height: 0.8,
    spread: 0.9,
  },
  /*
   * Radii are the canopy at the size a garden tree is *planted and kept*, not at forest maturity —
   * the placer erodes by exactly this and the validator tessellates the same circle, so a generous
   * number here is a tree the plan says fits when it does not.
   *
   * `spread` is the mature canopy, recorded and not drawn. A dashed mature-spread ring is a CAD
   * convention that would read as clutter on a garden plan; what this is for is a later schedule
   * saying "this will be four metres across in fifteen years", which is the honest way to warn
   * somebody about the tree they are about to plant a metre from the house.
   */
  'tree-deciduous': {
    category: 'planting-bed',
    label: 'Tree',
    footprint: { kind: 'point', radius: 2.5 },
    height: 7,
    spread: 8,
  },
  'tree-ornamental': {
    category: 'planting-bed',
    label: 'Ornamental tree',
    footprint: { kind: 'point', radius: 2 },
    height: 4.5,
    spread: 5,
  },
  'tree-evergreen': {
    category: 'planting-bed',
    label: 'Evergreen tree',
    footprint: { kind: 'point', radius: 1.6 },
    height: 6,
    spread: 4,
  },
  'tree-multistem': {
    category: 'planting-bed',
    label: 'Multi-stem tree',
    footprint: { kind: 'point', radius: 1.75 },
    height: 4,
    spread: 4.5,
  },
  'tree-fruit': {
    category: 'planting-bed',
    label: 'Fruit tree',
    footprint: { kind: 'point', radius: 1.5 },
    height: 3.5,
    spread: 4,
  },
};

/**
 * Every plant that is placed rather than painted.
 *
 * The membership test the renderer, the label rule and the shadow model all key on — a plant is the
 * one kind of feature that stands *on* another element rather than beside it, and each of those
 * three has to treat it differently because of that.
 */
export const PLANT_SYMBOLS: SymbolId[] = [
  'specimen',
  'shrub-evergreen',
  'shrub-flowering',
  'shrub-architectural',
  'shrub-topiary',
  'tree-deciduous',
  'tree-ornamental',
  'tree-evergreen',
  'tree-multistem',
  'tree-fruit',
];

export function isPlantSymbol(id: string | undefined): boolean {
  return id !== undefined && (PLANT_SYMBOLS as string[]).includes(id);
}

/** Every tree symbol, in the order a picker should offer them. */
export const TREE_SYMBOLS: SymbolId[] = [
  'tree-deciduous',
  'tree-ornamental',
  'tree-evergreen',
  'tree-multistem',
  'tree-fruit',
];

export function isTreeSymbol(id: SymbolId): boolean {
  return TREE_SYMBOLS.includes(id);
}

/**
 * Every light fitting, in the order a picker should offer them.
 *
 * Ordered by how a scheme is actually specified rather than by size: the uplights that do the
 * looking first, then the bollards that make a path walkable, then the two that are built into
 * something.
 */
export const LIGHT_SYMBOLS: SymbolId[] = [
  'light-spike',
  'light-bollard',
  'light-recessed',
  'light-wall',
];

export function isLightSymbol(id: string | undefined): boolean {
  return id !== undefined && (LIGHT_SYMBOLS as string[]).includes(id);
}

export const SYMBOL_IDS = SymbolIdSchema.options;

/** The symbol on an element, or `null` when it carries none or one this list no longer knows. */
export function resolveSymbol(element: { symbol?: string | undefined }): SymbolId | null {
  if (!element.symbol) return null;
  return SymbolIdSchema.safeParse(element.symbol).success ? (element.symbol as SymbolId) : null;
}

export function symbolLabel(id: SymbolId): string {
  return SYMBOLS[id].label;
}

/** The symbols a user may add from the editor, in the order the palette lists them. */
export const ADDABLE_SYMBOLS: SymbolId[] = [
  /*
   * Plants first, because they are what a user reaches for most and the palette had none at all —
   * a garden design tool in which you cannot place a tree.
   */
  'tree-deciduous',
  'tree-ornamental',
  'tree-evergreen',
  'tree-multistem',
  'tree-fruit',
  'shrub-evergreen',
  'shrub-flowering',
  'shrub-architectural',
  'shrub-topiary',
  'dining-set-4',
  'dining-set-6',
  'sofa-set',
  'lounger',
  'bench',
  'bbq',
  'fire-pit',
  'parasol',
  'planter',
  'swing',
  'slide',
  'trampoline',
  /* Lighting last: it is the layer a scheme is finished with, not started from. */
  'light-spike',
  'light-bollard',
  'light-recessed',
  'light-wall',
];
