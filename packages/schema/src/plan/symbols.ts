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
  /* ---- structures: drawn, not photographed ---- */
  'pergola',
  'shed',
  'gazebo',
  'raised-bed',
  /* ---- planting ---- */
  'specimen',
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
  specimen: {
    category: 'planting-bed',
    label: 'Specimen shrub',
    footprint: { kind: 'point', radius: 0.75 },
    height: 1.2,
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
];
