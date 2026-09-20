import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ASSET_FAMILIES,
  ASSET_IDS,
  elevatedFrame,
  type AssetFamily,
} from '../src/lib/materials/assets/asset-spec';
import { ASSET_SPEC_VERSION } from '../src/lib/materials/assets/asset-style';
import { catalogueEntries, catalogueVariants } from '../src/lib/materials/assets/catalogue';
import { assetAnchor } from '../src/lib/materials/assets/taxonomy';
import { assetQualityAudit } from '../src/lib/materials/assets/quality';
import { elevatedFamilyFor } from '../src/lib/materials/assets/material-assets';
import { buildRenderScene } from '../src/lib/render/build-scene';
import { QUALITY_FIXTURES, qualityScene } from '../src/lib/render/quality-fixtures';

/**
 * Offline source-art audit: no generation, network, or changes to the library.
 *
 * Two kinds of finding, and the exit code tells them apart. A **failure** is the library disagreeing
 * with itself — a catalogued file that is not on disk, an entry for a family the spec no longer
 * knows, two entries for one file, a family with fewer variants than it declares, a file whose
 * pixels are not the size the catalogue says, a defect the QA pass recorded, or elevated art in
 * the 2D Plan — and any failure exits non-zero so this can stand in a check. A **warning** is a
 * judgement worth a person's eye, printed and written to the report, and never a reason to fail.
 * The script used to print everything and exit zero, which meant nothing it found could stop a
 * commit.
 */

/** A shipped WebP larger than this is a mistake in processing, not a detailed picture. */
const MAX_FILE_BYTES = 1_500_000;

/** How far the foot of an elevated sprite may sit from its declared anchor, as a fraction of width. */
const ANCHOR_TOLERANCE = 0.08;

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
      camera: family.camera ?? 'plan',
      heightMetres: family.heightMetres,
      unrecorded,
      specVersions: [...new Set(variants.map((v) => v.generation?.specVersion ?? 'unversioned'))],
      missingFiles,
      framingWarnings: framingWarnings(id, family, variants),
      variants: variants.map((v) => ({
        variant: v.variant,
        meanColour: v.meanColour,
        opaqueRadiusRatio: v.opaqueRadiusRatio,
        seamScore: v.seamScore,
        footAlpha: v.footAlpha,
        opaqueBounds: v.opaqueBounds,
        model: v.generation?.model ?? v.provenance?.model ?? null,
        specVersion: v.generation?.specVersion ?? null,
        warnings: v.processed?.warnings ?? [],
        defects: v.processed?.defects ?? [],
      })),
    });
  }
  for (const row of rows) warnings.push(...row.framingWarnings);

  const fixtureCoverage = QUALITY_FIXTURES.map((fixture) => {
    const scene = buildRenderScene(qualityScene(fixture), { view: 'visualise' });
    const planPlants = new Map<string, { count: number; maxHeight: number }>();
    for (const plant of scene.plants) {
      if (!plant.assetId || (ASSET_FAMILIES[plant.assetId] as AssetFamily).camera === 'elevated')
        continue;
      const record = planPlants.get(plant.assetId) ?? { count: 0, maxHeight: 0 };
      record.count++;
      record.maxHeight = Math.max(record.maxHeight, plant.height);
      planPlants.set(plant.assetId, record);
    }
    /*
     * The mirror of `planCameraPlanting`, and the one this report was missing.
     *
     * That field asks whether Visualise is still drawing flat art — a gap in the twin table,
     * which degrades gracefully. This asks the opposite and far worse question: whether the 2D
     * Plan is drawing *elevated* art, which is not a gap but a wrong drawing. It went unasked,
     * and the Plan tab shipped a commit built at `view: 'visualise'` with every test passing.
     * Anything but an empty list here is a defect, and now a failure.
     */
    const planScene = buildRenderScene(qualityScene(fixture), { view: 'plan' });
    const elevatedInPlan = planScene.plants
      .filter(
        (plant) =>
          plant.assetId && (ASSET_FAMILIES[plant.assetId] as AssetFamily).camera === 'elevated',
      )
      .map((plant) => ({ id: plant.id, assetId: plant.assetId }));
    for (const plant of elevatedInPlan)
      failures.push(`${fixture}: elevated art ${plant.assetId} drawn in the 2D Plan (${plant.id})`);

    return {
      fixture,
      sampledPlants: scene.plants.length,
      planCameraPlanting: [...planPlants].map(([id, value]) => ({ id, ...value })),
      elevatedInPlanScene: elevatedInPlan,
      planSceneStack: planScene.stack.length,
      standingFallbacks: scene.stack
        .filter((node) => node.kind === 'object' && !elevatedFamilyFor(node.item.element))
        .map((node) => ({ id: node.id, layer: node.visualLayer })),
    };
  });

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
    fixtureCoverage,
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

  await elevatedSheet(output);

  for (const failure of failures) console.log(`  FAIL  ${failure}`);
  for (const warning of warnings) console.log(`  warn  ${warning}`);

  /*
   * The one line a person actually reads, not only the JSON. The whole lesson of the elevated-in-
   * plan check is that a wrong camera is invisible unless something says it out loud.
   */
  console.log(
    JSON.stringify({
      files: report.files,
      families: report.families,
      failures: failures.length,
      warnings: warnings.length,
      unrecorded: report.unrecorded,
      drawnToCurrentSpec: report.drawnToCurrentSpec,
      incompleteFamilies: report.incompleteFamilies,
      elevated: report.rows.filter((r) => r.camera === 'elevated').length,
      elevatedInPlan: report.fixtureCoverage.flatMap((f) => f.elevatedInPlanScene),
      planCameraPlantingInVisualise: report.fixtureCoverage.reduce(
        (total, f) => total + f.planCameraPlanting.reduce((n, p) => n + p.count, 0),
        0,
      ),
    }),
  );

  if (failures.length > 0) process.exitCode = 1;
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
  const anchor = assetAnchor(id as keyof typeof ASSET_FAMILIES);

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
     * agree with the manifest — including whether the object stands where the anchor says it does.
     */
    if (entry.opaqueBounds) {
      const { minX, maxX, minY, maxY } = entry.opaqueBounds;
      if (Math.max(maxX - minX, maxY - minY) < 0.95) {
        warnings.push(`${id}-${entry.variant}: fills neither axis of its frame — reprocess it`);
      }
      const footCentre = (minX + maxX) / 2;
      if (Math.abs(footCentre - anchor.x) > ANCHOR_TOLERANCE) {
        warnings.push(
          `${id}-${entry.variant}: opaque pixels centre at ${footCentre.toFixed(2)} but the anchor is at ` +
            `${anchor.x.toFixed(2)} — it will stand off its footprint`,
        );
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
    (id) =>
      (ASSET_FAMILIES[id] as AssetFamily).camera === 'elevated' &&
      (ASSET_FAMILIES[id] as AssetFamily).kind === 'sprite',
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
    20,
    50,
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
          (entry?.footAlpha !== undefined ? ` · foot ${entry.footAlpha}` : '') +
          (entry?.generation ? ` · spec ${entry.generation.specVersion}` : ''),
        left + 10,
        top + cell.h - 10,
      );
    }
  }

  writeFileSync(resolve(output, 'asset-elevated-qa.png'), canvas.toBuffer('image/png'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
