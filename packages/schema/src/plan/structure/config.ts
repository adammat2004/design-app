import { z } from 'zod';

/**
 * How a configurable structure is built: the part of a pergola or gazebo that has no top-down home.
 *
 * ## What is deliberately not here
 *
 * **Nothing that says where the structure is or how much ground it takes.** Its width, depth,
 * position and rotation are the element's own `rect` — the geometry the validator measures, the
 * placer sampled and the editor's handles drag — and its height is the element's `height`, which
 * `heightFor` and the shadow model already read. Its frame material is the element's `material`, so
 * the schedule, the cost band, the 2D tone and the assistant's `material` intent all keep reading
 * one field. A second copy of any of them here would be a second answer to a question the document
 * already answers, and the two would drift the first time one editor forgot the other.
 *
 * So the 3D editor is a *view* of the same element: a width typed in it is a width written to the
 * rect, and what lives here is only what a plan cannot show — the roof, the side screens, the
 * lighting and which preset the frame is drawn in.
 *
 * ## Why every value is a plain string, and every field optional
 *
 * The rule `material`, `symbol` and `plantingStyle` already follow: a stored plan must never become
 * unparseable because a catalogue was edited. `resolveStructure` checks each value against the
 * structure's definition and falls back to the definition's default, which is also what an element
 * stored before this field existed resolves to — so there is no migration and no
 * `PLAN_DOCUMENT_VERSION` bump. Hand-built elements never go through `.parse()`, which is why the
 * defaults live in a resolver rather than in `.default()` (the reason `heightFor` and `scatterForm`
 * exist).
 *
 * ## Platform-independent by construction
 *
 * Plain JSON: ids and booleans, never a mesh, a material object or a scale. The web configurator,
 * the plan renderer and the AR scene builder all read this same record through
 * `resolveStructure` → `structureParts`, so there is one answer to what the pergola looks like.
 *
 * ## Which side is which
 *
 * Named in the rect's **local** frame, before its rotation: `rear` is the local −y face, `left` the
 * local −x face and `right` the local +x face. The local +y face is the front, and it is always the
 * open way in, so it has no setting. A stated convention rather than an inference, for the reason
 * `gardenRoomParts` states its own: the document records no direction a structure faces, and a
 * guess from the house would be a derived direction nothing downstream could check.
 */
export const StructureConfigSchema = z.object({
  /**
   * Which starting bundle this was made from — see `StructurePreset`. A record, not a fallback:
   * every value a preset sets is stored beside it, so editing the catalogue never moves a saved
   * structure.
   */
  preset: z.string().optional(),
  /**
   * The frame drawing, `classic` or `modern` — the model key every renderer draws from. Absent on
   * structures stored before it existed, which take their preset's model.
   */
  model: z.string().optional(),
  roof: z
    .object({
      /** `open`, `slatted`, `solid` or `hipped`, as the definition allows. */
      kind: z.string().optional(),
      /** A finish id from `STRUCTURE_FINISHES`. Absent means the same finish as the frame. */
      finish: z.string().optional(),
    })
    .optional(),
  sides: z
    .object({
      left: z.string().optional(),
      right: z.string().optional(),
      rear: z.string().optional(),
    })
    .optional(),
  /** A warm strip under the roof. Presentation of a real product, so it is on the document. */
  lighting: z.boolean().optional(),
  /**
   * What it stands on inside its own footprint: a paving or decking material id, laid under it and
   * moving and resizing with it. Absent means it stands on whatever the garden has there — what every
   * structure did before this existed, so a stored plan is unchanged.
   */
  floor: z.string().optional(),
  /**
   * How it is drawn in 3D: absent (or `auto`) lets a renderer use a library model wherever one
   * depicts exactly this configuration and fits its size; `procedural` always draws the parts; any
   * other value is a library model id, pinned — used while it still depicts this configuration and
   * fits, and the parts drawn otherwise. **Presentation only**: it never changes the rect, the
   * height, the plan symbol, the shadows or the schedule, and a stale value draws the parts rather
   * than refusing to load — the rule every field here follows. (See "Library models from Meshy".)
   */
  look: z.string().optional(),
});
export type StructureConfig = z.infer<typeof StructureConfigSchema>;

/** The three sides that can be screened, in the rect's local frame. The front is always open. */
export const STRUCTURE_SIDES = ['left', 'right', 'rear'] as const;
export type StructureSide = (typeof STRUCTURE_SIDES)[number];

/**
 * A change to a structure's configuration, merged one level deep.
 *
 * `roof` and `sides` merge key by key, so turning the left side into a screen leaves the right side
 * as it was. A key set to `undefined` is removed — which is how "same finish as the frame" is said:
 * it is the absent value, not a stored copy of the frame's finish that would go stale the moment the
 * frame changed.
 */
export interface StructureConfigPatch {
  preset?: string | undefined;
  model?: string | undefined;
  roof?: { kind?: string | undefined; finish?: string | undefined };
  sides?: Partial<Record<StructureSide, string | undefined>>;
  lighting?: boolean | undefined;
  floor?: string | undefined;
  look?: string | undefined;
}

export function mergeStructureConfig(
  current: StructureConfig | undefined,
  patch: StructureConfigPatch,
): StructureConfig {
  const merged: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch) as [keyof StructureConfigPatch, unknown][]) {
    if (key === 'roof' || key === 'sides') {
      const inner = compact({
        ...((current?.[key] as object | undefined) ?? {}),
        ...(value as object),
      });
      if (Object.keys(inner).length) merged[key] = inner;
      else delete merged[key];
    } else if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged as StructureConfig;
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
