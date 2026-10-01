import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { NodeIO, getBounds, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  imageTo3dRequest,
  MeshyClient,
  MeshyError,
  type MeshyTask,
} from '../src/model-assets/meshy.client';
import { readMeshyKey, sleep, withoutSignedUrls } from './meshy-common';

/** The fields of a task the spike prints that the service has no use for. */
type SpikeTask = MeshyTask & { preceding_tasks?: number; created_at?: number };

/**
 * Phase 0: one reference image in, one Meshy GLB out, and a measurement of what came back.
 *
 * The Meshy documentation says nothing about the scale, the up axis or the origin of a model when
 * `auto_size` is off, and on Meshy 6 and 7 it does not remesh unless asked, so the raw polycount is
 * undocumented too. Everything the Phase 1 pipeline does to a model — which way to turn it, where
 * to put its pivot, how far to scale it, whether it fits the AR budgets — rests on those four
 * facts. This script finds them out by looking, and writes what it saw to `report.json` beside the
 * files.
 *
 * **It spends credits** (30 per run on `meshy-6` or `meshy-7.1`, 15 on `meshy-6-lite`), so it is
 * run by hand and never by the suite. The task id is written to disk the moment Meshy returns it,
 * so an interrupted run is resumed with `--resume` rather than paid for twice — Meshy keeps the
 * result for three days, and after that it is gone.
 *
 * ```
 *   pnpm --filter @garden-studio/api spike:meshy --image <png> [--model meshy-7.1] [--label gazebo]
 *   pnpm --filter @garden-studio/api spike:meshy --resume <taskId> --model meshy-7.1 --label gazebo
 *   pnpm --filter @garden-studio/api spike:meshy --inspect <dir>      # re-measure, no network
 * ```
 *
 * Output goes to `apps/api/storage/models/spike/<label>-<model>/`, which is gitignored.
 */

const STORAGE = resolve(__dirname, '..', 'storage', 'models', 'spike');
const POLL_MS = 8_000;
const GIVE_UP_MS = 30 * 60_000;
const MAX_GLB_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The request under test. Remeshing is asked for explicitly, because Meshy 6 and 7 default it off
 * and the AR budget is 15k triangles for a hero object; triangles because a renderer draws them;
 * PBR because the structure editor's lighting is physically based; `remove_lighting` because a
 * shadow baked into the texture would fight the plan's own sun. `auto_size` is deliberately off:
 * the plan knows the real size, and the point is to see what Meshy does without being told.
 */
function requestFor(imageDataUri: string, model: string) {
  // The service's own request, so the spike measures exactly what the lab sends.
  return imageTo3dRequest(imageDataUri, model, 15_000);
}

interface Options {
  image: string | null;
  model: string;
  label: string;
  resume: string | null;
  inspect: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    image: null,
    model: 'meshy-7.1',
    label: 'gazebo',
    resume: null,
    inspect: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--image') options.image = argv[++i] ?? null;
    else if (arg === '--model') options.model = argv[++i] ?? options.model;
    else if (arg === '--label') options.label = argv[++i] ?? options.label;
    else if (arg === '--resume') options.resume = argv[++i] ?? null;
    else if (arg === '--inspect') options.inspect = argv[++i] ?? null;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.inspect) {
    await measure(resolve(options.inspect));
    return;
  }

  const client = new MeshyClient(readMeshyKey());
  const dir = join(STORAGE, `${options.label}-${options.model}`);
  mkdirSync(dir, { recursive: true });
  const taskIdFile = join(dir, 'task-id.txt');

  let taskId = options.resume;
  if (!taskId && existsSync(taskIdFile)) {
    taskId = readFileSync(taskIdFile, 'utf8').trim();
    console.log(`  resuming ${taskId} (found in ${taskIdFile})`);
  }

  if (!taskId) {
    if (!options.image) throw new Error('--image <png> is required for a new task');
    const imagePath = resolve(options.image);
    const bytes = readFileSync(imagePath);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Reference image over 20 MB');
    const mime = extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    const request = requestFor(`data:${mime};base64,${bytes.toString('base64')}`, options.model);

    writeFileSync(
      join(dir, 'request.json'),
      JSON.stringify(
        { ...request, image_url: `<${basename(imagePath)}, ${bytes.length} bytes>` },
        null,
        2,
      ),
    );
    writeFileSync(join(dir, `reference${extname(imagePath)}`), bytes);

    console.log(`  balance before: ${await client.balance()} credits`);
    taskId = await client.createImageTo3d(request);
    writeFileSync(taskIdFile, `${taskId}\n`);
    console.log(`  task ${taskId} created on ${options.model}`);
  }

  const task = await poll(client, taskId);
  writeFileSync(join(dir, 'task.json'), JSON.stringify(withoutSignedUrls(task), null, 2));

  if (task.status !== 'SUCCEEDED') {
    console.log(`  ✗ ${task.status}: ${task.task_error?.message ?? 'no message'}`);
    process.exitCode = 1;
    return;
  }

  const glbUrl = task.model_urls?.glb;
  if (!glbUrl) throw new Error('SUCCEEDED with no GLB url');
  writeFileSync(join(dir, 'model.glb'), await client.download(glbUrl, MAX_GLB_BYTES));

  for (const [view, url] of Object.entries(task.thumbnail_urls ?? {})) {
    if (url)
      writeFileSync(join(dir, `thumb-${view}.png`), await client.download(url, MAX_IMAGE_BYTES));
  }
  if (task.thumbnail_url) {
    writeFileSync(
      join(dir, 'thumb.png'),
      await client.download(task.thumbnail_url, MAX_IMAGE_BYTES),
    );
  }

  console.log(
    `  ✓ downloaded — ${task.consumed_credits ?? '?'} credits, ` +
      `${Math.round(((task.finished_at ?? 0) - (task.created_at ?? 0)) / 1000)} s end to end`,
  );
  await measure(dir);
}

async function poll(client: MeshyClient, taskId: string): Promise<SpikeTask> {
  const started = Date.now();
  let last = '';
  for (;;) {
    const task: SpikeTask = await client.getImageTo3d(taskId);
    const line = `${task.status} ${task.progress}%${
      task.status === 'PENDING' && task.preceding_tasks ? ` (${task.preceding_tasks} ahead)` : ''
    }`;
    if (line !== last) {
      console.log(`  ${new Date().toISOString().slice(11, 19)}  ${line}`);
      last = line;
    }
    if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELED') {
      return task;
    }
    if (Date.now() - started > GIVE_UP_MS) {
      throw new Error(`Still ${task.status} after 30 minutes. Re-run with --resume ${taskId}.`);
    }
    await sleep(POLL_MS);
  }
}

/**
 * Everything the Phase 1 pipeline needs to know about a Meshy GLB, measured.
 *
 * The up-axis test is the one that needs explaining. glTF is +Y up by specification, but whether
 * Meshy honours that is undocumented, and a gazebo's bounding box is nearly a cube, so the box
 * cannot say. The shape can: a hipped roof ends in a point and four posts end far apart, so the
 * vertices within a few per cent of the *top* of the true up axis are bunched together, and those
 * at the bottom are spread across the whole footprint. `extremes` reports that spread for all six
 * directions; the up axis is the one whose top is tight and whose bottom is wide.
 */
async function measure(dir: string): Promise<void> {
  const file = join(dir, 'model.glb');
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(file);
  const root = document.getRoot();
  const bytes = readFileSync(file).length;

  const scenes = root.listScenes();
  const bounds = scenes.map((scene) => getBounds(scene));

  let triangles = 0;
  let vertices = 0;
  const primitiveModes = new Set<number>();
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitiveModes.add(primitive.getMode());
      const position = primitive.getAttribute('POSITION');
      const count = primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
      vertices += position?.getCount() ?? 0;
    }
  }

  const nodes = root.listNodes().map((node) => ({
    name: node.getName(),
    mesh: node.getMesh()?.getName() ?? null,
    translation: node.getTranslation(),
    rotation: node.getRotation(),
    scale: node.getScale(),
  }));

  const textures = root.listTextures().map((texture) => ({
    name: texture.getName(),
    uri: texture.getURI(),
    mimeType: texture.getMimeType(),
    size: texture.getSize(),
    bytes: texture.getImage()?.byteLength ?? 0,
  }));

  const materials = root.listMaterials().map((material) => ({
    name: material.getName(),
    baseColorFactor: material.getBaseColorFactor(),
    metallicFactor: material.getMetallicFactor(),
    roughnessFactor: material.getRoughnessFactor(),
    alphaMode: material.getAlphaMode(),
    doubleSided: material.getDoubleSided(),
    baseColorTexture: material.getBaseColorTexture()?.getName() ?? null,
    metallicRoughnessTexture: material.getMetallicRoughnessTexture()?.getName() ?? null,
    normalTexture: material.getNormalTexture()?.getName() ?? null,
    occlusionTexture: material.getOcclusionTexture()?.getName() ?? null,
    emissiveTexture: material.getEmissiveTexture()?.getName() ?? null,
    extensions: material.listExtensions().map((extension) => extension.extensionName),
  }));

  const report = {
    file: basename(file),
    bytes,
    generator: root.getAsset().generator ?? null,
    extensionsUsed: root.listExtensionsUsed().map((extension) => extension.extensionName),
    counts: {
      scenes: scenes.length,
      nodes: root.listNodes().length,
      meshes: root.listMeshes().length,
      materials: root.listMaterials().length,
      textures: root.listTextures().length,
      animations: root.listAnimations().length,
      skins: root.listSkins().length,
      cameras: root.listCameras().length,
      triangles,
      vertices,
      primitiveModes: [...primitiveModes],
    },
    bounds: bounds.map(({ min, max }) => ({
      min: min.map(round),
      max: max.map(round),
      size: max.map((value, axis) => round(value - min[axis]!)),
      centre: max.map((value, axis) => round((value + min[axis]!) / 2)),
    })),
    extremes: extremes(document),
    nodes,
    materials,
    textures,
  };

  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));

  const box = report.bounds[0];
  console.log(`\n  ${dir}`);
  console.log(`  ${(bytes / 1024 / 1024).toFixed(2)} MB, generator ${report.generator}`);
  console.log(`  extensions ${report.extensionsUsed.join(', ') || 'none'}`);
  console.log(
    `  ${report.counts.meshes} meshes, ${report.counts.materials} materials, ` +
      `${report.counts.textures} textures, ${triangles} triangles, ${vertices} vertices`,
  );
  if (box) {
    console.log(`  bounds min [${box.min.join(', ')}] max [${box.max.join(', ')}]`);
    console.log(`  size [${box.size.join(', ')}]  centre [${box.centre.join(', ')}]`);
  }
  for (const texture of textures) {
    console.log(
      `  texture ${texture.name || '(unnamed)'} ${texture.mimeType} ` +
        `${texture.size?.join('×') ?? '?'} ${(texture.bytes / 1024).toFixed(0)} KB`,
    );
  }
  console.log(
    '  spread of the vertices within 3% of each extreme (a tight top means that axis is up):',
  );
  for (const row of report.extremes) {
    console.log(`    ${row.direction}  ${row.count} vertices, spread ${row.spread}`);
  }
  console.log('');
}

/**
 * For each of ±X, ±Y, ±Z: the vertices within 3% of the extreme along that axis, and how widely
 * they are spread across the other two axes (the larger extent of the two, in model units).
 */
function extremes(document: Document) {
  const points: [number, number, number][] = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const element: number[] = [];
      for (let i = 0; i < position.getCount(); i += 1) {
        position.getElement(i, element);
        points.push(transform(matrix, element as [number, number, number]));
      }
    }
  }

  const rows: { direction: string; count: number; spread: number }[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const values = points.map((point) => point[axis]!);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const band = (max - min) * 0.03;
    for (const sign of [1, -1] as const) {
      const edge = sign === 1 ? max : min;
      const near = points.filter((point) => Math.abs(point[axis]! - edge) <= band);
      const others = [0, 1, 2].filter((other) => other !== axis);
      const spread = Math.max(
        ...others.map((other) => {
          const along = near.map((point) => point[other]!);
          return along.length ? Math.max(...along) - Math.min(...along) : 0;
        }),
      );
      rows.push({
        direction: `${sign === 1 ? '+' : '-'}${'XYZ'[axis]}`,
        count: near.length,
        spread: round(spread),
      });
    }
  }
  return rows;
}

function transform(m: readonly number[], p: [number, number, number]): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

main().catch((error: unknown) => {
  if (error instanceof MeshyError) {
    console.error(`  ✗ Meshy ${error.status}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
