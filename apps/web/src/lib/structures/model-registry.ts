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
 * ## Procedural, and that is the production answer for the frame
 *
 * Every structure is drawn from `structureParts`, sized from the element's own rect, and dressed by
 * `partGeometry`: eased edges, cut rafter tails, aerofoil louvres, a post shoe, and texture
 * coordinates in metres for the material library. **There are to be no frame GLBs** (decided 30 Sep
 * 2026). A structure is whatever rectangle the user gave it, so a model would have to be stretched
 * into each part box — which brings back exactly the texture stretch metre UVs removed — and the
 * detail that reads as real is exact when drawn in code. The AR builder takes the same parts.
 *
 * ## `gltf`: fixed-size attachments only
 *
 * The `gltf` shape is kept for things that are a product of one size rather than a length cut to
 * fit: a bracket, a light fitting, a post cap. A definition names a file and, for each logical group,
 * the node names that draw it; nodes are placed from the part boxes and never scaled to the model's
 * natural size (there is no `scale` anywhere in the persisted configuration, for the reason the AR
 * contract has none). Nothing uses it yet.
 *
 * Nothing here is persisted. The document stores the configuration; which model draws it is the
 * renderer's business, exactly as the AR app's own model manifest is its business.
 */
export type ModelDefinition =
  | { kind: 'procedural'; build: (structure: ResolvedStructure) => StructurePart[] }
  | {
      kind: 'gltf';
      /** Under `public/models/`. Fixed-size attachments only; nothing uses it yet. */
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
