import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BRIEF_ART } from '../../../apps/web/src/lib/brief-art';
import { readOpenAiKey } from './env.js';
import { runPool } from './pool.js';
import { openAiProvider, resolveModel } from './providers/openai.js';
import type { ImageProvider, ImageQuality } from './providers/provider.js';

/**
 * Generates the brief screen's artwork: one isometric vignette per garden space, one photograph
 * per style direction.
 *
 *     pnpm --filter @garden-studio/asset-tool generate:brief [--only <prefix>] [--force]
 *                                                            [--dry-run] [--quality low|medium|high]
 *                                                            [--concurrency N]
 *
 * **A second script rather than a third `AssetKind` in `generate.ts`**, and the reason is what the
 * other tool does *after* the model answers. It seam-scores textures, measures a sprite's opaque
 * reach, records a mean colour to tint towards, and writes all of it into `catalogue.json`, which
 * the painters read and `audit:assets` checks against disk. None of that applies to a picture on a
 * card: it is never tiled, never tinted, never measured, and its path is derived from its id so
 * there is no catalogue to keep in sync. Sharing the file would mean every one of those passes
 * growing a case that means "not this one".
 *
 * What *is* shared is everything that matters: the same provider, the same key, the same raw-PNG
 * cache, the same "no key is a supported state" contract.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RAW_DIR = join(HERE, '..', 'raw', 'brief');
const OUT_DIR = join(REPO, 'apps', 'web', 'public', 'brief');

const QUALITIES: readonly ImageQuality[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Options {
  only: string | null;
  force: boolean;
  dryRun: boolean;
  quality: ImageQuality;
  model: string;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    only: null,
    force: false,
    dryRun: false,
    quality: 'high',
    model: resolveModel(null),
    /*
     * A short run of large pictures against a small images-per-minute allowance, so anything higher
     * spends its time being rate-limited rather than generating.
     */
    concurrency: 2,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--only') options.only = argv[++i] ?? null;
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--model') options.model = resolveModel(argv[++i] ?? null);
    else if (arg === '--quality') {
      const value = argv[++i] as ImageQuality | undefined;
      if (value && QUALITIES.includes(value)) options.quality = value;
      else throw new Error(`--quality must be one of ${QUALITIES.join(', ')}, not ${value}`);
    } else if (arg === '--concurrency') {
      options.concurrency = Math.max(1, Number(argv[++i] ?? 1));
    } else throw new Error(`Unknown argument ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const key = readOpenAiKey(REPO);
  const provider: ImageProvider | null = key
    ? openAiProvider(key, { model: options.model, quality: options.quality })
    : null;

  const wanted = BRIEF_ART.filter((art) => !options.only || art.id.startsWith(options.only));

  if (!options.dryRun) {
    mkdirSync(RAW_DIR, { recursive: true });
    mkdirSync(OUT_DIR, { recursive: true });
  }

  let generated = 0;
  let processed = 0;
  let skipped = 0;
  let missing = 0;

  const jobs = wanted.map((art) => async () => {
    const rawFile = join(RAW_DIR, `${art.id}.png`);
    const outFile = join(OUT_DIR, `${art.id}.webp`);

    if (!options.force && existsSync(outFile) && existsSync(rawFile)) {
      skipped += 1;
      return;
    }

    /*
     * The raw PNG is kept and reused, exactly as `generate.ts` does. Post-processing here is only a
     * resize, so that matters less than it does there — but a re-run after a tweak to the output
     * size should not cost twenty pictures' worth of credit.
     */
    let raw: Buffer | null = existsSync(rawFile) && !options.force ? readFileSync(rawFile) : null;

    if (!raw) {
      if (!provider) {
        missing += 1;
        console.log(`would generate ${art.id} (${art.sizePx.w}x${art.sizePx.h})`);
        return;
      }
      if (options.dryRun) {
        missing += 1;
        console.log(`dry run: ${art.id}`);
        return;
      }

      const image = await provider.generate({
        prompt: art.prompt,
        sizePx: art.sizePx,
        // Never transparent: both kinds of card art are a full-bleed picture behind a caption.
        transparent: false,
      });
      raw = image.png;
      writeFileSync(rawFile, raw);
      generated += 1;
    }

    if (options.dryRun) return;

    /*
     * Cover rather than contain, and `lanczos3` like the other tool.
     *
     * The model returns a square or a 3:2 and the card wants a 4:3 or a 3:2, so something has to
     * give; cropping the edges of a garden vignette loses less than letterboxing it would, because
     * the subject is always in the middle of the frame by construction — the prompt says so.
     */
    await sharp(raw)
      .resize(art.sizePx.w, art.sizePx.h, { fit: 'cover', kernel: 'lanczos3' })
      .webp({ quality: 82 })
      .toFile(outFile);

    processed += 1;
  });

  await runPool(jobs, options.concurrency);

  console.log(
    `\n${generated} generated, ${processed} written, ${skipped} already present, ${missing} not generated.`,
  );

  if (!provider && missing > 0) {
    console.log(
      'No image-model key found (OPENAI_API_KEY, or OPEN_AI_API_KEY in apps/api/.env). ' +
        'The brief screen draws its placeholder for anything missing.',
    );
  }
}

await main();
