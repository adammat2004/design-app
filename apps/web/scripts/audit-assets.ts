import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ASSET_FAMILIES,
  ASSET_IDS,
  type AssetFamily,
} from '../src/lib/materials/assets/asset-spec';
import { ASSET_SPEC_VERSION } from '../src/lib/materials/assets/asset-style';
import { catalogueEntries, catalogueVariants } from '../src/lib/materials/assets/catalogue';
import { assetQualityAudit } from '../src/lib/materials/assets/quality';

/**
 * Offline source-art audit: no generation, network, or changes to the library.
 *
 * Two kinds of finding, and the exit code tells them apart. A **failure** is the library disagreeing
 * with itself — a catalogued file that is not on disk, an entry for a family the spec no longer
 * knows, two entries for one file, a family with fewer variants than it declares, a file whose
 * pixels are not the size the catalogue says, a defect the QA pass recorded, or a file outside the
 * plan library's `plan/` directory — and any failure exits non-zero so this can stand in a check. A **warning** is a
 * judgement worth a person's eye, printed and written to the report, and never a reason to fail.
 * The script used to print everything and exit zero, which meant nothing it found could stop a
 * commit.
 */

/** A shipped WebP larger than this is a mistake in processing, not a detailed picture. */
const MAX_FILE_BYTES = 1_500_000;

const PUBLIC_ASSETS = resolve('public/assets');
const CATALOGUE_FILE = resolve('src/lib/materials/assets/catalogue.json');

async function main() {
  const output = resolve('.plan-preview');
  mkdirSync(output, { recursive: true });
  const entries = catalogueEntries();
  const failures: string[] = [];
  const warnings: string[] = [];

  /*
   * The raw file rather than `catalogueEntries()`, because the loader deliberately drops an entry
   * whose id the spec no longer knows so that an orphan cannot stop the app drawing — which is
   * right at runtime and exactly the thing an audit exists to notice.
   */
  const raw = JSON.parse(readFileSync(CATALOGUE_FILE, 'utf8')) as {
    assets: { id: string; variant: number; file: string }[];
  };
  const seen = new Set<string>();
  for (const entry of raw.assets) {
    const key = `${entry.id}-${entry.variant}`;
    if (seen.has(key)) failures.push(`duplicate entry ${key}`);
    seen.add(key);
    if (!(entry.id in ASSET_FAMILIES)) failures.push(`orphan entry ${key} — no such family`);
    /*
     * The library has one camera. A file anywhere but `plan/` is one drawn to a specification this
     * app no longer has — the Visualise library that was removed — and would be drawn in the plan.
     */
    if (!entry.file.startsWith('plan/')) failures.push(`${entry.file}: outside the plan library`);
  }
  for (const id of ASSET_IDS) {
    if (id.startsWith('vis-')) failures.push(`${id}: a Visualise family in the plan library`);
  }

  const rows = [];
  for (const id of ASSET_IDS) {
    const family: AssetFamily = ASSET_FAMILIES[id];
    const variants = catalogueVariants(id);
    const missingFiles: string[] = [];
    let unrecorded = 0;

    for (const entry of variants) {
      const file = resolve(PUBLIC_ASSETS, entry.file);
      if (!existsSync(file)) {
        missingFiles.push(entry.file);
        failures.push(`missing file ${entry.file}`);
        continue;
      }
      if (entry.variant > family.variants) {
        failures.push(
          `${entry.file}: variant ${entry.variant} beyond the ${family.variants} the spec declares`,
        );
      }
      const bytes = statSync(file).size;
      if (bytes > MAX_FILE_BYTES)
        failures.push(`${entry.file}: ${bytes} bytes, over ${MAX_FILE_BYTES}`);

      const image = await loadImage(file);
      if (image.width !== entry.widthPx || image.height !== entry.heightPx) {
        failures.push(
          `${entry.file}: file is ${image.width}×${image.height}, catalogue says ${entry.widthPx}×${entry.heightPx}`,
        );
      }
      if (entry.widthPx !== family.sizePx.w || entry.heightPx !== family.sizePx.h) {
        failures.push(
          `${entry.file}: ${entry.widthPx}×${entry.heightPx}, spec says ${family.sizePx.w}×${family.sizePx.h} — reprocess it`,
        );
      }
      if (entry.processed && entry.processed.defects.length > 0) {
        failures.push(
          `${entry.file}: shipped with a defect — ${entry.processed.defects.join('; ')}`,
        );
      }
      for (const warning of entry.processed?.warnings ?? [])
        warnings.push(`${entry.file}: ${warning}`);
      if (!entry.generation && !entry.provenance) unrecorded += 1;
    }

    if (variants.length < family.variants) {
      failures.push(`${id}: ${variants.length} of ${family.variants} variants generated`);
    }

    rows.push({
      ...assetQualityAudit(id),
      group: family.taxon.group,
      type: family.taxon.type,
      expected: family.variants,
      available: variants.length,
      metres: family.metres,
      unrecorded,
      specVersions: [...new Set(variants.map((v) => v.generation?.specVersion ?? 'unversioned'))],
      missingFiles,
      variants: variants.map((v) => ({
        variant: v.variant,
        meanColour: v.meanColour,
        opaqueRadiusRatio: v.opaqueRadiusRatio,
        seamScore: v.seamScore,
        model: v.generation?.model ?? v.provenance?.model ?? null,
        specVersion: v.generation?.specVersion ?? null,
        warnings: v.processed?.warnings ?? [],
        defects: v.processed?.defects ?? [],
      })),
    });
  }
  const report = {
    specVersion: ASSET_SPEC_VERSION,
    files: entries.length,
    families: rows.length,
    failures,
    warnings,
    unrecorded: rows.reduce((total, row) => total + row.unrecorded, 0),
    drawnToCurrentSpec: rows.reduce(
      (total, row) =>
        total + row.variants.filter((v) => v.specVersion === ASSET_SPEC_VERSION).length,
      0,
    ),
    incompleteFamilies: rows.filter((r) => r.available < r.expected).map((r) => r.id),
    rows,
  };
  writeFileSync(resolve(output, 'asset-audit.json'), JSON.stringify(report, null, 2) + '\n');

  const vegetation = rows.filter((r) => r.group === 'vegetation');
  const width = 1100;
  const rowHeight = 118;
  const canvas = createCanvas(width, 54 + vegetation.length * rowHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8faf8';
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = '#243d31';
  context.font = 'bold 22px sans-serif';
  context.fillText('Garden Studio · vegetation source audit', 20, 32);
  for (let i = 0; i < vegetation.length; i++) {
    const family = vegetation[i]!;
    const top = 54 + i * rowHeight;
    context.fillStyle = i % 2 ? '#eef1ed' : '#ffffff';
    context.fillRect(0, top, width, rowHeight);
    context.fillStyle = '#243d31';
    context.font = '13px sans-serif';
    context.fillText(family.id, 16, top + 29);
    context.fillStyle = '#6b776c';
    context.font = '11px sans-serif';
    context.fillText(
      `${family.available}/${family.expected} variants · ${family.metres.w} × ${family.metres.h} m`,
      16,
      top + 50,
    );
    for (const [index, entry] of catalogueVariants(family.id).entries()) {
      const file = resolve('public/assets', entry.file);
      if (!existsSync(file)) continue;
      const image = await loadImage(file);
      const size = 86;
      const scale = size / Math.max(image.width, image.height);
      context.drawImage(
        image,
        244 + index * 136 + (size - image.width * scale) / 2,
        top + 8 + (size - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      context.fillStyle = '#6b776c';
      context.font = '10px sans-serif';
      context.fillText(`Variant ${entry.variant}`, 264 + index * 136, top + 108);
    }
  }
  writeFileSync(resolve(output, 'asset-contact-sheet.png'), canvas.toBuffer('image/png'));

  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  for (const warning of warnings) console.log(`  warn  ${warning}`);

  // The one line a person actually reads, not only the JSON.
  console.log(
    JSON.stringify({
      files: report.files,
      families: report.families,
      failures: failures.length,
      warnings: warnings.length,
      unrecorded: report.unrecorded,
      drawnToCurrentSpec: report.drawnToCurrentSpec,
      incompleteFamilies: report.incompleteFamilies,
    }),
  );

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
