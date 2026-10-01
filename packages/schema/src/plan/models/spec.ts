import { z } from 'zod';
import { StyleDirectionSchema, type StyleDirection } from '../brief.js';
import type { DesignElement } from '../concepts.js';
import { heightFor } from '../heights.js';
import { SYMBOLS, SymbolIdSchema, type SymbolId } from '../symbols.js';
import { STRUCTURE_SIDES } from '../structure/config.js';
import {
  applyStructurePreset,
  resolveStructure,
  STRUCTURE_DEFINITIONS,
  type ResolvedStructure,
  type RoofKind,
} from '../structure/definitions.js';
import {
  isStructureFinish,
  structureFinish,
  type StructureFinishId,
} from '../structure/finishes.js';

/**
 * What a library model depicts, said in the plan's own vocabulary — the request a model is generated
 * from, and the facts a published model is matched on.
 *
 * ## Why not a prompt
 *
 * Nothing that asks for a model — the design agent, the admin page, a script — writes free text to
 * an image or 3D model. It states a symbol and the structure's resolved configuration, and
 * `composeReferencePrompt` turns that into words, once, from one versioned template. That is the rule
 * `DesignIntent` and `composePrompt` already follow: a request that can only be expressed in the
 * vocabulary cannot ask for anything the plan cannot describe, and two requests for the same thing
 * are the same request byte for byte, which is what lets a duplicate be recognised.
 *
 * ## Why the resolved configuration, not the stored one
 *
 * A gazebo with nothing stored and a gazebo with `preset: 'classic'` written out are the same
 * gazebo; `resolveStructure` is what says so. Matching on what is *stored* would call them
 * different and generate twice. Every hard field is the resolved one.
 *
 * ## What a model does not decide
 *
 * `nominal` is the size the model is normalised to when it is published — what "1 metre" means in
 * its file. It is not where anything goes or how big an element is: the element's `rect` and
 * `height` stay the geometry of record, and a renderer fits the model to them.
 */

/**
 * Bump when the reference template's **meaning** changes — the camera, the light, the framing —
 * never for a reworded subject. A spec's canonical form carries it, so a model generated under an
 * older template is a different request from the same spec asked today.
 */
export const MODEL_SPEC_VERSION = '1.0';

/** A configurable structure's hard facts: every field a baked-in model cannot change at run time. */
export const ModelStructureFactsSchema = z.object({
  /** `classic` or `modern`: the frame drawing. */
  model: z.string(),
  roofKind: z.string(),
  /** A `StructureFinishId`; equal to `frame` when the roof is covered in the frame's own finish. */
  roofFinish: z.string(),
  /** A `StructureFinishId` — the element's `material`. */
  frame: z.string(),
  sides: z.object({ left: z.string(), right: z.string(), rear: z.string() }),
  lighting: z.boolean(),
});
export type ModelStructureFacts = z.infer<typeof ModelStructureFactsSchema>;

const Metres = z.number().positive().max(20);

export const ModelAssetSpecSchema = z.object({
  symbol: SymbolIdSchema,
  /** For a configurable structure (`STRUCTURE_DEFINITIONS`); `null` for anything else. */
  structure: ModelStructureFactsSchema.nullable(),
  /** The element's material, for something that is not a configurable structure (a shed, a bench). */
  material: z.string().nullable(),
  /** Flavour only, never a hard match: a modern brief may still take a classic gazebo. */
  style: StyleDirectionSchema.nullable(),
  /** Width, depth and height in metres of what the model is normalised to. */
  nominal: z.object({ width: Metres, depth: Metres, height: Metres }),
  /** Typed by a person at the admin page, appended to the subject. Never written by a model. */
  notes: z.string().max(200).default(''),
});
export type ModelAssetSpec = z.infer<typeof ModelAssetSpecSchema>;

/** The hard facts of a resolved structure. */
export function structureFacts(resolved: ResolvedStructure): ModelStructureFacts {
  return {
    model: resolved.model,
    roofKind: resolved.roof.kind,
    roofFinish: resolved.roof.finish,
    frame: resolved.frame,
    sides: { left: resolved.sides.left, right: resolved.sides.right, rear: resolved.sides.rear },
    lighting: resolved.lighting,
  };
}

/**
 * The spec an element would be drawn by: its symbol, its resolved configuration and its own size.
 * `null` for anything with no symbol or no rectangle — there is nothing a model could stand in for.
 */
export function specFromElement(
  element: DesignElement,
  style: StyleDirection | null = null,
): ModelAssetSpec | null {
  const symbol = SymbolIdSchema.safeParse(element.symbol);
  if (!symbol.success || element.shape.kind !== 'rect') return null;

  const resolved = resolveStructure(element);
  return {
    symbol: symbol.data,
    structure: resolved ? structureFacts(resolved) : null,
    material: resolved ? null : (element.material ?? null),
    style,
    nominal: {
      width: element.shape.width,
      depth: element.shape.depth,
      height: heightFor(element),
    },
    notes: '',
  };
}

export interface PresetSpecOptions {
  /** A frame finish the structure offers; defaults to the preset's. */
  frame?: StructureFinishId;
  /** A roof covering the structure offers; defaults to the preset's, which is often the frame's. */
  roofFinish?: StructureFinishId;
  roofKind?: RoofKind;
  style?: StyleDirection | null;
  /** Defaults to the symbol's natural footprint and the preset's height. */
  nominal?: { width: number; depth: number; height: number };
  notes?: string;
}

/**
 * The spec for a preset, as a structure placed with it would resolve — for asking for a model before
 * any plan has one. Built by placing a structure and resolving it, so it cannot disagree with what
 * `specFromElement` says about a real one. Throws on a choice the structure does not offer: an
 * admin typo must not buy a model of something no plan can ever ask for.
 */
export function specForPreset(
  symbol: SymbolId,
  presetId: string,
  options: PresetSpecOptions = {},
): ModelAssetSpec {
  const definition = STRUCTURE_DEFINITIONS[symbol];
  if (!definition) throw new Error(`${symbol} is not a configurable structure`);
  if (!definition.presets.some((preset) => preset.id === presetId)) {
    throw new Error(`${symbol} has no preset "${presetId}"`);
  }
  if (options.frame && !(definition.frameMaterials as string[]).includes(options.frame)) {
    throw new Error(`${symbol} is not offered with a ${options.frame} frame`);
  }
  if (options.roofFinish && !definition.roof?.finishes.includes(options.roofFinish)) {
    throw new Error(`${symbol} is not offered with a ${options.roofFinish} roof`);
  }
  if (options.roofKind && !definition.roof?.kinds.some((kind) => kind.id === options.roofKind)) {
    throw new Error(`${symbol} is not offered with a ${options.roofKind} roof`);
  }

  const footprint = SYMBOLS[symbol].footprint;
  if (footprint.kind !== 'rect') throw new Error(`${symbol} has no rectangular footprint`);

  let element: DesignElement = applyStructurePreset(
    {
      id: 'spec',
      category: 'structure',
      role: 'feature',
      symbol,
      zone: 'back',
      shape: {
        kind: 'rect',
        centre: { x: 0, y: 0 },
        width: options.nominal?.width ?? footprint.width,
        depth: options.nominal?.depth ?? footprint.depth,
        rotation: 0,
      },
    },
    presetId,
  );
  if (options.frame) element = { ...element, material: options.frame };
  if (options.roofFinish || options.roofKind) {
    element = {
      ...element,
      structure: {
        ...element.structure,
        roof: {
          kind: options.roofKind ?? element.structure?.roof?.kind,
          finish: options.roofFinish ?? element.structure?.roof?.finish,
        },
      },
    };
  }
  if (options.nominal) element = { ...element, height: options.nominal.height };

  const spec = specFromElement(element, options.style ?? null)!;
  return { ...spec, notes: options.notes ?? '' };
}

/**
 * The spec as one stable string: keys sorted, lengths to the millimetre, prefixed with the spec
 * version. Two specs that mean the same thing give the same string whatever order their fields were
 * built in, and a caller hashes this — with `node:crypto` on the server — to recognise a duplicate.
 * No hashing here, because this package also runs in the browser.
 */
export function canonicalSpec(spec: ModelAssetSpec): string {
  const parsed = ModelAssetSpecSchema.parse(spec);
  return `model-spec/${MODEL_SPEC_VERSION}:${stableJson(parsed)}`;
}

function stableJson(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/* ---------------------------------------------------------------- the reference image */

/**
 * The one picture image-to-3D is given, as a template round the subject.
 *
 * Every clause is there for the reconstruction rather than for a person looking at it — Phase 0
 * measured what came back from exactly this (CLAUDE.md, "Library models from Meshy"):
 *
 * - **one object, whole, on white**: image-to-3D reconstructs everything in the frame, so a lawn
 *   behind a gazebo becomes part of its mesh;
 * - **three-quarter view from a little above**: the one view that shows a front, a side and the
 *   roof, which is most of what one image can say about the back;
 * - **soft even light, no cast shadow**: a baked shadow becomes texture on the model;
 * - **nothing inside or around it**: a table under the roof would be fused to the floor;
 * - **never a diptych**: the lesson `brief-art.ts` paid for.
 */
const REFERENCE_TEMPLATE = {
  opening:
    'A product photograph of a single garden {subject}, three-quarter view from the front-left ' +
    'and about thirty degrees above, the entire object in frame with a small margin all round, ' +
    'isolated on a plain pure white seamless background.',
  closing:
    'Soft, even, overcast studio light from all sides, no hard shadows, no cast shadow on the ' +
    'background. No ground, no grass, no plants, no people, and nothing standing inside or around ' +
    'it. No text, no watermark. Photorealistic, sharp, true colours. A single object in one image ' +
    '— never a diptych, a split view or a grid of variations.',
} as const;

const ROOF_WORDS: Record<string, string> = {
  hipped: 'a hipped roof with four sloping planes meeting at a single point, with a small finial',
  solid: 'a flat solid roof with a slim fascia',
  slatted: 'a roof of evenly spaced parallel slats',
  open: 'an open roof frame of beams with no covering',
};

const MODEL_WORDS: Record<string, string> = {
  classic: 'a traditional post-and-beam frame of square posts with a diagonal brace at each corner',
  modern: 'a slim minimal frame of crisp square sections with no braces or ornament',
};

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
/** A finish in words: its own label where it is a finish, else the id spelt out. */
const finishWords = (id: string) =>
  isStructureFinish(id) ? lower(structureFinish(id).label) : id.replace(/-/g, ' ');

/** The subject: what the thing is, in words built only from the spec. */
export function referenceSubject(spec: ModelAssetSpec): string {
  const { width, depth, height } = spec.nominal;
  const label = lower(SYMBOLS[spec.symbol].label);
  const size =
    `about ${round1(width)} metres by ${round1(depth)} metres on plan and ` +
    `${round1(height)} metres to the top`;
  const clauses: string[] = [];

  if (spec.structure) {
    const facts = spec.structure;
    clauses.push(`A ${label}, ${size}`);
    if (MODEL_WORDS[facts.model]) clauses.push(`${MODEL_WORDS[facts.model]}`);
    clauses.push(`frame in ${finishWords(facts.frame)}`);
    const roof = ROOF_WORDS[facts.roofKind] ?? `a ${facts.roofKind} roof`;
    clauses.push(
      facts.roofFinish === facts.frame
        ? `${roof}, finished in the same ${finishWords(facts.frame)} as the frame`
        : `${roof}, covered in ${finishWords(facts.roofFinish)}`,
    );
    const screened = STRUCTURE_SIDES.filter((side) => facts.sides[side] === 'slatted');
    clauses.push(
      screened.length === 0
        ? 'open on all four sides, with no screens, curtains or floor deck'
        : `a slatted screen filling the ${screened.join(' and ')} side${screened.length > 1 ? 's' : ''}, the other sides open, no floor deck`,
    );
    if (facts.lighting) clauses.push('a slim LED strip under the roof edge, switched off');
  } else {
    clauses.push(`A ${label}, ${size}`);
    if (spec.material) clauses.push(`made of ${spec.material.replace(/-/g, ' ')}`);
  }

  if (spec.notes.trim()) clauses.push(spec.notes.trim());
  return `${clauses.join('; ')}.`;
}

/** The full prompt for the reference image. The only place the template and a subject meet. */
export function composeReferencePrompt(spec: ModelAssetSpec): string {
  const label = lower(SYMBOLS[spec.symbol].label);
  return [
    REFERENCE_TEMPLATE.opening.replace('{subject}', label),
    referenceSubject(spec),
    REFERENCE_TEMPLATE.closing,
  ].join(' ');
}

const round1 = (value: number) => String(Math.round(value * 10) / 10);
