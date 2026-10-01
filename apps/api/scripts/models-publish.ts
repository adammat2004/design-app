import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ModelLibraryEntrySchema, type ModelLibraryEntry } from '@garden-studio/ar-contract';
import { processModel, STRUCTURE_BUDGETS } from '@garden-studio/model-pipeline';
import {
  canonicalSpec,
  MODEL_SPEC_VERSION,
  specForPreset,
  SymbolIdSchema,
  type PresetSpecOptions,
  type RoofKind,
  type StructureFinishId,
} from '@garden-studio/schema';
import { auditLibrary, publishToLibrary } from '../src/model-assets/model-library.writer';

/**
 * Publish a downloaded Meshy result into the model library — Phase 1, before there is a database.
 *
 *     pnpm --filter @garden-studio/api models:publish \
 *       --from storage/models/spike/gazebo-meshy-7.1 --id gazebo-classic-dark-stained-3x3 \
 *       --symbol gazebo --preset classic --frame dark-stained-timber --roof-finish shingle-dark \
 *       [--size 3x3x2.8] [--front-yaw 0] [--fit-height] [--turnable] [--tolerance 0.15] [--family <id>]
 *       [--dry-run] [--replace]
 *
 *     pnpm --filter @garden-studio/api models:publish --audit
 *
 * `--from` is a folder `spike:meshy` wrote: `model.glb`, `task.json`, `request.json`,
 * `reference.png` and Meshy's `thumb.png`. The model goes through `processModel` (validate,
 * normalise to metres / +Y up / base-centre / front +Z at the spec's size, simplify and shrink to
 * the structure budgets, meshopt) and is **refused if anything is a defect** — the report is written
 * beside the input either way, so a refusal can be read.
 *
 * What it writes, all under `apps/web/public/models/` and all for a person to review and commit:
 *
 * - `library/<id>.glb`, `library/<id>.webp` (Meshy's own three-quarter render, as a thumbnail);
 * - `references/<id>.webp`, the picture it was generated from, for provenance;
 * - an entry in `library/library.json`, sorted by id.
 *
 * **An id is immutable once published**: the builder chooses a model against the measurements in
 * the library, and a phone holding an older copy must never draw a different file under the same
 * name. `--replace` exists for the moment before anything has consumed an entry, and says so.
 *
 * `--audit` re-reads every published file and exits non-zero if one is missing, has drifted from its
 * recorded sha256, fails the glTF validator, is over budget, or is not in the library at all.
 */

const API = resolve(__dirname, '..');
/** The web app's `public/`: the library is `models/library/` and its references `models/references/`. */
const PATHS = { publicDir: resolve(API, '..', 'web', 'public') };
const LIBRARY_FILE = join(PATHS.publicDir, 'models', 'library', 'library.json');

interface Options {
  audit: boolean;
  from: string | null;
  id: string | null;
  symbol: string | null;
  preset: string | null;
  spec: PresetSpecOptions;
  frontYawDeg: number;
  turnable: boolean;
  fitHeight: boolean;
  tolerance: number;
  family: string | null;
  dryRun: boolean;
  replace: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    audit: false,
    from: null,
    id: null,
    symbol: null,
    preset: null,
    spec: {},
    frontYawDeg: 0,
    turnable: false,
    fitHeight: false,
    tolerance: 0.15,
    family: null,
    dryRun: false,
    replace: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--audit') options.audit = true;
    else if (arg === '--from') options.from = next();
    else if (arg === '--id') options.id = next();
    else if (arg === '--symbol') options.symbol = next();
    else if (arg === '--preset') options.preset = next();
    else if (arg === '--frame') options.spec.frame = next() as StructureFinishId;
    else if (arg === '--roof-finish') options.spec.roofFinish = next() as StructureFinishId;
    else if (arg === '--roof-kind') options.spec.roofKind = next() as RoofKind;
    else if (arg === '--size') {
      const [width, depth, height] = next().split('x').map(Number);
      if (![width, depth, height].every((value) => value !== undefined && value > 0)) {
        throw new Error('--size is WIDTHxDEPTHxHEIGHT in metres, e.g. 3x3x2.8');
      }
      options.spec.nominal = { width: width!, depth: depth!, height: height! };
    } else if (arg === '--front-yaw') options.frontYawDeg = Number(next());
    else if (arg === '--turnable') options.turnable = true;
    else if (arg === '--fit-height') options.fitHeight = true;
    else if (arg === '--tolerance') options.tolerance = Number(next());
    else if (arg === '--family') options.family = next();
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--replace') options.replace = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return options;
}

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/* ---------------------------------------------------------------- publish */

async function publish(options: Options): Promise<void> {
  if (!options.from || !options.id || !options.symbol || !options.preset) {
    throw new Error('--from, --id, --symbol and --preset are required');
  }
  const from = resolve(API, options.from);
  const id = options.id;
  if (!ModelLibraryEntrySchema.shape.id.safeParse(id).success) {
    throw new Error(`"${id}" is not a library id: lower-case words joined by hyphens`);
  }

  const spec = specForPreset(SymbolIdSchema.parse(options.symbol), options.preset, options.spec);
  const specHash = sha(canonicalSpec(spec));

  const raw = readFileSync(join(from, 'model.glb'));
  const task = JSON.parse(readFileSync(join(from, 'task.json'), 'utf8')) as {
    id: string;
    type?: string;
    consumed_credits?: number;
    finished_at?: number;
  };
  const request = JSON.parse(readFileSync(join(from, 'request.json'), 'utf8')) as {
    ai_model?: string;
  };
  const referenceFile = readdirSync(from).find((file) => /^reference\.(png|jpe?g)$/.test(file));
  if (!referenceFile) throw new Error(`${from} has no reference image`);
  const reference = readFileSync(join(from, referenceFile));

  console.log(`\n  ${id}`);
  console.log(`  spec ${canonicalSpec(spec)}`);

  const { bytes, report } = await processModel(raw, {
    nominal: spec.nominal,
    frontYawDeg: options.frontYawDeg,
    fitHeight: options.fitHeight,
    budgets: STRUCTURE_BUDGETS,
  });
  writeFileSync(join(from, 'publish-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const size = report.normalised.naturalSize.map((value) => value.toFixed(3)).join(' × ');
  console.log(
    `  ${(raw.length / 1024 / 1024).toFixed(2)} MB → ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB, ` +
      `${report.input.counts.triangles} → ${report.output.counts.triangles} triangles, ` +
      `textures ≤ ${report.output.maxTexturePx} px`,
  );
  console.log(
    `  ${size} m (scale ${report.normalised.scale.toFixed(4)}), validator ${report.outputValidation.errors} errors`,
  );
  for (const warning of report.warnings) console.log(`  ! ${warning}`);
  for (const defect of report.defects) console.log(`  ✗ ${defect}`);

  if (report.defects.length > 0) {
    console.log(`\n  Refused. The report is ${join(from, 'publish-report.json')}\n`);
    process.exitCode = 1;
    return;
  }

  const entry: ModelLibraryEntry = ModelLibraryEntrySchema.parse({
    id,
    file: `models/library/${id}.glb`,
    thumbnail: existsSync(join(from, 'thumb.png')) ? `models/library/${id}.webp` : null,
    bytes: bytes.byteLength,
    sha256: report.sha256,
    triangles: report.output.counts.triangles,
    maxTexturePx: report.output.maxTexturePx,
    depicts: {
      symbol: spec.symbol,
      structure: spec.structure,
      material: spec.material,
      style: spec.style,
    },
    naturalSize: report.normalised.naturalSize.map((value) => Number(value.toFixed(4))),
    pivot: 'base-centre',
    up: '+y',
    front: '+z',
    fit: { tolerance: options.tolerance, turnable: options.turnable },
    familyId: options.family ?? id,
    ...(report.normalised.heightStretch !== 1
      ? { heightStretch: Number(report.normalised.heightStretch.toFixed(4)) }
      : {}),
    source: {
      provider: 'meshy',
      endpoint: task.type ?? 'image-to-3d',
      taskId: task.id,
      aiModel: request.ai_model ?? 'unknown',
      credits: task.consumed_credits ?? 0,
      specHash,
      specVersion: MODEL_SPEC_VERSION,
      referenceSha256: sha(reference),
      generatedAt: new Date(task.finished_at ?? Date.now()).toISOString(),
    },
    licence: 'meshy-paid-private',
    approvedAt: new Date().toISOString(),
  });

  if (options.dryRun) {
    console.log(`\n  dry run — would publish:\n${JSON.stringify(entry, null, 2)}\n`);
    return;
  }

  // The one implementation of publishing, shared with the model lab: immutable ids, no twins.
  await publishToLibrary(PATHS, {
    entry,
    glb: bytes,
    thumbnailPng: existsSync(join(from, 'thumb.png'))
      ? readFileSync(join(from, 'thumb.png'))
      : null,
    reference,
    replace: options.replace,
  });

  console.log(`\n  ✓ published ${entry.file} (${(entry.bytes / 1024).toFixed(0)} kB)`);
  console.log(`  ✓ ${LIBRARY_FILE}\n`);
}

/* ---------------------------------------------------------------- audit */

async function audit(): Promise<number> {
  const { entries, bytes, failures } = await auditLibrary(PATHS);
  console.log(`  Library models: ${entries}, ${(bytes / 1024).toFixed(0)} kB`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  return failures.length === 0 ? 0 : 1;
}

/* ---------------------------------------------------------------- main */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.audit) {
    process.exitCode = await audit();
    return;
  }
  await publish(options);
}

main().catch((error: unknown) => {
  console.error(`  ✗ ${(error as Error).message}`);
  process.exitCode = 1;
});
