import { createRequire } from 'node:module';

/**
 * The Khronos glTF validator, run on the bytes.
 *
 * It is the reference implementation of the specification, so "the validator reports errors" is a
 * statement about the file rather than about our reader: a model that fails it is refused whatever
 * three.js might manage to draw from it, because the phone's renderer is not three.js.
 *
 * Loaded through `createRequire` because it is Dart compiled to JavaScript, shipped as CommonJS with
 * no type declarations; the one function used is typed here.
 */

interface ValidatorMessage {
  code: string;
  message: string;
  severity: number;
  pointer?: string;
}

interface ValidatorReport {
  issues: {
    numErrors: number;
    numWarnings: number;
    numInfos: number;
    numHints: number;
    messages: ValidatorMessage[];
  };
}

interface Validator {
  validateBytes(data: Uint8Array, options?: { maxIssues?: number }): Promise<ValidatorReport>;
}

const validator = createRequire(import.meta.url)('gltf-validator') as Validator;

export interface Validation {
  errors: number;
  warnings: number;
  /** The first few errors and warnings, as `CODE: message`. */
  messages: string[];
}

/** Severity 0 is an error and 1 a warning; infos and hints are not reported. */
export async function validateGlb(bytes: Uint8Array): Promise<Validation> {
  const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 100 });
  return {
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    messages: report.issues.messages
      .filter((message) => message.severity <= 1)
      .slice(0, 10)
      .map((message) => `${message.code}: ${message.message}`),
  };
}
