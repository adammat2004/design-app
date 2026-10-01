import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import {
  PBR_BYTE_BUDGET,
  PBR_SETS,
  SKY_HDRI,
  hdriFile,
  pbrFile,
  type HdriSpec,
  type PbrSetId,
  type PbrSetSpec,
} from '../../../apps/web/src/lib/structures/pbr/pbr-spec';

/**
 * Fetches the 3D view's photographic library from CC0 sources and packs it.
 *
 *     pnpm --filter @garden-studio/asset-tool fetch:pbr [--only <set id>] [--force] [--audit]
 *
 * The 3D twin of `generate.ts`: the specification is `apps/web/src/lib/structures/pbr/pbr-spec.ts`,
 * downloads are kept under `raw/pbr/` (gitignored) so re-packing costs nothing, the files the app
 * ships go to `apps/web/public/assets/`, and `pbr-catalogue.json` beside the app's code records what
 * was written — source, author, licence, a sha256 of every shipped file, and the numbers the renderer
 * calibrates by.
 *
 * **Pinned.** Every download is checked against the spec's checksum and refused if it differs: a CC0
 * library can re-export an asset, and a material that quietly changed would change every render with
 * no line in the diff saying why.
 *
 * **Measured, not typed.** Each set's mean linear colour and mean roughness are read off the packed
 * pixels and written to the catalogue, because the renderer divides a finish's colour and roughness
 * by them — so the average of the textured surface is the finish's swatch, and the texture is only
 * the variation round it.
 *
 * `--audit` reads the catalogue and exits non-zero if a file is missing, has drifted, or the library
 * is over its byte budget. No network is needed at runtime, ever: a missing file is the flat drawing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RAW_DIR = join(HERE, '..', 'raw', 'pbr');
const PUBLIC_ASSETS = join(REPO, 'apps', 'web', 'public', 'assets');
const CATALOGUE = join(
  REPO,
  'apps',
  'web',
  'src',
  'lib',
  'structures',
  'pbr',
  'pbr-catalogue.json',
);
const POLY_HAVEN_API = 'https://api.polyhaven.com';
const AMBIENT_CG_GET = 'https://ambientcg.com/get?file=';

/** Every packed map is this square. The AR budget's texture ceiling, and plenty at 3D-view distances. */
const SIZE = 1024;
/** A drawn map needs far less: it is a smooth periodic profile. */
const GENERATED_SIZE = 512;
/**
 * The mean linear luminance an albedo is normalised to. Keeps the calibration factor near one for
 * every finish — an 8-bit texture multiplied by fifteen to reach a pale aluminium bands visibly —
 * while leaving headroom so the brightest grain does not clip.
 */
const ALBEDO_MEAN = 0.3;

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

/* ---------------------------------------------------------------- catalogue */

interface FileRecord {
  file: string;
  bytes: number;
  sha256: string;
}

interface HdriRecord extends FileRecord {
  id: string;
  source: 'polyhaven';
  asset: string;
  resolution: string;
  licence: 'CC0-1.0';
  author: string;
  page: string;
  fetchedAt: string;
}

interface SetRecord {
  id: PbrSetId;
  source: 'polyhaven' | 'ambientcg' | 'generated';
  asset: string | null;
  author: string;
  page: string | null;
  licence: 'CC0-1.0';
  tileSizeM: number;
  px: number;
  files: { albedo: FileRecord | null; normal: FileRecord; orm: FileRecord };
  /** Linear RGB, 0–1, of the packed albedo; null for a detail-only set. */
  meanLinearColour: [number, number, number] | null;
  /** Mean of the roughness channel, 0–1. */
  meanRoughness: number;
  fetchedAt: string;
}

interface Catalogue {
  version: 1;
  hdri: HdriRecord | null;
  sets: Partial<Record<PbrSetId, SetRecord>>;
}

function readCatalogue(): Catalogue {
  if (!existsSync(CATALOGUE)) return { version: 1, hdri: null, sets: {} };
  const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as Partial<Catalogue>;
  return { version: 1, hdri: catalogue.hdri ?? null, sets: catalogue.sets ?? {} };
}

function writeCatalogue(catalogue: Catalogue): void {
  writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': 'garden-studio-asset-tool' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { 'User-Agent': 'garden-studio-asset-tool' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** A raw download, reused from `raw/pbr/` unless `--force`. */
async function cached(name: string, url: () => Promise<string>, options: Options): Promise<Buffer> {
  const path = join(RAW_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && !options.force) return readFileSync(path);
  const source = await url();
  console.log(`    downloading ${source}`);
  const bytes = await download(source);
  writeFileSync(path, bytes);
  return bytes;
}

function writeShipped(file: string, bytes: Buffer): FileRecord {
  const out = join(PUBLIC_ASSETS, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  return { file, bytes: bytes.length, sha256: sha256(bytes) };
}

/* ---------------------------------------------------------------- HDRI */

type PolyHavenFiles = Record<string, Record<string, Record<string, { url: string; md5: string }>>>;

async function fetchHdri(spec: HdriSpec, options: Options): Promise<HdriRecord> {
  const target = hdriFile(spec);
  const bytes = await cached(
    `${spec.asset}_${spec.resolution}.hdr`,
    async () => {
      const files = await getJson<PolyHavenFiles>(`${POLY_HAVEN_API}/files/${spec.asset}`);
      const entry = files.hdri?.[spec.resolution]?.hdr;
      if (!entry) throw new Error(`${spec.asset} has no ${spec.resolution} .hdr`);
      return entry.url;
    },
    options,
  );
  if (md5(bytes) !== spec.md5) {
    throw new Error(`${spec.id}: the downloaded bytes do not match the pinned md5 ${spec.md5}`);
  }
  return {
    id: spec.id,
    source: spec.source,
    asset: spec.asset,
    resolution: spec.resolution,
    licence: spec.licence,
    author: spec.author,
    page: spec.page,
    ...writeShipped(target, bytes),
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- sources */

/** The maps a source provides, as encoded images. `arm` is Poly Haven's packed AO/rough/metal. */
interface SourceMaps {
  colour: Buffer;
  normal: Buffer;
  roughness?: Buffer;
  ao?: Buffer;
  arm?: Buffer;
}

async function polyHavenMaps(
  spec: PbrSetSpec & { from: { source: 'polyhaven' } },
  options: Options,
): Promise<SourceMaps> {
  const { asset, md5: pinned } = spec.from;
  let files: PolyHavenFiles | null = null;
  const urlOf = async (map: string) => {
    files ??= await getJson<PolyHavenFiles>(`${POLY_HAVEN_API}/files/${asset}`);
    const entry = files[map]?.['1k']?.jpg;
    if (!entry) throw new Error(`${asset} has no 1k ${map}`);
    return entry.url;
  };
  const get = async (map: string, expected: string) => {
    const bytes = await cached(`${asset}/${map}_1k.jpg`, () => urlOf(map), options);
    if (md5(bytes) !== expected) {
      throw new Error(`${spec.id}: ${asset} ${map} does not match the pinned md5 ${expected}`);
    }
    return bytes;
  };
  return {
    colour: await get('Diffuse', pinned.diffuse),
    normal: await get('nor_gl', pinned.normal),
    arm: await get('arm', pinned.arm),
  };
}

async function ambientCgMaps(
  spec: PbrSetSpec & { from: { source: 'ambientcg' } },
  options: Options,
): Promise<SourceMaps> {
  const { asset, sha256: pinned } = spec.from;
  const zip = await cached(
    `${asset}_1K-JPG.zip`,
    async () => `${AMBIENT_CG_GET}${asset}_1K-JPG.zip`,
    options,
  );
  if (sha256(zip) !== pinned) {
    throw new Error(`${spec.id}: ${asset}_1K-JPG.zip does not match the pinned sha256 ${pinned}`);
  }
  const entries = unzipSync(new Uint8Array(zip));
  const map = (suffix: string): Buffer | undefined => {
    const name = `${asset}_1K-JPG_${suffix}.jpg`;
    return entries[name] ? Buffer.from(entries[name]) : undefined;
  };
  const colour = map('Color');
  const normal = map('NormalGL');
  const roughness = map('Roughness');
  if (!colour || !normal || !roughness) {
    throw new Error(`${asset}: the zip has no Color, NormalGL or Roughness map`);
  }
  return { colour, normal, roughness, ao: map('AmbientOcclusion') };
}

/* ---------------------------------------------------------------- packing */

type Raw = { data: Buffer; channels: number };

/** A map squared to `size`, turned a quarter if the set asks, as raw pixels. */
async function square(image: Buffer, rotate: boolean, channels: 1 | 3, size = SIZE): Promise<Raw> {
  let pipeline = sharp(image);
  if (rotate) pipeline = pipeline.rotate(90);
  pipeline = pipeline.resize(size, size, { fit: 'cover' });
  pipeline = channels === 1 ? pipeline.greyscale() : pipeline.removeAlpha().toColourspace('srgb');
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels };
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

/**
 * The colour map: optionally grey, then scaled in linear light so its mean luminance is
 * `ALBEDO_MEAN`. Returns the packed pixels and their measured mean linear colour.
 */
function packAlbedo(
  raw: Raw,
  desaturate: boolean,
): { data: Buffer; mean: [number, number, number] } {
  const { data, channels } = raw;
  const pixels = data.length / channels;
  const linear = new Float32Array(pixels * 3);
  let luminance = 0;
  for (let i = 0; i < pixels; i += 1) {
    let r = toLinear(data[i * channels]!);
    let g = toLinear(data[i * channels + 1]!);
    let b = toLinear(data[i * channels + 2]!);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (desaturate) r = g = b = y;
    linear[i * 3] = r;
    linear[i * 3 + 1] = g;
    linear[i * 3 + 2] = b;
    luminance += y;
  }
  const scale = ALBEDO_MEAN / Math.max(luminance / pixels, 1e-4);
  const out = Buffer.alloc(pixels * 3);
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels * 3; i += 1) {
    const value = toSrgb(linear[i]! * scale);
    out[i] = value;
    sum[i % 3]! += toLinear(value);
  }
  return {
    data: out,
    mean: sum.map((total) => Number((total / pixels).toFixed(5))) as [number, number, number],
  };
}

/**
 * The normal map, re-swizzled when the image was turned a quarter clockwise. A tangent-space
 * normal's in-plane part turns with the picture: in OpenGL terms (R right, G up) the new right is
 * the old up and the new up is the old left, so R′ = G and G′ = 1 − R. Turning the pixels without
 * turning the vectors lights every grain from the wrong side.
 */
function packNormal(raw: Raw, rotated: boolean): Buffer {
  const { data, channels } = raw;
  const pixels = data.length / channels;
  const out = Buffer.alloc(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    const r = data[i * channels]!;
    const g = data[i * channels + 1]!;
    out[i * 3] = rotated ? g : r;
    out[i * 3 + 1] = rotated ? 255 - r : g;
    out[i * 3 + 2] = data[i * channels + 2]!;
  }
  return out;
}

/** R ambient occlusion (white where the source has none), G roughness, B zero. */
function packOrm(ao: Raw | null, roughness: Raw): { data: Buffer; meanRoughness: number } {
  const pixels = roughness.data.length / roughness.channels;
  const out = Buffer.alloc(pixels * 3);
  let sum = 0;
  for (let i = 0; i < pixels; i += 1) {
    out[i * 3] = ao ? ao.data[i * ao.channels]! : 255;
    const rough = roughness.data[i * roughness.channels]!;
    out[i * 3 + 1] = rough;
    out[i * 3 + 2] = 0;
    sum += rough / 255;
  }
  return { data: out, meanRoughness: Number((sum / pixels).toFixed(5)) };
}

const webp = (data: Buffer, size: number, quality: number) =>
  sharp(data, { raw: { width: size, height: size, channels: 3 } })
    .webp({ quality })
    .toBuffer();

/** Split Poly Haven's packed `arm` into the AO and roughness channels `packOrm` takes. */
async function splitArm(
  arm: Buffer,
  rotate: boolean,
  size: number,
): Promise<{ ao: Raw; roughness: Raw }> {
  const raw = await square(arm, rotate, 3, size);
  const pixels = raw.data.length / raw.channels;
  const ao = Buffer.alloc(pixels);
  const roughness = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i += 1) {
    ao[i] = raw.data[i * raw.channels]!;
    roughness[i] = raw.data[i * raw.channels + 1]!;
  }
  return { ao: { data: ao, channels: 1 }, roughness: { data: roughness, channels: 1 } };
}

/**
 * Twin-wall polycarbonate's ribs as a normal map: ten across the tile, each a smooth rise and fall,
 * running along U (so the profile varies down the image, in the green channel). Roughness a flat
 * 0.3 — the sheet is glossy — and no occlusion.
 */
function flutes(size: number): { normal: Buffer; orm: Buffer; meanRoughness: number } {
  const ribs = 10;
  const slope = 0.35;
  const normal = Buffer.alloc(size * size * 3);
  const orm = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const phase = ((y + 0.5) / size) * ribs * 2 * Math.PI;
      const ny = -slope * Math.cos(phase);
      const length = Math.hypot(ny, 1);
      const i = (y * size + x) * 3;
      normal[i] = 128;
      normal[i + 1] = Math.round((0.5 + (0.5 * ny) / length) * 255);
      normal[i + 2] = Math.round((0.5 + 0.5 / length) * 255);
      orm[i] = 255;
      orm[i + 1] = Math.round(0.3 * 255);
      orm[i + 2] = 0;
    }
  }
  return { normal, orm, meanRoughness: 0.3 };
}

async function packSet(spec: PbrSetSpec, options: Options): Promise<SetRecord> {
  const size = spec.px ?? SIZE;
  const base = {
    id: spec.id,
    source: spec.from.source,
    asset: spec.from.source === 'generated' ? null : spec.from.asset,
    author: spec.author,
    page: spec.page ?? null,
    licence: spec.licence,
    tileSizeM: spec.tileSizeM,
    fetchedAt: new Date().toISOString(),
  };

  if (spec.from.source === 'generated') {
    const drawn = flutes(GENERATED_SIZE);
    return {
      ...base,
      px: GENERATED_SIZE,
      files: {
        albedo: null,
        normal: writeShipped(
          pbrFile(spec.id, 'normal'),
          await webp(drawn.normal, GENERATED_SIZE, 95),
        ),
        orm: writeShipped(pbrFile(spec.id, 'orm'), await webp(drawn.orm, GENERATED_SIZE, 90)),
      },
      meanLinearColour: null,
      meanRoughness: drawn.meanRoughness,
    };
  }

  const maps =
    spec.from.source === 'polyhaven'
      ? await polyHavenMaps(spec as PbrSetSpec & { from: { source: 'polyhaven' } }, options)
      : await ambientCgMaps(spec as PbrSetSpec & { from: { source: 'ambientcg' } }, options);
  const rotate = spec.rotate ?? false;

  const albedo = spec.detailOnly
    ? null
    : packAlbedo(await square(maps.colour, rotate, 3, size), spec.desaturate ?? false);
  const normal = packNormal(await square(maps.normal, rotate, 3, size), rotate);
  const { ao, roughness } = maps.arm
    ? await splitArm(maps.arm, rotate, size)
    : {
        ao: maps.ao ? await square(maps.ao, rotate, 1, size) : null,
        roughness: await square(maps.roughness!, rotate, 1, size),
      };
  const orm = packOrm(ao, roughness);

  return {
    ...base,
    px: size,
    files: {
      albedo: albedo
        ? writeShipped(pbrFile(spec.id, 'albedo'), await webp(albedo.data, size, 85))
        : null,
      normal: writeShipped(pbrFile(spec.id, 'normal'), await webp(normal, size, 92)),
      orm: writeShipped(pbrFile(spec.id, 'orm'), await webp(orm.data, size, 90)),
    },
    meanLinearColour: albedo?.mean ?? null,
    meanRoughness: orm.meanRoughness,
  };
}

/* ---------------------------------------------------------------- audit */

function records(catalogue: Catalogue): FileRecord[] {
  const out: FileRecord[] = [];
  if (catalogue.hdri) out.push(catalogue.hdri);
  for (const set of Object.values(catalogue.sets)) {
    if (!set) continue;
    if (set.files.albedo) out.push(set.files.albedo);
    out.push(set.files.normal, set.files.orm);
  }
  return out;
}

function audit(): number {
  const catalogue = readCatalogue();
  const failures: string[] = [];
  if (!catalogue.hdri) failures.push('no HDRI in the catalogue — run fetch:pbr');
  else if (catalogue.hdri.id !== SKY_HDRI.id) {
    failures.push(`the catalogue's sky is ${catalogue.hdri.id}; the spec asks for ${SKY_HDRI.id}`);
  }
  for (const spec of PBR_SETS) {
    const set = catalogue.sets[spec.id];
    if (!set) failures.push(`set ${spec.id} is in the spec and not in the catalogue`);
    else if (set.tileSizeM !== spec.tileSizeM)
      failures.push(`set ${spec.id} was packed at a different tile size`);
  }
  for (const id of Object.keys(catalogue.sets)) {
    if (!PBR_SETS.some((spec) => spec.id === id))
      failures.push(`catalogue set ${id} is not in the spec`);
  }

  const files = records(catalogue);
  for (const record of files) {
    const path = join(PUBLIC_ASSETS, record.file);
    if (!existsSync(path)) {
      failures.push(`missing ${record.file}`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
      failures.push(`${record.file} has drifted from the catalogue`);
    }
  }

  const total = files.reduce((sum, record) => sum + record.bytes, 0);
  if (total > PBR_BYTE_BUDGET) {
    failures.push(
      `the library is ${(total / 1e6).toFixed(1)} MB, over its ${PBR_BYTE_BUDGET / 1e6} MB budget`,
    );
  }
  console.log(`3D library: ${files.length} file(s), ${(total / 1e6).toFixed(1)} MB`);
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

  const catalogue = readCatalogue();
  console.log('Fetching the 3D view’s CC0 library');
  if (!options.only || options.only === SKY_HDRI.id) {
    console.log(`  ${SKY_HDRI.id}`);
    catalogue.hdri = await fetchHdri(SKY_HDRI, options);
  }
  for (const spec of PBR_SETS) {
    if (options.only && options.only !== spec.id) continue;
    console.log(`  ${spec.id}`);
    catalogue.sets[spec.id] = await packSet(spec, options);
  }
  // Drop anything the spec no longer names, so the catalogue never points at a set nobody asked for.
  for (const id of Object.keys(catalogue.sets) as PbrSetId[]) {
    if (!PBR_SETS.some((spec) => spec.id === id)) delete catalogue.sets[id];
  }
  writeCatalogue(catalogue);
  console.log(`Wrote ${CATALOGUE}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
