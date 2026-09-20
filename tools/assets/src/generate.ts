import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ASSET_FAMILIES,
  ASSET_IDS,
  assetFile,
  elevatedFrame,
  type AssetFamily,
  type AssetId,
} from '../../../apps/web/src/lib/materials/assets/asset-spec';
import {
  ASSET_SPEC_VERSION,
  composePrompt,
} from '../../../apps/web/src/lib/materials/assets/asset-style';
import { readOpenAiKey } from './env.js';
import { runPool } from './pool.js';
import {
  POSTPROCESS_VERSION,
  processElevatedSprite,
  processFace,
  processSprite,
  processTexture,
  lightPoolDisc,
  softShadowDisc,
  type Processed,
} from './postprocess.js';
import { openAiProvider, resolveModel, MODEL_ENV, DEFAULT_MODEL } from './providers/openai.js';
import type { ImageProvider, ImageQuality } from './providers/provider.js';

/**
 * Generates the renderer's assets.
 *
 *     pnpm --filter @garden-studio/asset-tool generate [--only <prefix | id-n>] [--force]
 *                                                        [--reprocess] [--dry-run] [--strict]
 *                                                        [--model <id>] [--quality <tier>]
 *                                                        [--concurrency N] [--audit]
 *
 * For every family × variant in `asset-spec.ts`: compose the prompt from `asset-style.ts`, ask the
 * model, keep the raw PNG under `raw/` (gitignored, so post-processing can be re-run without paying
 * for the picture again), process it into the WebP the app ships, and write `catalogue.json` beside
 * the app's code with the numbers the renderer reads and a record of how each file was made.
 * Existing raws are reused unless `--force`; `--only` restricts to ids starting with a prefix, or
 * to one file by its stem (`plant-shrub-3`), which is how a single bad variant is re-rolled.
 *
 * **The model is a setting.** `--model`, else `ASSET_IMAGE_MODEL`, else `DEFAULT_MODEL`; whichever
 * it was is written into the catalogue with the quality tier, the size actually requested, the
 * specification version and a hash of the raw bytes. `--quality` is the cost lever.
 *
 * **`--reprocess` spends nothing and forges nothing.** It re-runs the post-processing over the raws
 * already on disk, skips any family that has none, and carries the file's original generation
 * record forward untouched — it used to restamp every entry with today's model and today's prompt
 * hash, which erased the one question the record exists to answer.
 *
 * `--strict` refuses to ship an asset with a *defect* — an opaque background, a cropped object, one
 * that would float — and ships one that merely earned a warning, recording the warning. See
 * `postprocess.ts` for the line between the two.
 *
 * `--audit` reads the library and exits non-zero if any file is missing, was drawn from a prompt
 * that has since changed, or shipped with a defect. No key is a supported state: the tool lists
 * what it would generate and exits 0.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RAW_DIR = join(HERE, '..', 'raw');
const PUBLIC_ASSETS = join(REPO, 'apps', 'web', 'public', 'assets');
const CATALOGUE = join(REPO, 'apps', 'web', 'src', 'lib', 'materials', 'assets', 'catalogue.json');

const QUALITIES: readonly ImageQuality[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Options {
  only: string | null;
  force: boolean;
  reprocess: boolean;
  dryRun: boolean;
  quality: ImageQuality;
  model: string;
  /** Model calls in flight at once. The images-per-minute allowance is small; two rarely waits. */
  concurrency: number;
  /** Refuse to write an asset the QA pass found a defect in. Warnings are recorded, never refused. */
  strict: boolean;
  /** Report what the library says about itself and write nothing. See `audit`. */
  audit: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    only: null,
    force: false,
    reprocess: false,
    dryRun: false,
    quality: 'medium',
    model: resolveModel(null),
    concurrency: 2,
    strict: false,
    audit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--only') options.only = argv[++i] ?? null;
    else if (arg === '--force') options.force = true;
    else if (arg === '--reprocess') options.reprocess = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--audit') options.audit = true;
    else if (arg === '--model') options.model = resolveModel(argv[++i] ?? null);
    else if (arg === '--concurrency') options.concurrency = Math.max(1, Number(argv[++i] ?? 1));
    else if (arg === '--quality') {
      const value = argv[++i] as ImageQuality | undefined;
      if (value && QUALITIES.includes(value)) options.quality = value;
      else throw new Error(`--quality must be one of ${QUALITIES.join(', ')}, not ${value}`);
    } else throw new Error(`Unknown argument ${arg}`);
  }

  return options;
}

/* ---------------------------------------------------------------- selection */

/** `--only` names a prefix (`vis-`), a family (`plant-shrub`) or one file by stem (`plant-shrub-3`). */
function selects(only: string | null, id: AssetId, variant: number): boolean {
  if (!only) return true;
  return id.startsWith(only) || `${id}-${variant}` === only;
}

function familiesFor(only: string | null): AssetId[] {
  return ASSET_IDS.filter((id) => !only || id.startsWith(only) || only.startsWith(`${id}-`));
}

/* ---------------------------------------------------------------- catalogue */

/** How a file was made. Written when the model is called, carried forward by `--reprocess`. */
export interface GenerationRecord {
  model: string;
  quality: string;
  requestedSize: { w: number; h: number };
  rawSize: { w: number; h: number };
  specVersion: string;
  promptHash: string;
  generatedAt: string;
  /** Digest of the raw PNG, so a raw on disk can be matched to the file it made. */
  rawHash: string;
}

/** What the last post-processing pass did and found. Rewritten on every pass. */
export interface ProcessedRecord {
  postprocessVersion: string;
  at: string;
  warnings: string[];
  defects: string[];
  correction?: { saturation: number };
}

export interface CatalogueEntry {
  id: AssetId;
  variant: number;
  file: string;
  widthPx: number;
  heightPx: number;
  meanColour: string;
  opaqueRadiusRatio?: number;
  seamScore?: number;
  /** Elevated sprites: where the opaque pixels are, and how much of the bottom edge they cover. */
  opaqueBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  footAlpha?: number;
  /** The record written before `generation` existed. Kept as it was; never written afresh. */
  provenance?: { model: string; generatedAt: string; promptHash: string };
  generation?: GenerationRecord;
  processed?: ProcessedRecord;
}

interface Catalogue {
  version: string;
  generatedAt: string;
  assets: CatalogueEntry[];
}

function readCatalogue(): Catalogue {
  if (!existsSync(CATALOGUE)) return { version: 'none', generatedAt: '', assets: [] };
  return JSON.parse(readFileSync(CATALOGUE, 'utf8')) as Catalogue;
}

function writeCatalogue(entries: CatalogueEntry[]): Catalogue {
  const sorted = [...entries].sort((a, b) =>
    a.id === b.id ? a.variant - b.variant : a.id.localeCompare(b.id),
  );

  const hash = createHash('sha256');
  for (const entry of sorted) {
    hash.update(JSON.stringify(entry));
    const file = join(PUBLIC_ASSETS, entry.file);
    if (existsSync(file)) hash.update(readFileSync(file));
  }

  const catalogue: Catalogue = {
    version: hash.digest('hex').slice(0, 12),
    generatedAt: new Date().toISOString(),
    assets: sorted,
  };

  writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);
  return catalogue;
}

/* ---------------------------------------------------------------- the run */

async function postprocess(family: AssetFamily, png: Buffer): Promise<Processed> {
  switch (family.kind) {
    case 'sprite':
      /*
       * The two cameras frame differently, and this is the only place that matters.
       *
       * A plan sprite is centred in its frame — it *is* its footprint, so the middle of the image is
       * the middle of the thing. An elevated one stands on the bottom edge with its height leaning
       * up the screen above it, and is measured against that framing rather than against a radius
       * from the centre. A skin is a texture in both worlds and never reaches here.
       */
      return family.camera === 'elevated'
        ? processElevatedSprite(png, family.sizePx, family.metres.h, elevatedFrame(family).h)
        : processSprite(png, family.sizePx);
    case 'texture':
      return processTexture(png, family.sizePx, family.correction);
    case 'face':
      return processFace(png, family.sizePx);
  }
}

/**
 * What the library says about itself, without asking a model or writing a byte.
 *
 * The question this answers is the one the generation record exists for and which nothing could
 * ask until it was recorded: **which of these files no longer match the sentence that specifies
 * them?** A prompt is edited far more often than a library is regenerated, so the drift is silent
 * and accumulating — an asset keeps drawing perfectly while its specification has moved on, and
 * there is no way to tell by looking at either one.
 *
 * Read-only on purpose. Regenerating is `--force --only <id>`, which is a decision with a bill
 * attached; this is the report you make it from. **Exits non-zero** on anything missing, stale or
 * defective, so it can stand in a check.
 */
function audit(only: string | null): void {
  const catalogue = readCatalogue();
  const byKey = new Map(catalogue.assets.map((entry) => [`${entry.id}-${entry.variant}`, entry]));

  const stale: string[] = [];
  const unprovenanced: string[] = [];
  const missing: string[] = [];
  const defective: string[] = [];
  const unversioned: string[] = [];
  let considered = 0;

  for (const id of familiesFor(only)) {
    const family: AssetFamily = ASSET_FAMILIES[id];

    for (let variant = 1; variant <= family.variants; variant += 1) {
      if (!selects(only, id, variant)) continue;
      considered += 1;
      const key = `${id}-${variant}`;
      const entry = byKey.get(key);

      if (!entry) {
        missing.push(key);
        continue;
      }
      if (entry.processed && entry.processed.defects.length > 0) defective.push(key);

      const hash = entry.generation?.promptHash ?? entry.provenance?.promptHash;
      if (!hash) {
        unprovenanced.push(key);
        continue;
      }
      if (hash !== promptHash(composePrompt(family, variant))) stale.push(key);
      else if (!entry.generation) unversioned.push(key);
    }
  }

  for (const key of missing) console.log(`  missing      ${key}`);
  for (const key of stale) console.log(`  prompt moved ${key}`);
  for (const key of defective) console.log(`  defective    ${key}`);

  console.log(
    `\n${considered} considered, ${byKey.size} catalogued. ${missing.length} never generated, ` +
      `${stale.length} drawn from a prompt that has since changed, ${defective.length} shipped ` +
      `with a defect, ${unprovenanced.length} predate any record, ${unversioned.length} current ` +
      `but predate specification ${ASSET_SPEC_VERSION}.`,
  );
  if (stale.length > 0) {
    console.log(`Regenerate with:  --force --only <id>`);
  }
  if (missing.length + stale.length + defective.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.audit) {
    audit(options.only);
    return;
  }

  const key = readOpenAiKey(REPO);
  const provider: ImageProvider | null = key
    ? openAiProvider(key, { model: options.model, quality: options.quality })
    : null;

  mkdirSync(RAW_DIR, { recursive: true });
  /*
   * The output directories are *derived from `assetFile`*, never restated here. They used to be
   * two hardcoded names, which was fine while layout was one axis; now that it is camera and kind
   * a restated list is a second place to keep in step, and a camera added to the manifest would
   * arrive as a directory nobody had created.
   */
  for (const dir of new Set(
    ASSET_IDS.map((id) => dirname(join(PUBLIC_ASSETS, assetFile(id, 1)))),
  )) {
    mkdirSync(dir, { recursive: true });
  }

  const existing = readCatalogue();
  const entries = new Map<string, CatalogueEntry>(
    existing.assets.map((entry) => [`${entry.id}-${entry.variant}`, entry]),
  );

  let generated = 0;
  let processed = 0;
  let skipped = 0;
  let wouldGenerate = 0;
  let failed = 0;
  let rejected = 0;

  const jobs: (() => Promise<void>)[] = [];

  for (const id of familiesFor(options.only)) {
    const family: AssetFamily = ASSET_FAMILIES[id];

    for (let variant = 1; variant <= family.variants; variant += 1) {
      if (!selects(options.only, id, variant)) continue;
      const key = `${id}-${variant}`;
      const file = assetFile(id, variant);
      const out = join(PUBLIC_ASSETS, file);
      const rawFile = join(RAW_DIR, `${key}.png`);

      if (family.procedural) {
        if (existsSync(out) && !options.force && !options.reprocess) {
          skipped += 1;
          continue;
        }
        const result =
          family.procedural === 'light-pool'
            ? await lightPoolDisc(family.sizePx)
            : await softShadowDisc(family.sizePx);
        record(entries, id, variant, file, result, {
          kind: 'generated',
          generation: {
            model: 'procedural',
            quality: 'none',
            requestedSize: family.sizePx,
            rawSize: family.sizePx,
            specVersion: ASSET_SPEC_VERSION,
            promptHash: promptHash(composePrompt(family, variant)),
            generatedAt: new Date().toISOString(),
            rawHash: digest(result.webp),
          },
        });
        writeFileSync(out, result.webp);
        processed += 1;
        console.log(`  drew   ${key}`);
        continue;
      }

      const haveRaw = existsSync(rawFile);
      const haveOut = existsSync(out) && entries.has(key);

      if (haveOut && !options.force && !options.reprocess) {
        skipped += 1;
        continue;
      }

      const needsModel = !haveRaw || options.force;

      /*
       * **`--reprocess` never calls the model.** It re-runs the post-processing over the raws that
       * are already on disk, and a family with no raw is simply not its business.
       *
       * It used to fall through to generation here, which is a genuinely expensive surprise: the
       * flag reads as "do not spend anything", so `--only vis- --reprocess` to re-measure a handful
       * of finished assets quietly bought every ungenerated family in that prefix. Found the
       * expensive way.
       */
      if (needsModel && options.reprocess && !options.force) {
        skipped += 1;
        continue;
      }

      if (needsModel && !provider) {
        wouldGenerate += 1;
        console.log(`  would generate ${key}  (no OPENAI_API_KEY)`);
        continue;
      }
      if (needsModel && options.dryRun) {
        wouldGenerate += 1;
        console.log(`  would generate ${key} with ${provider!.name}`);
        continue;
      }

      jobs.push(async () => {
        let png: Buffer;
        let origin: Origin = { kind: 'kept' };

        if (needsModel) {
          const started = Date.now();
          const prompt = composePrompt(family, variant);
          try {
            const image = await provider!.generate({
              prompt,
              sizePx: family.sizePx,
              transparent: family.transparent,
            });
            png = image.png;
            const meta = await sharp(png).metadata();
            origin = {
              kind: 'generated',
              generation: {
                model: provider!.model,
                quality: provider!.quality,
                requestedSize: image.requestedSize,
                rawSize: { w: meta.width ?? 0, h: meta.height ?? 0 },
                specVersion: ASSET_SPEC_VERSION,
                promptHash: promptHash(prompt),
                generatedAt: new Date().toISOString(),
                rawHash: digest(png),
              },
            };
          } catch (error) {
            failed += 1;
            console.log(`  FAILED ${key}: ${error instanceof Error ? error.message : error}`);
            return;
          }
          writeFileSync(rawFile, png);
          generated += 1;
          console.log(`  got    ${key}  ${((Date.now() - started) / 1000).toFixed(1)}s`);
        } else {
          png = readFileSync(rawFile);
        }

        const result = await postprocess(family, png);

        /*
         * Refused rather than written, under `--strict`, and only for a defect. The raw PNG stays
         * on disk, so re-running with the flag off writes it anyway and `--reprocess` re-measures
         * it — the picture that was paid for is never thrown away, only the decision to ship it.
         */
        if (options.strict && (result.defects?.length ?? 0) > 0) {
          rejected += 1;
          console.log(`  REJECT ${key}: ${result.defects!.join('; ')}`);
          return;
        }

        record(entries, id, variant, file, result, origin);
        writeFileSync(out, result.webp);
        processed += 1;
        console.log(
          `  wrote  ${file}  ${result.widthPx}×${result.heightPx}  mean ${result.meanColour}` +
            (result.seamScore !== undefined ? `  seam ${result.seamScore}` : '') +
            (result.opaqueRadiusRatio !== undefined ? `  reach ${result.opaqueRadiusRatio}` : '') +
            (result.footAlpha !== undefined ? `  foot ${result.footAlpha}` : ''),
        );
        for (const defect of result.defects ?? []) console.log(`         ✗ ${defect}`);
        for (const warning of result.warnings ?? []) console.log(`         ⚠ ${warning}`);
      });
    }
  }

  await runPool(jobs, options.concurrency);

  /*
   * A dry run writes nothing at all, including the catalogue.
   *
   * It used to rewrite `generatedAt` every time, which left the working tree dirty for a command
   * whose whole point is that it does nothing — so "did my last run change anything?" could not be
   * answered by `git status`, which is the first place anyone looks.
   */
  const catalogue = options.dryRun ? existing : writeCatalogue([...entries.values()]);
  if (failed > 0) console.log(`${failed} failed — re-run to retry just those.`);
  if (rejected > 0) {
    console.log(
      `${rejected} rejected for a defect — the raw PNGs are kept, so --force re-asks the model ` +
        'and dropping --strict ships them as they are.',
    );
  }

  console.log(
    `\n${generated} generated, ${processed} processed, ${skipped} skipped, ${rejected} rejected, ${wouldGenerate} not generated.`,
  );
  console.log(`Catalogue ${catalogue.version} lists ${catalogue.assets.length} files.`);
  if (generated > 0 || wouldGenerate > 0) {
    console.log(
      `Model ${options.model} at ${options.quality}` +
        (options.model === DEFAULT_MODEL
          ? ` (the default; override with --model or ${MODEL_ENV})`
          : ''),
    );
  }

  if (!provider && wouldGenerate > 0) {
    console.log(
      'No image-model key found (OPENAI_API_KEY, or OPEN_AI_API_KEY in apps/api/.env). ' +
        'The app draws its procedural fallback for anything missing.',
    );
  }
}

/** A short, stable digest of the sentence that specifies this asset. */
export function promptHash(prompt: string): string {
  return digest(Buffer.from(prompt));
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

/**
 * Where the pixels came from on this pass.
 *
 * `generated` writes a fresh record. `kept` means the raw on disk was reused — `--reprocess` — and
 * the entry's existing `generation` (or its older `provenance`) is carried forward as it was,
 * because the pixels are the ones that record describes, whatever prompt or model is current now.
 */
type Origin = { kind: 'generated'; generation: GenerationRecord } | { kind: 'kept' };

function record(
  entries: Map<string, CatalogueEntry>,
  id: AssetId,
  variant: number,
  file: string,
  result: Processed,
  origin: Origin,
): void {
  const key = `${id}-${variant}`;
  const previous = entries.get(key);

  const lineage: Pick<CatalogueEntry, 'generation' | 'provenance'> =
    origin.kind === 'generated'
      ? { generation: origin.generation }
      : {
          ...(previous?.generation ? { generation: previous.generation } : {}),
          ...(previous?.provenance ? { provenance: previous.provenance } : {}),
        };

  entries.set(key, {
    id,
    variant,
    file,
    widthPx: result.widthPx,
    heightPx: result.heightPx,
    meanColour: result.meanColour,
    ...(result.opaqueRadiusRatio !== undefined
      ? { opaqueRadiusRatio: result.opaqueRadiusRatio }
      : {}),
    ...(result.seamScore !== undefined ? { seamScore: result.seamScore } : {}),
    ...(result.opaqueBounds !== undefined ? { opaqueBounds: result.opaqueBounds } : {}),
    ...(result.footAlpha !== undefined ? { footAlpha: result.footAlpha } : {}),
    ...lineage,
    processed: {
      postprocessVersion: POSTPROCESS_VERSION,
      at: new Date().toISOString(),
      warnings: result.warnings ?? [],
      defects: result.defects ?? [],
      ...(result.correction ? { correction: result.correction } : {}),
    },
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
