import type { ModelLibrary, ModelLibraryEntry, Vec3 } from '@garden-studio/ar-contract';
import {
  specFromElement,
  type DesignElement,
  type ModelAssetSpec,
  type StyleDirection,
} from '@garden-studio/schema';

/**
 * Which library model, if any, draws this element — decided from the element every time it is
 * read, never stored. The 2D plan stays the geometry; a model is only ever a better drawing of what
 * the parts already say.
 *
 * ## The rule, in the order it is applied
 *
 * 1. **The user's choice.** `structure.look` of `procedural` draws the parts. Any other value pins
 *    a model id — used only while it still passes 2 and 3, and the parts are drawn otherwise. A pin
 *    is a preference, not a licence to draw something the plan does not say.
 * 2. **What it depicts must be what the plan says, exactly.** The symbol, and for a configurable
 *    structure every resolved hard fact — frame drawing, roof kind, roof covering, frame finish, each
 *    side, the light. A model's appearance is baked into its textures, so a dark-stained gazebo with
 *    shingles drawn for an aluminium one would be a picture of a different design. There is no
 *    "close enough" here and no fuzzy matching: the vocabulary is small and exact, and anything
 *    fuzzier would make the drawing depend on an opinion.
 * 3. **It must fit without visible stretch.** Each axis of the element (the rect's width and depth,
 *    `heightFor`) against the model's measured size must be within the entry's `fit.tolerance`,
 *    either way: `1 / (1 + t) ≤ element / model ≤ 1 + t`. At 0.15 a 3 m model draws a 2.61–3.45 m
 *    gazebo. A model that may be turned a quarter (`fit.turnable`) is tried with width and depth
 *    swapped where — and only where — it does not fit as it stands. The model is then drawn
 *    **scaled per axis to exactly the element's size**, so the 2D footprint and the 3D bounding box
 *    agree to the millimetre.
 * 4. **Among what passes**: the brief's style if a model has it, then the least stretch (the sum of
 *    `|ln ratio|` over the axes), then the lower id — a total order, so the same plan and the same
 *    library always draw the same model.
 *
 * Pure, synchronous and query-free, so the builder, the structure editor and (later) the phone all
 * ask it and get one answer.
 */

export interface LibraryMatch {
  entry: ModelLibraryEntry;
  /** Drawn a quarter turn round from the element's own frame. */
  turned: boolean;
  /** Width, height, depth to draw the model at, in its own frame (after the turn), in metres. */
  size: Vec3;
  /** `size / entry.naturalSize`, per axis: how much it is stretched (above 1) or squashed. */
  stretch: Vec3;
}

export type ProceduralReason =
  /** Nothing a model could stand in for: no symbol, or not a rectangle. */
  | 'not-modelled'
  /** The library is empty, or has not loaded. */
  | 'no-library'
  /** `structure.look` is `procedural`. */
  | 'chosen'
  /** No model depicts this symbol and configuration. */
  | 'no-model-depicts'
  /** Models depict it, but none fits its size. */
  | 'no-model-fits'
  /** The pinned id is not in the library. */
  | 'pin-missing'
  /** The pinned model depicts something else now (its frame or roof was changed after pinning). */
  | 'pin-depicts-other'
  /** The pinned model no longer fits the size. */
  | 'pin-does-not-fit';

export type LibraryOutcome =
  | { kind: 'model'; match: LibraryMatch; pinned: boolean }
  | { kind: 'procedural'; reason: ProceduralReason };

export interface MatchOptions {
  /** The brief's style: preferred among models that all fit, never required. */
  style?: StyleDirection | null;
}

/** The `structure.look` values that are not a model id. */
export const LOOK_AUTO = 'auto';
export const LOOK_PROCEDURAL = 'procedural';

export function matchLibraryAsset(
  element: DesignElement,
  library: ModelLibrary | null | undefined,
  options: MatchOptions = {},
): LibraryOutcome {
  const spec = specFromElement(element);
  if (!spec) return { kind: 'procedural', reason: 'not-modelled' };

  const look = element.structure?.look;
  if (look === LOOK_PROCEDURAL) return { kind: 'procedural', reason: 'chosen' };
  if (!library || library.entries.length === 0) return { kind: 'procedural', reason: 'no-library' };

  if (look && look !== LOOK_AUTO) {
    const entry = library.entries.find((candidate) => candidate.id === look);
    if (!entry) return { kind: 'procedural', reason: 'pin-missing' };
    if (!depicts(entry, spec)) return { kind: 'procedural', reason: 'pin-depicts-other' };
    const fitted = fits(entry, spec);
    if (!fitted) return { kind: 'procedural', reason: 'pin-does-not-fit' };
    return { kind: 'model', match: fitted, pinned: true };
  }

  const candidates = library.entries.filter((entry) => depicts(entry, spec));
  if (candidates.length === 0) return { kind: 'procedural', reason: 'no-model-depicts' };

  const fitting = candidates
    .map((entry) => fits(entry, spec))
    .filter((match): match is LibraryMatch => match !== null);
  if (fitting.length === 0) return { kind: 'procedural', reason: 'no-model-fits' };

  const style = options.style ?? null;
  fitting.sort(
    (a, b) =>
      styleRank(a, style) - styleRank(b, style) ||
      stretchOf(a) - stretchOf(b) ||
      a.entry.id.localeCompare(b.entry.id),
  );
  return { kind: 'model', match: fitting[0]!, pinned: false };
}

/** Exactly the plan's facts: the symbol, then the structure's hard fields or the material. */
function depicts(entry: ModelLibraryEntry, spec: ModelAssetSpec): boolean {
  const said = entry.depicts;
  if (said.symbol !== spec.symbol) return false;
  if (spec.structure) {
    const facts = said.structure;
    return (
      facts !== null &&
      facts.model === spec.structure.model &&
      facts.roofKind === spec.structure.roofKind &&
      facts.roofFinish === spec.structure.roofFinish &&
      facts.frame === spec.structure.frame &&
      facts.sides.left === spec.structure.sides.left &&
      facts.sides.right === spec.structure.sides.right &&
      facts.sides.rear === spec.structure.sides.rear &&
      facts.lighting === spec.structure.lighting
    );
  }
  return said.structure === null && said.material === spec.material;
}

/**
 * The model drawn in the element's own frame where that fits, and turned a quarter only where it does
 * not. Never turned for a smaller stretch: the published gazebo is 2.998 m by 3.000 m, so turning it
 * would win every comparison by a few hundredths of a per cent — and a turn changes which face of the
 * model looks out of the front, which is a visible decision made for an invisible gain.
 */
function fits(entry: ModelLibraryEntry, spec: ModelAssetSpec): LibraryMatch | null {
  const { width, depth, height } = spec.nominal;
  const straight = fitAt(entry, [width, height, depth], false);
  if (straight || !entry.fit.turnable) return straight;
  return fitAt(entry, [depth, height, width], true);
}

function fitAt(entry: ModelLibraryEntry, size: Vec3, turned: boolean): LibraryMatch | null {
  const most = 1 + entry.fit.tolerance;
  const stretch = size.map((value, axis) => value / entry.naturalSize[axis]!) as Vec3;
  // A hair of slack so a model drawn at exactly the band's edge is not refused by rounding.
  const inBand = stretch.every((ratio) => ratio <= most + 1e-9 && ratio >= 1 / most - 1e-9);
  return inBand ? { entry, turned, size, stretch } : null;
}

function stretchOf(match: LibraryMatch): number {
  return match.stretch.reduce((sum, ratio) => sum + Math.abs(Math.log(ratio)), 0);
}

function styleRank(match: LibraryMatch, style: StyleDirection | null): number {
  return style !== null && match.entry.depicts.style === style ? 0 : 1;
}
