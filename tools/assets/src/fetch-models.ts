import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, type Primitive } from '@gltf-transform/core';
import { compressGeometry, createIO } from '@garden-studio/model-pipeline';
import { MeshoptSimplifier } from 'meshoptimizer';
import {
  FURNITURE_MODELS,
  FURNITURE_TRIANGLE_BUDGET,
  furnitureModelFile,
  type Composition,
  type FurnitureModelKey,
  type ModelSource,
} from '../../../apps/web/src/lib/structures/furniture/model-spec';
import {
  diningLayout,
  loungeLayout,
  TABLE,
  type Facing,
  type LayoutRect,
} from '../../../apps/web/src/lib/structures/furniture-layout';
import { SYMBOLS } from '../../../packages/schema/src/plan/symbols';

/**
 * Fetches, composes and packs the 3D view's furniture models.
 *
 *     pnpm --filter @garden-studio/asset-tool fetch:models [--only <key>] [--force] [--audit]
 *
 * For each key in `furniture/model-spec.ts`:
 *
 * 1. **Download** the Poly Haven `.gltf` and what it includes into `raw/models/` (gitignored), and
 *    refuse any file whose md5 is not the one Poly Haven publishes — the `.gltf` against the spec's
 *    pin, so a re-export cannot slip in unnoticed.
 * 2. **Normalise** each source to the convention the AR document fixes: metres, +Y up, the base
 *    centred on the origin, and the **back towards −Z so the front faces +Z**. Which way a chair or a
 *    sofa faces is *measured* — its tall parts are its back — not typed, and a symmetric piece such as
 *    a table is left as it was.
 * 3. **Compose** a set at the places `furniture-layout.ts` gives, which are the places the drawn
 *    boxes use: a table fitted into its rectangle with its top at `TABLE`, a chair at every place
 *    turned to face it; a sofa against the back and a low table in front.
 * 4. **Simplify** to the AR budget (5k triangles), with meshoptimizer.
 * 5. **Lay texture coordinates in metres**, the grain along each member's longest side, face by face —
 *    the same rule `partGeometry` follows — and drop the source's textures: the 3D material library
 *    dresses the piece in whatever the user chose.
 * 6. **Write a GLB** under `apps/web/public/models/furniture/`, compressed with meshopt (never Draco,
 *    whose decoder comes from a CDN) and quantised, and record it in `furniture-models.json`. The
 *    reader, the writer and the compression are `@garden-studio/model-pipeline`'s, shared with the
 *    library models, so both kinds of GLB are written the one way.
 *
 * `--audit` exits non-zero if a model is missing, has drifted from the manifest, or is over budget.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RAW_DIR = join(HERE, '..', 'raw', 'models');
const PUBLIC = join(REPO, 'apps', 'web', 'public');
const MANIFEST = join(
  REPO,
  'apps',
  'web',
  'src',
  'lib',
  'structures',
  'furniture',
  'furniture-models.json',
);
const POLY_HAVEN_API = 'https://api.polyhaven.com';
const USER_AGENT = { 'User-Agent': 'garden-studio-asset-tool' };

interface Options {
  force: boolean;
  audit: boolean;
  only: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { force: false, audit: false, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--force') options.force = true;
    else if (arg === '--audit') options.audit = true;
    else if (arg === '--only') options.only = argv[++i] ?? null;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return options;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

/* ---------------------------------------------------------------- manifest */

interface ManifestEntry {
  key: FurnitureModelKey;
  file: string;
  bytes: number;
  sha256: string;
  triangles: number;
  /** Width, height and depth in metres of what the model was composed to fill. */
  naturalSize: [number, number, number];
  pivot: 'base-centre';
  front: '+z';
  /** Material slots, by primitive: every piece here is one slot, dressed at run time. */
  slots: ['finish'];
  maxTexturePx: 0;
  licence: 'CC0-1.0';
  sources: { asset: string; author: string; page: string; md5: string }[];
  fetchedAt: string;
}

interface Manifest {
  version: 1;
  models: Partial<Record<FurnitureModelKey, ManifestEntry>>;
}

function readManifest(): Manifest {
  if (!existsSync(MANIFEST)) return { version: 1, models: {} };
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
}

/* ---------------------------------------------------------------- download */

type GltfFiles = {
  gltf: Record<
    string,
    { gltf: { url: string; md5: string; include?: Record<string, { url: string; md5: string }> } }
  >;
};

async function fetchSource(source: ModelSource, options: Options): Promise<string> {
  const dir = join(RAW_DIR, source.asset);
  const gltfPath = join(dir, `${source.asset}.gltf`);
  if (!existsSync(gltfPath) || options.force) {
    const response = await fetch(`${POLY_HAVEN_API}/files/${source.asset}`, {
      headers: USER_AGENT,
    });
    if (!response.ok) throw new Error(`${source.asset}: Poly Haven answered ${response.status}`);
    const entry = ((await response.json()) as GltfFiles).gltf['1k']?.gltf;
    if (!entry) throw new Error(`${source.asset} has no 1k glTF`);
    if (entry.md5 !== source.md5) {
      throw new Error(
        `${source.asset}: Poly Haven now publishes md5 ${entry.md5}; the spec pins ${source.md5}`,
      );
    }
    const files: [string, { url: string; md5: string }][] = [
      [`${source.asset}.gltf`, entry],
      ...Object.entries(entry.include ?? {}),
    ];
    for (const [path, file] of files) {
      const out = join(dir, path);
      if (existsSync(out) && md5(readFileSync(out)) === file.md5) continue;
      console.log(`    downloading ${file.url}`);
      const bytes = Buffer.from(
        await (await fetch(file.url, { headers: USER_AGENT })).arrayBuffer(),
      );
      if (md5(bytes) !== file.md5)
        throw new Error(`${source.asset}: ${path} does not match its md5`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
    }
  }
  if (md5(readFileSync(gltfPath)) !== source.md5) {
    throw new Error(
      `${source.asset}: the cached .gltf does not match the pinned md5 ${source.md5}`,
    );
  }
  return gltfPath;
}

/* ---------------------------------------------------------------- meshes */

/** A triangle mesh in plain arrays: world-space positions and normals, and indices into them. */
interface Mesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** Every primitive in the scene, baked into world space and merged. */
async function readMesh(path: string): Promise<Mesh> {
  const document = await (await createIO()).read(path);
  const out: Mesh = { positions: [], normals: [], indices: [] };
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) appendPrimitive(out, primitive, m);
  }
  return out;
}

function appendPrimitive(out: Mesh, primitive: Primitive, m: readonly number[]): void {
  const position = primitive.getAttribute('POSITION')!;
  const normal = primitive.getAttribute('NORMAL');
  const start = out.positions.length / 3;
  const p = [0, 0, 0];
  const n = [0, 0, 1];
  for (let i = 0; i < position.getCount(); i += 1) {
    position.getElement(i, p);
    out.positions.push(
      m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
      m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
      m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
    );
    if (normal) normal.getElement(i, n);
    const x = m[0]! * n[0]! + m[4]! * n[1]! + m[8]! * n[2]!;
    const y = m[1]! * n[0]! + m[5]! * n[1]! + m[9]! * n[2]!;
    const z = m[2]! * n[0]! + m[6]! * n[1]! + m[10]! * n[2]!;
    const length = Math.hypot(x, y, z) || 1;
    out.normals.push(x / length, y / length, z / length);
  }
  const indices = primitive.getIndices();
  const count = indices ? indices.getCount() : position.getCount();
  for (let i = 0; i < count; i += 1) out.indices.push(start + (indices ? indices.getScalar(i) : i));
}

function bounds(mesh: Mesh): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k]!, mesh.positions[i + k]!);
      max[k] = Math.max(max[k]!, mesh.positions[i + k]!);
    }
  }
  return { min, max };
}

/**
 * Scaled (per axis), turned about Y by `yaw` and moved by `offset`. Normals take the inverse scale
 * and the turn, so a squashed table's top still faces up.
 */
function transform(
  mesh: Mesh,
  scale: [number, number, number],
  yaw: number,
  offset: [number, number, number],
): Mesh {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out: Mesh = { positions: [], normals: [], indices: [...mesh.indices] };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]! * scale[0];
    const y = mesh.positions[i + 1]! * scale[1];
    const z = mesh.positions[i + 2]! * scale[2];
    // A turn about +Y by `yaw`: +Z goes to (sin, 0, cos).
    out.positions.push(c * x + s * z + offset[0], y + offset[1], -s * x + c * z + offset[2]);
    const nx = mesh.normals[i]! / scale[0];
    const ny = mesh.normals[i + 1]! / scale[1];
    const nz = mesh.normals[i + 2]! / scale[2];
    const length = Math.hypot(nx, ny, nz) || 1;
    out.normals.push((c * nx + s * nz) / length, ny / length, (-s * nx + c * nz) / length);
  }
  return out;
}

function merge(meshes: Mesh[]): Mesh {
  const out: Mesh = { positions: [], normals: [], indices: [] };
  for (const mesh of meshes) {
    const start = out.positions.length / 3;
    out.positions.push(...mesh.positions);
    out.normals.push(...mesh.normals);
    out.indices.push(...mesh.indices.map((index) => index + start));
  }
  return out;
}

/**
 * The source stood on the origin with its back to −Z. Its back is where its tall parts are: the
 * centroid of everything in the top 30% of its height, measured against the middle of its plan. A
 * back more than 5 cm behind the middle is a back; a table, whose top is its whole plan, has none and
 * is not turned.
 */
function normalise(mesh: Mesh): { mesh: Mesh; size: [number, number, number]; turned: boolean } {
  const { min, max } = bounds(mesh);
  const centre = [(min[0]! + max[0]!) / 2, min[1]!, (min[2]! + max[2]!) / 2];
  const tall = max[1]! - (max[1]! - min[1]!) * 0.3;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.positions[i + 1]! < tall) continue;
    sum += mesh.positions[i + 2]! - centre[2]!;
    count += 1;
  }
  const back = count > 0 ? sum / count : 0;
  const turned = back > 0.05;
  const centred = transform(mesh, [1, 1, 1], 0, [-centre[0]!, -centre[1]!, -centre[2]!]);
  return {
    mesh: turned ? transform(centred, [1, 1, 1], Math.PI, [0, 0, 0]) : centred,
    size: [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!],
    turned,
  };
}

/* ---------------------------------------------------------------- composing */

/** A footprint position in the model's frame: X across, Z towards the front (b = 0). */
const inModel = (w: number, d: number, a: number, b: number): [number, number, number] => [
  a - w / 2,
  0,
  d / 2 - b,
];

/** Which way a chair turns to look the way the layout says: its front is +Z before it turns. */
const YAW: Record<Facing, number> = {
  'b-': 0,
  'b+': Math.PI,
  'a+': Math.PI / 2,
  'a-': -Math.PI / 2,
};

const rectCentre = (w: number, d: number, rect: LayoutRect) =>
  inModel(w, d, (rect.a0 + rect.a1) / 2, (rect.b0 + rect.b1) / 2);

/** The largest uniform scale at which a plan of `size` fits a rectangle. */
const contain = (size: [number, number, number], rect: LayoutRect) =>
  Math.min((rect.a1 - rect.a0) / size[0], (rect.b1 - rect.b0) / size[2]);

async function compose(
  key: FurnitureModelKey,
  composition: Composition,
  options: Options,
): Promise<{ mesh: Mesh; naturalSize: [number, number, number]; sources: ModelSource[] }> {
  const load = async (source: ModelSource) =>
    normalise(await readMesh(await fetchSource(source, options)));
  const footprint = SYMBOLS[key].footprint;
  if (footprint.kind !== 'rect')
    throw new Error(`${key}: only a rectangular footprint can be composed`);
  const { width: w, depth: d } = footprint;

  if (composition.kind === 'single') {
    const piece = await load(composition.piece);
    return { mesh: piece.mesh, naturalSize: piece.size, sources: [composition.piece] };
  }

  if (composition.kind === 'dining') {
    if (key !== 'dining-set-4' && key !== 'dining-set-6')
      throw new Error(`${key} is not a dining set`);
    const layout = diningLayout(key, w, d);
    const table = await load(composition.table);
    const chair = await load(composition.chair);
    const s = contain(table.size, layout.table);
    const parts = [
      transform(table.mesh, [s, TABLE / table.size[1], s], 0, rectCentre(w, d, layout.table)),
    ];
    for (const place of layout.chairs) {
      parts.push(
        transform(chair.mesh, [1, 1, 1], YAW[place.facing], inModel(w, d, place.a, place.b)),
      );
    }
    const height = Math.max(TABLE, chair.size[1]);
    return {
      mesh: merge(parts),
      naturalSize: [w, height, d],
      sources: [composition.table, composition.chair],
    };
  }

  const layout = loungeLayout(w, d);
  const sofa = await load(composition.sofa);
  const table = await load(composition.table);
  const s = contain(sofa.size, layout.sofa);
  // Against the back: the sofa's back face on the rectangle's back edge.
  const back = inModel(w, d, (layout.sofa.a0 + layout.sofa.a1) / 2, layout.sofa.b1);
  const sofaAt: [number, number, number] = [back[0], 0, back[2] + (sofa.size[2] * s) / 2];
  const t = contain(table.size, layout.table);
  const parts = [
    transform(sofa.mesh, [s, s, s], 0, sofaAt),
    transform(table.mesh, [t, t, t], 0, rectCentre(w, d, layout.table)),
  ];
  return {
    mesh: merge(parts),
    naturalSize: [w, Math.max(sofa.size[1] * s, table.size[1] * t), d],
    sources: [composition.sofa, composition.table],
  };
}

/* ---------------------------------------------------------------- simplifying */

async function simplify(mesh: Mesh, budget: number): Promise<Mesh> {
  if (mesh.indices.length / 3 <= budget) return mesh;
  await MeshoptSimplifier.ready;
  const positions = new Float32Array(mesh.positions);
  const source = new Uint32Array(mesh.indices);
  let error = 0.01;
  for (;;) {
    const [indices] = MeshoptSimplifier.simplify(source, positions, 3, budget * 3, error, []);
    if (indices.length / 3 <= budget || error > 0.2) return { ...mesh, indices: [...indices] };
    error *= 1.6;
  }
}

/* ---------------------------------------------------------------- texture coordinates */

/**
 * Texture coordinates in metres with the grain along each member: the triangles are grouped into
 * connected members (by welded position), each member's longest side is its grain, and each face is
 * projected onto the plane its normal is closest to — U along the grain where the grain lies in that
 * plane, and the cross-section where it does not. The result is a triangle soup, one set of
 * coordinates per face; `weld` joins what can be joined when the GLB is written.
 */
function metreUvs(mesh: Mesh): { positions: number[]; normals: number[]; uvs: number[] } {
  const keyOf = (i: number) =>
    `${Math.round(mesh.positions[i * 3]! * 1e4)},${Math.round(mesh.positions[i * 3 + 1]! * 1e4)},${Math.round(mesh.positions[i * 3 + 2]! * 1e4)}`;
  const ids = new Map<string, number>();
  const welded: number[] = [];
  for (let i = 0; i < mesh.positions.length / 3; i += 1) {
    const key = keyOf(i);
    if (!ids.has(key)) ids.set(key, ids.size);
    welded.push(ids.get(key)!);
  }
  const parent = [...Array(ids.size).keys()];
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = find(welded[mesh.indices[t]!]!);
    for (const k of [1, 2]) parent[find(welded[mesh.indices[t + k]!]!)] = a;
  }
  const extents = new Map<number, { min: number[]; max: number[] }>();
  for (let v = 0; v < welded.length; v += 1) {
    const root = find(welded[v]!);
    const box = extents.get(root) ?? {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    for (let k = 0; k < 3; k += 1) {
      box.min[k] = Math.min(box.min[k]!, mesh.positions[v * 3 + k]!);
      box.max[k] = Math.max(box.max[k]!, mesh.positions[v * 3 + k]!);
    }
    extents.set(root, box);
  }

  const out = { positions: [] as number[], normals: [] as number[], uvs: [] as number[] };
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const corners = [0, 1, 2].map((k) => mesh.indices[t + k]!);
    const p = corners.map((i) => [0, 1, 2].map((k) => mesh.positions[i * 3 + k]!));
    const u = [0, 1, 2].map((k) => p[1]![k]! - p[0]![k]!);
    const v = [0, 1, 2].map((k) => p[2]![k]! - p[0]![k]!);
    const face = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const facing = face.map(Math.abs);
    const across = facing.indexOf(Math.max(...facing));
    const box = extents.get(find(welded[corners[0]!]!))!;
    const sides = [0, 1, 2].map((k) => box.max[k]! - box.min[k]!);
    const grain = sides.indexOf(Math.max(...sides));
    const plane = [0, 1, 2].filter((k) => k !== across);
    const [first, second] = plane.includes(grain)
      ? [grain, plane.find((k) => k !== grain)!]
      : plane;
    for (const [c, i] of corners.entries()) {
      out.positions.push(...p[c]!);
      out.normals.push(mesh.normals[i * 3]!, mesh.normals[i * 3 + 1]!, mesh.normals[i * 3 + 2]!);
      out.uvs.push(p[c]![first!]!, p[c]![second!]!);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- writing */

async function writeGlb(
  key: FurnitureModelKey,
  mesh: Mesh,
): Promise<{ bytes: Uint8Array; triangles: number }> {
  const soup = metreUvs(mesh);
  const document = new Document();
  const buffer = document.createBuffer();
  const accessor = (array: number[], type: 'VEC2' | 'VEC3') =>
    document.createAccessor().setType(type).setArray(new Float32Array(array)).setBuffer(buffer);
  const material = document
    .createMaterial('finish')
    .setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(0.8)
    .setMetallicFactor(0);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessor(soup.positions, 'VEC3'))
    .setAttribute('NORMAL', accessor(soup.normals, 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(soup.uvs, 'VEC2'))
    .setMaterial(material);
  const node = document.createNode(key).setMesh(document.createMesh(key).addPrimitive(primitive));
  document.createScene(key).addChild(node);
  document.getRoot().setDefaultScene(document.getRoot().listScenes()[0]!);

  await compressGeometry(document);
  const bytes = await (await createIO()).writeBinary(document);
  return { bytes, triangles: soup.positions.length / 9 };
}

/* ---------------------------------------------------------------- audit */

function audit(): number {
  const manifest = readManifest();
  const failures: string[] = [];
  for (const key of Object.keys(FURNITURE_MODELS) as FurnitureModelKey[]) {
    const entry = manifest.models[key];
    if (!entry) {
      failures.push(`${key} is in the spec and not in the manifest`);
      continue;
    }
    const path = join(PUBLIC, entry.file);
    if (!existsSync(path)) failures.push(`missing ${entry.file}`);
    else if (sha256(readFileSync(path)) !== entry.sha256)
      failures.push(`${entry.file} has drifted`);
    if (entry.triangles > FURNITURE_TRIANGLE_BUDGET)
      failures.push(`${key} has ${entry.triangles} triangles`);
  }
  const total = Object.values(manifest.models).reduce((sum, entry) => sum + (entry?.bytes ?? 0), 0);
  console.log(
    `Furniture models: ${Object.keys(manifest.models).length}, ${(total / 1e3).toFixed(0)} kB`,
  );
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  return failures.length === 0 ? 0 : 1;
}

/* ---------------------------------------------------------------- main */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.audit) {
    process.exitCode = audit();
    return;
  }
  const manifest = readManifest();
  for (const [key, composition] of Object.entries(FURNITURE_MODELS) as [
    FurnitureModelKey,
    Composition,
  ][]) {
    if (options.only && options.only !== key) continue;
    console.log(`  ${key}`);
    const composed = await compose(key, composition, options);
    const simplified = await simplify(composed.mesh, FURNITURE_TRIANGLE_BUDGET);
    const { bytes, triangles } = await writeGlb(key, simplified);
    const file = furnitureModelFile(key);
    mkdirSync(dirname(join(PUBLIC, file)), { recursive: true });
    writeFileSync(join(PUBLIC, file), bytes);
    manifest.models[key] = {
      key,
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      triangles,
      naturalSize: composed.naturalSize.map((value) => Number(value.toFixed(4))) as [
        number,
        number,
        number,
      ],
      pivot: 'base-centre',
      front: '+z',
      slots: ['finish'],
      maxTexturePx: 0,
      licence: 'CC0-1.0',
      sources: composed.sources.map((source) => ({
        asset: source.asset,
        author: source.author,
        page: `https://polyhaven.com/a/${source.asset}`,
        md5: source.md5,
      })),
      fetchedAt: new Date().toISOString(),
    };
    console.log(`    ${triangles} triangles, ${(bytes.length / 1e3).toFixed(0)} kB`);
  }
  for (const key of Object.keys(manifest.models) as FurnitureModelKey[]) {
    if (!(key in FURNITURE_MODELS)) delete manifest.models[key];
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${MANIFEST}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
