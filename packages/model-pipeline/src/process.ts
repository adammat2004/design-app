import sharp from 'sharp';
import { createIO, sha256 } from './io.js';
import { inspect, type Inspection } from './inspect.js';
import { normalise, type NormaliseOptions, type NormaliseResult } from './normalise.js';
import { optimise, type OptimiseResult } from './optimise.js';
import { validateGlb, type Validation } from './validate.js';

/**
 * A generated GLB in, a library model out — or a list of reasons it is not one.
 *
 * `validate → normalise → optimise → validate → check budgets`. **A defect refuses; a warning is
 * recorded**, the split Asset Library v2 already makes: a defect is something no reviewer should
 * be asked to approve (a malformed file, a model over budget, timber that will render as metal); a
 * warning is something a reviewer should look at (a height well off what was asked for, a large
 * file that still fits). The caller publishes only when `defects` is empty.
 */

export interface Budgets {
  /** 15,000 for a hero object such as a structure, 5,000 for furniture (the AR architecture). */
  triangles: number;
  maxTexturePx: number;
  /** The whole file. 3 MB is what a phone can fetch on a garden's mobile signal without a wait. */
  bytes: number;
}

export const STRUCTURE_BUDGETS: Budgets = {
  triangles: 15_000,
  maxTexturePx: 1024,
  bytes: 3 * 1024 * 1024,
};

export const FURNITURE_BUDGETS: Budgets = {
  triangles: 5_000,
  maxTexturePx: 1024,
  bytes: 1.5 * 1024 * 1024,
};

export interface ProcessOptions extends NormaliseOptions {
  budgets: Budgets;
  /** How far the normalised height may sit from `nominal.height` before a warning. */
  heightTolerance?: number;
}

export interface ProcessReport {
  input: Inspection;
  output: Inspection;
  inputValidation: Validation;
  outputValidation: Validation;
  normalised: NormaliseResult;
  optimised: OptimiseResult;
  bytes: number;
  sha256: string;
  defects: string[];
  warnings: string[];
}

export interface ProcessResult {
  bytes: Uint8Array;
  report: ProcessReport;
}

/** Raised when the input cannot be read as a glTF at all — before there is anything to report on. */
export class MalformedModelError extends Error {
  constructor(
    message: string,
    readonly validation: Validation | null,
  ) {
    super(message);
    this.name = 'MalformedModelError';
  }
}

export async function processModel(
  input: Uint8Array,
  options: ProcessOptions,
): Promise<ProcessResult> {
  let inputValidation: Validation;
  try {
    inputValidation = await validateGlb(input);
  } catch (error) {
    // The validator rejects outright, rather than reporting, on bytes that are not a glTF at all.
    throw new MalformedModelError(`The model is not a glTF: ${(error as Error).message}`, null);
  }
  if (inputValidation.errors > 0) {
    throw new MalformedModelError(
      `The model fails the glTF validator with ${inputValidation.errors} error(s): ` +
        inputValidation.messages.join('; '),
      inputValidation,
    );
  }

  const io = await createIO();
  let document;
  try {
    document = await io.readBinary(input);
  } catch (error) {
    throw new MalformedModelError(`The model cannot be read: ${(error as Error).message}`, null);
  }

  const before = inspect(document);
  const normalised = await normalise(document, options);
  const optimised = await optimise(document, {
    triangleBudget: options.budgets.triangles,
    maxTexturePx: options.budgets.maxTexturePx,
  });
  const bytes = await io.writeBinary(document);
  const output = inspect(await io.readBinary(bytes));
  const outputValidation = await validateGlb(bytes);

  const { defects, warnings } = judge({
    output,
    outputValidation,
    normalised,
    bytes: bytes.byteLength,
    budgets: options.budgets,
    heightTolerance: options.heightTolerance ?? 0.25,
    before,
  });

  return {
    bytes,
    report: {
      input: before,
      output,
      inputValidation,
      outputValidation,
      normalised,
      optimised,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      defects,
      warnings,
    },
  };
}

function judge(input: {
  output: Inspection;
  outputValidation: Validation;
  normalised: NormaliseResult;
  bytes: number;
  budgets: Budgets;
  heightTolerance: number;
  before: Inspection;
}): { defects: string[]; warnings: string[] } {
  const { output, budgets } = input;
  const defects: string[] = [];
  const warnings: string[] = [];

  if (input.outputValidation.errors > 0) {
    defects.push(
      `the processed file fails the glTF validator: ${input.outputValidation.messages.join('; ')}`,
    );
  }
  if (output.counts.triangles > budgets.triangles) {
    defects.push(`${output.counts.triangles} triangles, over the budget of ${budgets.triangles}`);
  }
  if (output.maxTexturePx > budgets.maxTexturePx) {
    defects.push(`a ${output.maxTexturePx} px texture, over ${budgets.maxTexturePx} px`);
  }
  if (input.bytes > budgets.bytes) {
    defects.push(`${mb(input.bytes)}, over the ${mb(budgets.bytes)} budget`);
  }
  if (output.counts.animations > 0 || output.counts.skins > 0) {
    defects.push('it still carries animation or a skin');
  }
  for (const material of output.materials) {
    if (material.metallicFactor > 0.5 && !material.hasMetallicRoughnessTexture) {
      defects.push(
        `material "${material.name}" is metallic (${material.metallicFactor}) with no map to say ` +
          'where — it will render as polished metal',
      );
    }
  }
  if (input.before.counts.textures > 0 && !output.materials.some((m) => m.hasBaseColorTexture)) {
    defects.push('the textures were lost: nothing has a base colour map');
  }

  const ratio = input.normalised.heightRatio;
  if (Math.abs(input.normalised.heightStretch - 1) > 1e-6) {
    warnings.push(
      `stretched upright ×${input.normalised.heightStretch.toFixed(2)} to the height asked for, ` +
        'as the reviewer chose',
    );
  }
  if (Math.abs(ratio - 1) > input.heightTolerance) {
    warnings.push(
      `it stands ${input.normalised.naturalSize[1].toFixed(2)} m tall, ` +
        `${Math.round((ratio - 1) * 100)}% off the height asked for`,
    );
  }
  if (input.bytes > budgets.bytes * 0.8) {
    warnings.push(`${mb(input.bytes)} is close to the ${mb(budgets.bytes)} budget`);
  }
  if (input.outputValidation.warnings > 0) {
    warnings.push(`glTF validator warnings: ${input.outputValidation.messages.join('; ')}`);
  }
  return { defects, warnings };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/** A small WebP for a chooser, from any image sharp can read. */
export async function thumbnail(image: Uint8Array, px = 256): Promise<Uint8Array> {
  return sharp(image)
    .resize(px, px, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .webp({ quality: 82 })
    .toBuffer();
}

/** A picture kept for provenance — a model's reference — as a WebP no larger than `maxPx` a side. */
export async function webp(image: Uint8Array, maxPx = 768): Promise<Uint8Array> {
  return sharp(image).resize(maxPx, maxPx, { fit: 'inside' }).webp({ quality: 82 }).toBuffer();
}
