import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalSpec,
  composeReferencePrompt,
  MODEL_SPEC_VERSION,
  specForPreset,
  type PresetSpecOptions,
} from '../../../packages/schema/src/plan/models/spec';
import { SymbolIdSchema } from '../../../packages/schema/src/plan/symbols';
import type { RoofKind } from '../../../packages/schema/src/plan/structure/definitions';
import type { StructureFinishId } from '../../../packages/schema/src/plan/structure/finishes';
import { readOpenAiKey } from './env.js';
import { openAiProvider, resolveModel } from './providers/openai.js';
import type { ImageQuality } from './providers/provider.js';

/**
 * The reference image a library model is generated from: one picture per spec, composed from the
 * spec rather than written by hand.
 *
 *     pnpm --filter @garden-studio/asset-tool generate:references \
 *       --symbol gazebo --preset classic [--frame dark-stained-timber] [--roof-finish shingle-dark]
 *       [--roof-kind hipped] [--size 3x3x2.8] [--notes "…"] [--quality high] [--force] [--dry-run]
 *
 * The prompt is `composeReferencePrompt(spec)` (`packages/schema/src/plan/models/spec.ts`), the
 * one template every reference is drawn to, so two references for different gazebos differ only in
 * what the spec says. A choice the structure does not offer is refused before anything is bought.
 *
 * Written to `raw/references/<hash>.png` (gitignored, like every raw this tool makes), with
 * `<hash>.json` beside it holding the spec, its canonical form and the exact prompt — which is what
 * publishing a model reads back, so a library entry can say what its picture was asked to be. The
 * hash is the sha256 of the canonical spec, so asking twice for the same thing finds the first
 * picture rather than paying for a second; `--force` buys a new one.
 *
 * Phase 0's `spike-reference.ts` wrote one gazebo prompt by hand; this replaced it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const OUT_DIR = join(HERE, '..', 'raw', 'references');
const QUALITIES: ImageQuality[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Options {
  symbol: string | null;
  preset: string | null;
  spec: PresetSpecOptions;
  quality: ImageQuality;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    symbol: null,
    preset: null,
    spec: {},
    quality: 'high',
    force: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--symbol') options.symbol = next();
    else if (arg === '--preset') options.preset = next();
    else if (arg === '--frame') options.spec.frame = next() as StructureFinishId;
    else if (arg === '--roof-finish') options.spec.roofFinish = next() as StructureFinishId;
    else if (arg === '--roof-kind') options.spec.roofKind = next() as RoofKind;
    else if (arg === '--notes') options.spec.notes = next();
    else if (arg === '--size') {
      const [width, depth, height] = next().split('x').map(Number);
      if (![width, depth, height].every((value) => value !== undefined && value > 0)) {
        throw new Error('--size is WIDTHxDEPTHxHEIGHT in metres, e.g. 3x3x2.8');
      }
      options.spec.nominal = { width: width!, depth: depth!, height: height! };
    } else if (arg === '--quality') {
      const value = next() as ImageQuality;
      if (!QUALITIES.includes(value))
        throw new Error(`--quality must be one of ${QUALITIES.join(', ')}`);
      options.quality = value;
    } else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.symbol || !options.preset) {
    throw new Error('--symbol and --preset are required, e.g. --symbol gazebo --preset classic');
  }

  const spec = specForPreset(SymbolIdSchema.parse(options.symbol), options.preset, options.spec);
  const canonical = canonicalSpec(spec);
  const hash = createHash('sha256').update(canonical).digest('hex');
  const prompt = composeReferencePrompt(spec);
  const png = join(OUT_DIR, `${hash.slice(0, 16)}.png`);
  const sidecar = join(OUT_DIR, `${hash.slice(0, 16)}.json`);

  console.log(`\n  spec      ${canonical}`);
  console.log(`  hash      ${hash}`);
  console.log(`\n  ${prompt}\n`);

  if (options.dryRun) return;
  if (existsSync(png) && !options.force) {
    console.log(`  already drawn: ${png} — pass --force to buy another\n`);
    return;
  }

  const key = readOpenAiKey(REPO);
  if (!key) {
    console.log('  no OpenAI key in apps/api/.env — printed the prompt and stopped\n');
    return;
  }

  const model = resolveModel(null);
  const provider = openAiProvider(key, { model, quality: options.quality });
  console.log(`  generating with ${provider.name}…`);
  const image = await provider.generate({
    prompt,
    sizePx: { w: 1024, h: 1024 },
    transparent: false,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(png, image.png);
  writeFileSync(
    sidecar,
    `${JSON.stringify(
      {
        spec,
        canonical,
        specHash: hash,
        specVersion: MODEL_SPEC_VERSION,
        prompt,
        imageModel: model,
        quality: options.quality,
        imageSha256: createHash('sha256').update(image.png).digest('hex'),
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  ✓ ${png}\n  ✓ ${sidecar}\n`);
}

main().catch((error: unknown) => {
  console.error(`  ✗ ${(error as Error).message}`);
  process.exitCode = 1;
});
