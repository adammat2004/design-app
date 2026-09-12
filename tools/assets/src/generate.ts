import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_FAMILIES,
  ASSET_IDS,
  assetFile,
  type AssetFamily,
  type AssetId,
} from '../../../apps/web/src/lib/materials/assets/asset-spec';
import { readOpenAiKey } from './env.js';
import {
  processFace,
  processSprite,
  processTexture,
  lightPoolDisc,
  softShadowDisc,
  type Processed,
} from './postprocess.js';
import { openAiProvider } from './providers/openai.js';
import type { ImageProvider } from './providers/provider.js';

/**
 * Generates the renderer's assets.
 *
 *     pnpm --filter @garden-studio/asset-tool generate [--only <prefix>] [--force] [--reprocess]
 *                                                        [--dry-run] [--quality low|medium|high]
 *
 * For every family × variant in `asset-spec.ts`: ask the model, keep the raw PNG under `raw/`
 * (gitignored, so post-processing can be re-run without paying for the picture again), process it
 * into the WebP the app ships, and write `catalogue.json` beside the app's code with the numbers the
 * renderer reads. Existing raws are reused unless `--force`; `--reprocess` only redoes the
 * post-processing; `--only` restricts to ids starting with a prefix.
 *
 * No key is a supported state: the tool lists what it would generate and exits 0.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RAW_DIR = join(HERE, '..', 'raw');
const PUBLIC_ASSETS = join(REPO, 'apps', 'web', 'public', 'assets');
const CATALOGUE = join(REPO, 'apps', 'web', 'src', 'lib', 'materials', 'assets', 'catalogue.json');

interface Options {
  only: string | null;
  force: boolean;
  reprocess: boolean;
  dryRun: boolean;
  quality: 'low' | 'medium' | 'high';
  /** Model calls in flight at once. The model takes ~20 s a picture; four keeps a full run short. */
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    only: null,
    force: false,
    reprocess: false,
    dryRun: false,
    quality: 'medium',
    concurrency: 4,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--only') options.only = argv[++i] ?? null;
    else if (arg === '--force') options.force = true;
    else if (arg === '--reprocess') options.reprocess = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--concurrency') options.concurrency = Math.max(1, Number(argv[++i] ?? 1));
    else if (arg === '--quality') {
      const value = argv[++i];
      if (value === 'low' || value === 'medium' || value === 'high') options.quality = value;
      else throw new Error(`--quality must be low, medium or high, not ${value}`);
    } else throw new Error(`Unknown argument ${arg}`);
  }

  return options;
}

/* ---------------------------------------------------------------- prompts */

/**
 * The prompt for one variant.
 *
 * A family prompt may list its variants — "Each variant a different species: a, b, c." — in which
 * case the nth item replaces the sentence. Otherwise the variant is asked to differ in arrangement,
 * which is enough for gravel and not enough for shrubs, so the plant families all list theirs.
 */
export function variantPrompt(family: AssetFamily, variant: number): string {
  const match = /Each variant[^:]*:\s*([^.]+)\./.exec(family.prompt);

  if (match) {
    const items = match[1]!.split(/,\s*/).map((item) => item.trim());
    const item = items[variant - 1];
    if (item) {
      return family.prompt.replace(match[0], `Specifically: ${item}.`);
    }
  }

  if (family.variants > 1) {
    return `${family.prompt} Variant ${variant} of ${family.variants}, differing in arrangement and detail from the others.`;
  }

  return family.prompt;
}

/* ---------------------------------------------------------------- catalogue */

export interface CatalogueEntry {
  id: AssetId;
  variant: number;
  file: string;
  widthPx: number;
  heightPx: number;
  meanColour: string;
  opaqueRadiusRatio?: number;
  seamScore?: number;
  /**
   * Where this file came from — see the app's `CatalogueEntrySchema`.
   *
   * Written from here on so the library stays answerable as it becomes mixed-vintage. The first
   * time a better image model appears, "which of these came from the old one" and "which would
   * change if I edited this prompt" both become questions a selective regeneration has to answer,
   * and neither can be reconstructed later.
   *
   * The prompt is hashed rather than copied: it already lives in `asset-spec.ts`, which is the
   * specification, and a second copy here would be a second thing to keep in step.
   */
  provenance?: { model: string; generatedAt: string; promptHash: string };
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
      return processSprite(png, family.sizePx);
    case 'texture':
      return processTexture(png, family.sizePx);
    case 'face':
      return processFace(png, family.sizePx);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const key = readOpenAiKey(REPO);
  const provider: ImageProvider | null = key ? openAiProvider(key, options.quality) : null;

  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(join(PUBLIC_ASSETS, 'textures'), { recursive: true });
  mkdirSync(join(PUBLIC_ASSETS, 'sprites'), { recursive: true });

  const existing = readCatalogue();
  const entries = new Map<string, CatalogueEntry>(
    existing.assets.map((entry) => [`${entry.id}-${entry.variant}`, entry]),
  );

  const ids = ASSET_IDS.filter((id) => !options.only || id.startsWith(options.only));

  let generated = 0;
  let processed = 0;
  let skipped = 0;
  let wouldGenerate = 0;
  let failed = 0;

  const jobs: (() => Promise<void>)[] = [];

  for (const id of ids) {
    const family: AssetFamily = ASSET_FAMILIES[id];

    for (let variant = 1; variant <= family.variants; variant += 1) {
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
        record(entries, id, variant, file, result, 'procedural');
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

        if (needsModel) {
          const started = Date.now();
          try {
            png = await provider!.generate({
              prompt: variantPrompt(family, variant),
              sizePx: family.sizePx,
              transparent: family.transparent,
            });
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
        record(entries, id, variant, file, result, provider?.name ?? 'reprocessed');
        writeFileSync(out, result.webp);
        processed += 1;
        console.log(
          `  wrote  ${file}  ${result.widthPx}×${result.heightPx}  mean ${result.meanColour}` +
            (result.seamScore !== undefined ? `  seam ${result.seamScore}` : '') +
            (result.opaqueRadiusRatio !== undefined ? `  reach ${result.opaqueRadiusRatio}` : ''),
        );
      });
    }
  }

  await runPool(jobs, options.concurrency);

  const catalogue = writeCatalogue([...entries.values()]);
  if (failed > 0) console.log(`${failed} failed — re-run to retry just those.`);

  console.log(
    `\n${generated} generated, ${processed} processed, ${skipped} skipped, ${wouldGenerate} not generated.`,
  );
  console.log(`Catalogue ${catalogue.version} lists ${catalogue.assets.length} files.`);

  if (!provider && wouldGenerate > 0) {
    console.log(
      'No image-model key found (OPENAI_API_KEY, or OPEN_AI_API_KEY in apps/api/.env). ' +
        'The app draws its procedural fallback for anything missing.',
    );
  }
}

/** Runs the jobs with at most `limit` in flight. Order of completion is whatever it is. */
async function runPool(jobs: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next]!;
      next += 1;
      await job();
    }
  });
  await Promise.all(workers);
}

/** A short, stable digest of the sentence that specifies this asset. */
export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 12);
}

function record(
  entries: Map<string, CatalogueEntry>,
  id: AssetId,
  variant: number,
  file: string,
  result: Processed,
  /** What made it. The procedural families say so rather than naming a model they never called. */
  model: string,
): void {
  entries.set(`${id}-${variant}`, {
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
    provenance: {
      model,
      generatedAt: new Date().toISOString(),
      promptHash: promptHash(variantPrompt(ASSET_FAMILIES[id], variant)),
    },
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
