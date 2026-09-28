import type { DesignElement } from '../concepts.js';
import { heightFor } from '../heights.js';
import type { MaterialId } from '../materials.js';
import { resolveSymbol, SYMBOLS, type SymbolId } from '../symbols.js';
import { STRUCTURE_SIDES, type StructureConfig, type StructureSide } from './config.js';
import { isStructureFinish, type StructureFinishId } from './finishes.js';
import {
  GAZEBO_PRESETS,
  isFrameModel,
  PERGOLA_PRESETS,
  type FrameModel,
  type StructurePreset,
} from './presets.js';

/**
 * What a configurable structure is allowed to be, stated as data.
 *
 * One entry per symbol that opens in the 3D editor. The editor, the inspector's tabs, the resolver
 * and the parts builder all read what an entry *supports* rather than switching on what the
 * structure is called — so a shed, a garden room or a raised bed is a new entry here and a parts
 * builder in `parts.ts`, and nothing else in the app has to learn its name.
 *
 * `roof`, `sides` and `lighting` are optional because a capability a structure lacks is absent,
 * not empty: the inspector shows a tab only for what is present, and an empty tab is the fault this
 * codebase keeps catching — a control that looks available and does nothing.
 */
export interface StructureDefinition {
  symbol: SymbolId;
  label: string;
  /** Which parts builder draws it. Several symbols may share one. */
  builder: StructureBuilderId;
  /**
   * Complete starting configurations, applied whole (see `StructurePreset`). The first is the one a
   * structure with nothing stored resolves to, and its values equal `defaults` below.
   */
  presets: StructurePreset[];
  /**
   * Metres. Width and depth are limits on the element's own rect, which the 3D editor writes
   * through the same resize the 2D handles use; height is `element.height`.
   */
  dimensions: {
    width: { min: number; max: number };
    depth: { min: number; max: number };
    height: { min: number; max: number };
  };
  /** The frame finishes offered. The frame is the element's `material`. */
  frameMaterials: MaterialId[];
  roof?: {
    kinds: { id: RoofKind; label: string }[];
    /** Offered in addition to "same as the frame", which is the absent value. */
    finishes: StructureFinishId[];
  };
  sides?: { options: { id: SideInfill; label: string }[] };
  lighting?: boolean;
  defaults: {
    preset: string;
    roof: RoofKind;
    frame: MaterialId;
  };
}

export type StructureBuilderId = 'canopy';
export type RoofKind = 'open' | 'slatted' | 'solid' | 'hipped';
export type SideInfill = 'open' | 'slatted';

const SIDE_OPTIONS: { id: SideInfill; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'slatted', label: 'Slatted screen' },
];

/**
 * Every finish a frame may be in. The timber three are what the generator's `materialFor` has always
 * given a structure, so a generated pergola's frame is one the inspector can show as chosen.
 */
const FRAMES: MaterialId[] = [
  'hardwood',
  'softwood',
  'dark-stained-timber',
  'painted-timber',
  'aluminium-dark',
  'aluminium-light',
];

export const STRUCTURE_DEFINITIONS: Partial<Record<SymbolId, StructureDefinition>> = {
  pergola: {
    symbol: 'pergola',
    label: 'Pergola',
    builder: 'canopy',
    presets: PERGOLA_PRESETS,
    dimensions: {
      width: { min: 1.8, max: 6 },
      depth: { min: 1.8, max: 6 },
      height: { min: 2.1, max: 3.2 },
    },
    frameMaterials: FRAMES,
    roof: {
      kinds: [
        { id: 'slatted', label: 'Slatted' },
        { id: 'solid', label: 'Solid' },
        { id: 'open', label: 'Open frame' },
      ],
      finishes: ['aluminium-dark', 'aluminium-light', 'hardwood', 'polycarbonate-opal'],
    },
    sides: { options: SIDE_OPTIONS },
    lighting: true,
    defaults: { preset: 'classic', roof: 'slatted', frame: 'hardwood' },
  },
  gazebo: {
    symbol: 'gazebo',
    label: 'Gazebo',
    builder: 'canopy',
    presets: GAZEBO_PRESETS,
    dimensions: {
      width: { min: 2, max: 5 },
      depth: { min: 2, max: 5 },
      height: { min: 2.4, max: 3.6 },
    },
    frameMaterials: FRAMES,
    roof: {
      kinds: [
        { id: 'hipped', label: 'Hipped' },
        { id: 'solid', label: 'Flat' },
      ],
      finishes: ['aluminium-dark', 'aluminium-light', 'hardwood', 'polycarbonate-opal'],
    },
    sides: { options: SIDE_OPTIONS },
    lighting: true,
    defaults: { preset: 'classic', roof: 'hipped', frame: 'hardwood' },
  },
};

/**
 * The definition an element opens with in the 3D editor, or `null` when it does not.
 *
 * `null` is the answer for everything that is not a structure with a definition — a patio, a tree,
 * a dining set, a shed — and it is the one test the inspector's "Edit in 3D" button asks.
 */
export function structureDefinitionFor(element: DesignElement): StructureDefinition | null {
  if (element.category !== 'structure') return null;
  const symbol = resolveSymbol(element);
  return (symbol && STRUCTURE_DEFINITIONS[symbol]) ?? null;
}

/** A structure with every choice made: the stored config, checked, with the gaps filled. */
export interface ResolvedStructure {
  definition: StructureDefinition;
  preset: string;
  /**
   * The frame drawing. Stored as `structure.model`; a structure stored before that field existed
   * takes the model of the preset it names, so a pergola saved as `preset: 'modern'` still draws
   * modern.
   */
  model: FrameModel;
  roof: { kind: RoofKind; finish: StructureFinishId };
  sides: Record<StructureSide, SideInfill>;
  lighting: boolean;
  /** The element's `material` where it is a finish, else the definition's default frame. */
  frame: StructureFinishId;
  /** Read from the element's rect and `heightFor` — never stored here. */
  width: number;
  depth: number;
  height: number;
}

/**
 * Everything needed to build the structure, from the element alone.
 *
 * **Total, and it never throws.** Every stored value is checked against the definition and an
 * unknown one falls back to the default: a plan saved with a roof kind a later catalogue dropped
 * draws the default roof rather than refusing to load. An element stored before `structure` existed
 * has nothing here at all, and resolves to exactly the defaults — which for a pergola is the
 * slatted timber frame the plan has always drawn.
 *
 * Dimensions come from the geometry of record, so this is the one place the 3D model's size is
 * decided, and it is decided by the rect.
 */
export function resolveStructure(element: DesignElement): ResolvedStructure | null {
  const definition = structureDefinitionFor(element);
  if (!definition || element.shape.kind !== 'rect') return null;

  const config: StructureConfig = element.structure ?? {};
  const preset = definition.presets.some((option) => option.id === config.preset)
    ? config.preset!
    : definition.defaults.preset;

  const model: FrameModel = isFrameModel(config.model)
    ? config.model
    : (presetFor(definition, config.preset)?.model ?? 'classic');

  const frame: StructureFinishId = isStructureFinish(element.material)
    ? element.material
    : definition.defaults.frame as StructureFinishId;

  const kinds = definition.roof?.kinds.map((kind) => kind.id) ?? [];
  const roofKind = kinds.includes(config.roof?.kind as RoofKind)
    ? (config.roof!.kind as RoofKind)
    : definition.defaults.roof;
  const offeredFinishes: string[] = definition.roof?.finishes ?? [];
  const roofFinish =
    config.roof?.finish && offeredFinishes.includes(config.roof.finish) && isStructureFinish(config.roof.finish)
      ? config.roof.finish
      : frame;

  const sideIds = definition.sides?.options.map((option) => option.id) ?? [];
  const sides = Object.fromEntries(
    STRUCTURE_SIDES.map((side) => {
      const stored = config.sides?.[side] as SideInfill | undefined;
      return [side, stored && sideIds.includes(stored) ? stored : 'open'];
    }),
  ) as Record<StructureSide, SideInfill>;

  return {
    definition,
    preset,
    model,
    roof: { kind: roofKind, finish: roofFinish },
    sides,
    lighting: definition.lighting ? config.lighting === true : false,
    frame,
    width: element.shape.width,
    depth: element.shape.depth,
    height: heightFor(element),
  };
}

/** The natural height a new structure of this symbol is given. */
export function structureDefaultHeight(symbol: SymbolId): number {
  return SYMBOLS[symbol].height;
}

/** The preset with this id, or `null` when the definition has none by that name. */
export function presetFor(
  definition: StructureDefinition,
  id: string | undefined,
): StructurePreset | null {
  return definition.presets.find((preset) => preset.id === id) ?? null;
}

/** Clamp a height to what the structure may be. */
export function clampStructureHeight(definition: StructureDefinition, metres: number): number {
  const { min, max } = definition.dimensions.height;
  return Math.min(max, Math.max(min, metres));
}

/**
 * The element with every value of a preset written onto it: frame to `material`, height to
 * `height`, the rest to `structure`. The shape is never touched — a preset is a look, not a size.
 *
 * Returns the element unchanged when it has no definition or the preset is not one of its own, so
 * a caller never has to ask first.
 */
export function applyStructurePreset(element: DesignElement, presetId: string): DesignElement {
  const definition = structureDefinitionFor(element);
  const preset = definition && presetFor(definition, presetId);
  if (!definition || !preset) return element;

  return {
    ...element,
    material: preset.frame,
    height: clampStructureHeight(definition, preset.height),
    structure: {
      preset: preset.id,
      model: preset.model,
      roof: preset.roof.finish ? { kind: preset.roof.kind, finish: preset.roof.finish } : { kind: preset.roof.kind },
      sides: { ...preset.sides },
      lighting: preset.lighting,
    },
  };
}

/**
 * Whether the element still looks exactly like its preset, so the inspector can say "edited" when
 * it does not. Compared on resolved values, so an absent field and its stored default agree.
 */
export function presetMatches(element: DesignElement, preset: StructurePreset): boolean {
  const resolved = resolveStructure(element);
  if (!resolved) return false;
  const roofFinish = preset.roof.finish ?? preset.frame;
  return (
    resolved.model === preset.model &&
    resolved.frame === preset.frame &&
    resolved.roof.kind === preset.roof.kind &&
    resolved.roof.finish === roofFinish &&
    resolved.lighting === preset.lighting &&
    STRUCTURE_SIDES.every((side) => resolved.sides[side] === preset.sides[side]) &&
    Math.abs(resolved.height - clampStructureHeight(resolved.definition, preset.height)) < 0.005
  );
}
