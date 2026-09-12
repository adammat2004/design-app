import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { ASSET_FAMILIES, ASSET_IDS, type AssetFamily } from '../src/lib/materials/assets/asset-spec';
import { catalogueEntries, catalogueVariants } from '../src/lib/materials/assets/catalogue';

/** Offline source-art audit: no generation, network, or changes to the library. */
async function main() {
  const output = resolve('.plan-preview');
  mkdirSync(output, { recursive: true });
  const entries = catalogueEntries();
  const rows = ASSET_IDS.map((id) => {
    const family: AssetFamily = ASSET_FAMILIES[id];
    const variants = catalogueVariants(id);
    return { id, group: family.taxon.group, type: family.taxon.type, expected: family.variants,
      available: variants.length, metres: family.metres,
      missingFiles: variants.filter((v) => !existsSync(resolve('public/assets', v.file))).map((v) => v.file),
      variants: variants.map((v) => ({ variant: v.variant, meanColour: v.meanColour,
        opaqueRadiusRatio: v.opaqueRadiusRatio, provenance: !!v.provenance, seamScore: v.seamScore })) };
  });
  const report = { files: entries.length, families: rows.length,
    missingFiles: rows.flatMap((r) => r.missingFiles),
    incompleteFamilies: rows.filter((r) => r.available < r.expected).map((r) => r.id),
    rows };
  writeFileSync(resolve(output, 'asset-audit.json'), JSON.stringify(report, null, 2) + '\n');

  const vegetation = rows.filter((r) => r.group === 'vegetation');
  const width = 1100;
  const rowHeight = 118;
  const canvas = createCanvas(width, 54 + vegetation.length * rowHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8faf8'; context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = '#243d31'; context.font = 'bold 22px sans-serif';
  context.fillText('Garden Studio · vegetation source audit', 20, 32);
  for (let i = 0; i < vegetation.length; i++) {
    const family = vegetation[i]!;
    const top = 54 + i * rowHeight;
    context.fillStyle = i % 2 ? '#eef1ed' : '#ffffff'; context.fillRect(0, top, width, rowHeight);
    context.fillStyle = '#243d31'; context.font = '13px sans-serif'; context.fillText(family.id, 16, top + 29);
    context.fillStyle = '#6b776c'; context.font = '11px sans-serif';
    context.fillText(`${family.available}/${family.expected} variants · ${family.metres.w} × ${family.metres.h} m`, 16, top + 50);
    for (const [index, entry] of catalogueVariants(family.id).entries()) {
      const file = resolve('public/assets', entry.file);
      if (!existsSync(file)) continue;
      const image = await loadImage(file);
      const size = 86;
      const scale = size / Math.max(image.width, image.height);
      context.drawImage(image, 244 + index * 136 + (size - image.width * scale) / 2,
        top + 8 + (size - image.height * scale) / 2, image.width * scale, image.height * scale);
      context.fillStyle = '#6b776c'; context.font = '10px sans-serif';
      context.fillText(`Variant ${entry.variant}`, 264 + index * 136, top + 108);
    }
  }
  writeFileSync(resolve(output, 'asset-contact-sheet.png'), canvas.toBuffer('image/png'));
  console.log(JSON.stringify({ files: report.files, families: report.families,
    missingFiles: report.missingFiles, incompleteFamilies: report.incompleteFamilies }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
