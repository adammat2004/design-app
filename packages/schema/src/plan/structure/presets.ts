import type { MaterialId } from '../materials.js';
import type { StructureSide } from './config.js';
import type { RoofKind, SideInfill } from './definitions.js';
import type { StructureFinishId } from './finishes.js';

/**
 * Which drawing of the frame a structure uses: the member sections, how the roof sits in the ring.
 *
 * This is the platform-independent **model key**. The plan's parts builder picks its section sizes
 * from it, the web configurator's model registry keys on it, and the future AR builder will too — so
 * a GLB that one day replaces the procedural frame is registered against a model, never against a
 * preset or a symbol. It is deliberately a separate thing from the preset: a preset is a bundle of
 * starting choices, and "the privacy pergola" and "the modern pergola" can share one frame.
 */
export type FrameModel = 'classic' | 'modern';

export const FRAME_MODELS: { id: FrameModel; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'modern', label: 'Modern' },
];

export function isFrameModel(value: string | undefined): value is FrameModel {
  return value === 'classic' || value === 'modern';
}

/**
 * A complete starting configuration for a structure: every choice the 3D editor offers, made.
 *
 * ## Applied on write, never read as a fallback
 *
 * Choosing a preset — in the editor, or by the generator — writes every one of these values onto the
 * element: the frame to `material`, the height to `height`, the rest to `structure`. Nothing reads a
 * preset to fill a gap in a stored element; `resolveStructure` fills gaps from the definition's own
 * defaults, as it always has. The difference matters: if a preset were a fallback, editing the
 * catalogue would silently change every saved pergola that named it, and `heightFor` — which the
 * shadows, the plan and the 3D model all read — would stop being the one answer to how tall it is.
 *
 * ## Never a size
 *
 * A preset says nothing about width or depth. Those are the rect's, placed by the generator or
 * dragged by the user, and applying a preset to a pergola that has been sized to its terrace must
 * not undo that.
 */
export interface StructurePreset {
  id: string;
  label: string;
  /** One sentence for the preset card. */
  description: string;
  model: FrameModel;
  /** The frame finish, written to the element's `material`. */
  frame: MaterialId & StructureFinishId;
  /** `finish` absent means the same as the frame. */
  roof: { kind: RoofKind; finish?: StructureFinishId };
  sides: Record<StructureSide, SideInfill>;
  lighting: boolean;
  /** Overall height in metres, written to `height`. */
  height: number;
}

const OPEN: Record<StructureSide, SideInfill> = { left: 'open', right: 'open', rear: 'open' };

/**
 * `classic` is exactly what the plan drew before presets carried anything — a slatted hardwood
 * frame, every side open, no light, at the symbol's natural 2.4 m — so a pergola the generator made
 * before this existed and one given the classic preset now are the same pergola.
 */
export const PERGOLA_PRESETS: StructurePreset[] = [
  {
    id: 'classic',
    label: 'Classic timber',
    description: 'Timber posts with rafters across the top. Open on every side.',
    model: 'classic',
    frame: 'hardwood',
    roof: { kind: 'slatted' },
    sides: OPEN,
    lighting: false,
    height: 2.4,
  },
  {
    id: 'modern',
    label: 'Modern aluminium',
    description: 'A slim dark aluminium frame with louvred blades and a warm light strip.',
    model: 'modern',
    frame: 'aluminium-dark',
    roof: { kind: 'slatted' },
    sides: OPEN,
    lighting: true,
    height: 2.7,
  },
  {
    id: 'screened',
    label: 'Privacy screen',
    description: 'A timber slatted roof and a slatted screen on two sides for shelter and privacy.',
    model: 'modern',
    frame: 'aluminium-dark',
    roof: { kind: 'slatted', finish: 'hardwood' },
    sides: { left: 'slatted', right: 'open', rear: 'slatted' },
    lighting: true,
    height: 2.7,
  },
  {
    id: 'covered',
    label: 'Covered',
    description:
      'A timber frame with a translucent roof, so the table stays dry. Lit for evenings.',
    model: 'classic',
    frame: 'hardwood',
    roof: { kind: 'solid', finish: 'polycarbonate-opal' },
    sides: OPEN,
    lighting: true,
    height: 2.6,
  },
];

/** `classic` is the hipped timber gazebo, at the symbol's natural 2.8 m. */
export const GAZEBO_PRESETS: StructurePreset[] = [
  {
    id: 'classic',
    label: 'Classic timber',
    description: 'A hipped timber roof on four posts. Open on every side.',
    model: 'classic',
    frame: 'hardwood',
    roof: { kind: 'hipped' },
    sides: OPEN,
    lighting: false,
    height: 2.8,
  },
  {
    id: 'modern',
    label: 'Modern pavilion',
    description:
      'A flat-roofed dark aluminium pavilion with a slatted back and a warm light strip.',
    model: 'modern',
    frame: 'aluminium-dark',
    roof: { kind: 'solid' },
    sides: { left: 'open', right: 'open', rear: 'slatted' },
    lighting: true,
    height: 2.7,
  },
];
