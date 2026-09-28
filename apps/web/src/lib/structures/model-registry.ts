import {
  structureParts,
  type FrameModel,
  type ResolvedStructure,
  type StructureDefinition,
  type StructurePart,
  type StructurePartGroup,
} from '@garden-studio/schema';

/**
 * How each structure is *modelled* in 3D: the seam between the domain's parts and a model file.
 *
 * ## Today: procedural, and clearly a placeholder
 *
 * Every structure is drawn from `structureParts` — boxes and a pyramid sized from the element's own
 * rect — because there is no production model yet and hand-modelling one inside the app is not the
 * job. That is also the right answer for the frame whatever arrives later: a structure is whatever
 * rectangle the user gave it, so its posts and beams have to be generated from that rectangle.
 *
 * ## Later: a GLB that dresses the same parts
 *
 * A `gltf` definition names a file and, for each logical group, the node names in it that stand for
 * that group. The renderer then shows or hides nodes by the same groups the procedural model emits —
 * a slatted left side shows the nodes listed under `side-left`, a lit structure shows `light` — and
 * places them from the part boxes, so **dimensions still come from the rect** and never from the
 * model's natural size (there is no `scale` anywhere in the persisted configuration, for the reason
 * the AR contract has none). Replacing the placeholder means adding an entry here and a file under
 * `public/models/`; the editor, the inspector and the persisted configuration do not change.
 *
 * Nothing here is persisted. The document stores the configuration; which model draws it is the
 * renderer's business, exactly as the AR app's own model manifest is its business.
 */
export type ModelDefinition =
  | { kind: 'procedural'; build: (structure: ResolvedStructure) => StructurePart[] }
  | {
      kind: 'gltf';
      /** Under `public/`, e.g. `/models/pergola/modern.glb`. Not yet used by any definition. */
      url: string;
      /** For each logical group, the GLB node names that draw it. */
      nodes: Partial<Record<StructurePartGroup, string[]>>;
      /** Still built, for placement: each part's box is where its nodes go. */
      build: (structure: ResolvedStructure) => StructurePart[];
    };

const PROCEDURAL: ModelDefinition = { kind: 'procedural', build: structureParts };

/**
 * Per builder, per frame model — the platform-independent key the document stores as
 * `structure.model`, and the one the future AR app's manifest will key on too. Not per preset: a
 * preset is a bundle of starting choices, and several share one frame. Every entry is procedural
 * today; a production GLB for a model replaces its entry and nothing else.
 */
const MODELS: Record<StructureDefinition['builder'], Record<FrameModel, ModelDefinition>> = {
  canopy: {
    classic: PROCEDURAL,
    modern: PROCEDURAL,
  },
};

/** The model that draws a resolved structure. Falls back to the procedural placeholder. */
export function modelFor(structure: ResolvedStructure): ModelDefinition {
  return MODELS[structure.definition.builder]?.[structure.model] ?? PROCEDURAL;
}
