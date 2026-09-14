import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ASSET_FAMILIES,
  ASSET_IDS,
  elevatedFrame,
  type AssetFamily,
} from '../src/lib/materials/assets/asset-spec';
import { catalogueEntries, catalogueVariants } from '../src/lib/materials/assets/catalogue';
import { assetAnchor } from '../src/lib/materials/assets/taxonomy';
import { assetQualityAudit } from '../src/lib/materials/assets/quality';
import { elevatedFamilyFor } from '../src/lib/materials/assets/material-assets';
import { buildRenderScene } from '../src/lib/render/build-scene';
import { QUALITY_FIXTURES, qualityScene } from '../src/lib/render/quality-fixtures';

/** Offline source-art audit: no generation, network, or changes to the library. */
async function main() {
  const output = resolve('.plan-preview');
  mkdirSync(output, { recursive: true });
  const entries = catalogueEntries();
  const rows = ASSET_IDS.map((id) => {
    const family: AssetFamily = ASSET_FAMILIES[id];
    const variants = catalogueVariants(id);
    return { ...assetQualityAudit(id), group: family.taxon.group, type: family.taxon.type, expected: family.variants,
      available: variants.length, metres: family.metres,
      camera: family.camera ?? 'plan', heightMetres: family.heightMetres,
      missingFiles: variants.filter((v) => !existsSync(resolve('public/assets', v.file))).map((v) => v.file),
      framingWarnings: framingWarnings(id, family, variants),
      variants: variants.map((v) => ({ variant: v.variant, meanColour: v.meanColour,
        opaqueRadiusRatio: v.opaqueRadiusRatio, provenance: !!v.provenance, seamScore: v.seamScore,
        footAlpha: v.footAlpha, opaqueBounds: v.opaqueBounds })) };
  });
  const report = { files: entries.length, families: rows.length,
    missingFiles: rows.flatMap((r) => r.missingFiles),
    incompleteFamilies: rows.filter((r) => r.available < r.expected).map((r) => r.id),
    fixtureCoverage: QUALITY_FIXTURES.map((fixture) => {
      const scene = buildRenderScene(qualityScene(fixture), { view: 'visualise' });
      const planPlants = new Map<string, { count: number; maxHeight: number }>();
      for (const plant of scene.plants) {
        if (!plant.assetId || (ASSET_FAMILIES[plant.assetId] as AssetFamily).camera === 'elevated') continue;
        const record = planPlants.get(plant.assetId) ?? { count: 0, maxHeight: 0 };
        record.count++; record.maxHeight = Math.max(record.maxHeight, plant.height);
        planPlants.set(plant.assetId, record);
      }
      return { fixture, sampledPlants: scene.plants.length,
        planCameraPlanting: [...planPlants].map(([id, value]) => ({ id, ...value })),
        standingFallbacks: scene.stack.filter((node) => node.kind === 'object' &&
          !elevatedFamilyFor(node.item.element)).map((node) => ({ id: node.id, layer: node.visualLayer })) };
    }), rows };
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

  await elevatedSheet(output);

  console.log(JSON.stringify({ files: report.files, families: report.families,
    missingFiles: report.missingFiles, incompleteFamilies: report.incompleteFamilies,
    elevated: report.rows.filter((r) => r.camera === 'elevated').length,
    framingWarnings: report.rows.flatMap((r) => r.framingWarnings) }));
}

/**
 * What is wrong with an elevated family's framing, read from the catalogue alone.
 *
 * A second opinion rather than a duplicate of the tool's QA pass, and the difference matters: the
 * tool checks a *picture* at the moment it is processed, and this checks the *library* at rest. So
 * it is the one that catches an asset whose file was written before a prompt or a size was edited —
 * the file is fine, the specification moved, and only a pass that reads both can tell.
 */
function framingWarnings(
  id: string,
  family: AssetFamily,
  variants: ReturnType<typeof catalogueVariants>,
): string[] {
  if (family.camera !== 'elevated' || family.kind !== 'sprite') return [];

  const warnings: string[] = [];
  const implied = elevatedFrame(family);
  const declared = family.sizePx.w / family.sizePx.h;

  if (Math.abs(declared - implied.w / implied.h) / (implied.w / implied.h) > 0.01) {
    warnings.push(`${id}: sizePx does not match the frame its footprint and height imply`);
  }

  for (const entry of variants) {
    if (Math.abs(entry.widthPx / entry.heightPx - declared) / declared > 0.02) {
      warnings.push(`${id}-${entry.variant}: file aspect does not match sizePx — reprocess it`);
    }
    /*
     * Only what the catalogue can honestly answer. A high `footAlpha` is a ground plane on a sofa
     * and the plain truth on a planter, and one axis being short is normal after a contain fit —
     * both need the pixels either side to judge, which is why they live in the tool's QA pass and
     * not here. What is left is the question this pass is actually for: does the library still
     * agree with the manifest.
     */
    if (entry.opaqueBounds) {
      const { minX, maxX, minY, maxY } = entry.opaqueBounds;
      if (Math.max(maxX - minX, maxY - minY) < 0.95) {
        warnings.push(`${id}-${entry.variant}: fills neither axis of its frame — reprocess it`);
      }
    }
  }

  return warnings;
}

/**
 * The elevated library, each asset standing on its own footprint.
 *
 * This is the sheet the style specification's manual checks are made on, and it is drawn this way
 * for one reason: **the questions that matter cannot be answered by looking at the asset alone.**
 * Whether a shrub is the right size, whether it stands on the ground or floats above it, whether
 * the camera matches its neighbours — all three are comparisons, either against the footprint the
 * renderer will place it on or against the asset beside it.
 *
 * So every asset is drawn exactly as the renderer will draw it: at a fixed scale, anchored on the
 * ground point, over the outline of the footprint it claims. A cross marks the anchor. An object
 * whose foot is not on the line is one the plan will draw hovering, and that is visible here and
 * nowhere else.
 */
async function elevatedSheet(output: string): Promise<void> {
  const families = ASSET_IDS.filter(
    (id) => (ASSET_FAMILIES[id] as AssetFamily).camera === 'elevated'
      && (ASSET_FAMILIES[id] as AssetFamily).kind === 'sprite',
  );
  if (families.length === 0) return;

  /*
   * Close zoom rather than plan zoom: this sheet is for judging the art, and at 26 px/m a shrub is
   * 26 px across and every one of them looks fine.
   *
   * **One scale for the whole sheet, sized so the largest family fits.** Fitting each asset to its
   * own cell would be the obvious thing and it would destroy the sheet's main use: a tree and a
   * shrub drawn at the same scale is how you see that one of them is wrong, and per-cell fitting
   * makes every asset look correctly sized by construction.
   */
  const pxPerMetre = 64;
  const columns = 4;
  const cell = { w: 280, h: 420 };
  /* Every *specified* variant gets a cell, generated or not, so the sheet shows the holes too. */
  const cells = families.reduce(
    (total, id) => total + (ASSET_FAMILIES[id] as AssetFamily).variants,
    0,
  );
  const rows = Math.ceil(cells / columns);

  const width = columns * cell.w;
  const canvas = createCanvas(width, 62 + Math.max(1, rows) * cell.h);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8faf8';
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = '#243d31';
  context.font = 'bold 22px sans-serif';
  context.fillText('Garden Studio · elevated asset QA', 20, 32);
  context.fillStyle = '#6b776c';
  context.font = '12px sans-serif';
  context.fillText(
    `Drawn at ${pxPerMetre} px/m on the footprint each asset claims. The cross is the anchor: an ` +
      'object whose foot is off the line will float.',
    20, 50,
  );

  let index = 0;
  for (const id of families) {
    const family: AssetFamily = ASSET_FAMILIES[id];
    const frame = elevatedFrame(family);
    const anchor = assetAnchor(id);

    const generated = new Map(catalogueVariants(id).map((entry) => [entry.variant, entry]));

    for (let variant = 1; variant <= family.variants; variant += 1) {
      const entry = generated.get(variant);
      const column = index % columns;
      const row = Math.floor(index / columns);
      index += 1;

      const left = column * cell.w;
      const top = 62 + row * cell.h;
      context.fillStyle = (column + row) % 2 ? '#eef1ed' : '#ffffff';
      context.fillRect(left, top, cell.w, cell.h);

      /* The ground point, low in the cell: a lifted asset reaches up the screen, not down. */
      const stand = { x: left + cell.w / 2, y: top + cell.h * 0.62 };

      // The footprint the geometry would give it, drawn as the ground it has to stand on.
      context.strokeStyle = '#b9c4ba';
      context.lineWidth = 1;
      context.setLineDash([4, 3]);
      context.strokeRect(
        stand.x - (family.metres.w * pxPerMetre) / 2,
        stand.y - (family.metres.h * pxPerMetre) / 2,
        family.metres.w * pxPerMetre,
        family.metres.h * pxPerMetre,
      );
      context.setLineDash([]);

      const file = entry ? resolve('public/assets', entry.file) : null;
      if (file && existsSync(file)) {
        const image = await loadImage(file);
        const drawnWidth = frame.w * pxPerMetre;
        const drawnHeight = frame.h * pxPerMetre;
        context.drawImage(
          image,
          stand.x - anchor.x * drawnWidth,
          stand.y - anchor.y * drawnHeight,
          drawnWidth,
          drawnHeight,
        );
      } else {
        context.fillStyle = '#c2524a';
        context.font = '11px sans-serif';
        context.fillText('not generated', stand.x - 34, stand.y);
      }

      // The anchor, over the top of everything, because it is what is being checked.
      context.strokeStyle = '#c2524a';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(stand.x - 7, stand.y);
      context.lineTo(stand.x + 7, stand.y);
      context.moveTo(stand.x, stand.y - 7);
      context.lineTo(stand.x, stand.y + 7);
      context.stroke();

      context.fillStyle = '#243d31';
      context.font = '11px sans-serif';
      context.fillText(`${id} · ${variant}`, left + 10, top + cell.h - 24);
      context.fillStyle = '#6b776c';
      context.font = '10px sans-serif';
      context.fillText(
        `${family.metres.w} × ${family.metres.h} m · ${family.heightMetres} m tall` +
          (entry?.footAlpha !== undefined ? ` · foot ${entry.footAlpha}` : ''),
        left + 10, top + cell.h - 10,
      );
    }
  }

  writeFileSync(resolve(output, 'asset-elevated-qa.png'), canvas.toBuffer('image/png'));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
