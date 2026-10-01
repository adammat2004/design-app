import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

/**
 * Draw a GLB *in its own axes*, with no correction applied — a diagnostic, written in Phase 0 of the
 * Meshy work and kept for checking every model before it is published.
 *
 * Meshy's thumbnails are rendered by Meshy's viewer, which may turn the model to present it, so
 * they cannot say which way the file's own axes point — and that is the question. This draws three
 * orthographic views exactly as a renderer that trusts glTF's +Y-up convention would see them:
 *
 * - **front**: looking along −Z (from +Z towards the origin), +X right, +Y up;
 * - **side**: looking along −X (from +X), −Z right, +Y up;
 * - **top**: looking down −Y, +X right, +Z down the page.
 *
 * Triangles are painted far to near and lit flat from the viewer's upper left, textured with the
 * base colour where the primitive has UVs and a texture (sampled at the triangle's centroid — a
 * diagnostic, not a render). A small axis key and the origin are drawn on each view, so "is the
 * base at y = 0" and "is the pivot centred" can be read straight off the picture.
 *
 * ```
 *   pnpm --filter @garden-studio/asset-tool render:glb <model.glb> <out.png>
 * ```
 */

const VIEW = 520;
const MARGIN = 40;

type Vec3 = [number, number, number];
interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  colour: [number, number, number];
}

async function main(): Promise<void> {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('usage: render-glb <model.glb> <out.png>');

  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(resolve(input));
  const triangles: Tri[] = [];

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const uv = primitive.getAttribute('TEXCOORD_0');
      const material = primitive.getMaterial();
      const factor = material?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1];
      const texture = material?.getBaseColorTexture();
      const pixels = texture?.getImage() ? await decode(texture.getImage()!) : null;

      const indices = primitive.getIndices();
      const count = indices?.getCount() ?? position.getCount();
      const index = (i: number) => (indices ? indices.getScalar(i) : i);
      const point = (i: number): Vec3 => {
        const p = position.getElement(index(i), [] as number[]) as Vec3;
        return [
          m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
          m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
          m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
        ];
      };

      for (let i = 0; i + 2 < count; i += 3) {
        let colour: [number, number, number] = [factor[0]!, factor[1]!, factor[2]!];
        if (pixels && uv) {
          const [u0, v0] = uv.getElement(index(i), [] as number[]);
          const [u1, v1] = uv.getElement(index(i + 1), [] as number[]);
          const [u2, v2] = uv.getElement(index(i + 2), [] as number[]);
          const u = ((u0! + u1! + u2!) / 3) % 1;
          const v = ((v0! + v1! + v2!) / 3) % 1;
          const x = Math.min(
            pixels.width - 1,
            Math.max(0, Math.floor((u < 0 ? u + 1 : u) * pixels.width)),
          );
          const y = Math.min(
            pixels.height - 1,
            Math.max(0, Math.floor((v < 0 ? v + 1 : v) * pixels.height)),
          );
          const at = (y * pixels.width + x) * 4;
          colour = [
            srgbToLinear(pixels.data[at]! / 255) * colour[0],
            srgbToLinear(pixels.data[at + 1]! / 255) * colour[1],
            srgbToLinear(pixels.data[at + 2]! / 255) * colour[2],
          ];
        }
        triangles.push({ a: point(i), b: point(i + 1), c: point(i + 2), colour });
      }
    }
  }

  const all = triangles.flatMap((t) => [t.a, t.b, t.c]);
  const min: Vec3 = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]!))) as Vec3;
  const max: Vec3 = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k]!))) as Vec3;
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  // Include the origin so where it sits relative to the model is visible.
  const lo: Vec3 = [Math.min(min[0], 0), Math.min(min[1], 0), Math.min(min[2], 0)];
  const hi: Vec3 = [Math.max(max[0], 0), Math.max(max[1], 0), Math.max(max[2], 0)];
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);

  const canvas = createCanvas(VIEW * 3, VIEW + 40);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f2ee';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  /*
   * Each view: screen (sx, sy) from world, a depth to sort by (larger = nearer the viewer), and the
   * view direction for lighting. Screen y grows down, so world "up" is negated.
   */
  const views: {
    title: string;
    project: (p: Vec3) => [number, number, number];
    toViewer: Vec3;
    axes: [string, string];
  }[] = [
    {
      title: 'front (from +Z)',
      project: (p) => [p[0], -p[1], p[2]],
      toViewer: [0, 0, 1],
      axes: ['+X →', '+Y ↑'],
    },
    {
      title: 'side (from +X)',
      project: (p) => [-p[2], -p[1], p[0]],
      toViewer: [1, 0, 0],
      axes: ['-Z →', '+Y ↑'],
    },
    {
      title: 'top (from +Y)',
      project: (p) => [p[0], p[2], p[1]],
      toViewer: [0, 1, 0],
      axes: ['+X →', '+Z ↓'],
    },
  ];

  views.forEach((view, column) => {
    const ox = column * VIEW;
    const scale = (VIEW - MARGIN * 2) / span;
    const corners = [lo, hi, [lo[0], hi[1], lo[2]], [hi[0], lo[1], hi[2]], [0, 0, 0]] as Vec3[];
    const projected = corners.map(view.project);
    const cx =
      (Math.min(...projected.map((p) => p[0])) + Math.max(...projected.map((p) => p[0]))) / 2;
    const cy =
      (Math.min(...projected.map((p) => p[1])) + Math.max(...projected.map((p) => p[1]))) / 2;
    const toScreen = (p: [number, number, number]): [number, number] => [
      ox + VIEW / 2 + (p[0] - cx) * scale,
      20 + VIEW / 2 + (p[1] - cy) * scale,
    ];

    const drawn = triangles
      .map((t) => {
        const pa = view.project(t.a);
        const pb = view.project(t.b);
        const pc = view.project(t.c);
        return { t, pa, pb, pc, depth: (pa[2] + pb[2] + pc[2]) / 3 };
      })
      .sort((x, y) => x.depth - y.depth);

    const light = normalise([
      view.toViewer[0] + (view.toViewer[1] === 1 ? -0.4 : 0) - 0.4 * view.toViewer[2],
      view.toViewer[1] + 0.6,
      view.toViewer[2] + 0.4 * view.toViewer[0],
    ]);

    for (const { t, pa, pb, pc } of drawn) {
      const n = normalise(cross(sub(t.b, t.a), sub(t.c, t.a)));
      const lit = 0.3 + 0.7 * Math.abs(dot(n, light));
      const [r, g, b] = t.colour.map((c) => Math.round(linearToSrgb(Math.min(1, c * lit)) * 255));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6;
      const [a, b2, c] = [toScreen(pa), toScreen(pb), toScreen(pc)];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const origin = toScreen(view.project([0, 0, 0]));
    drawCross(ctx, origin[0], origin[1]);
    ctx.fillStyle = '#222';
    ctx.font = '15px sans-serif';
    ctx.fillText(view.title, ox + 12, 18);
    ctx.font = '12px sans-serif';
    ctx.fillText(`${view.axes[0]}   ${view.axes[1]}   ● origin`, ox + 12, VIEW + 32);
  });

  ctx.fillStyle = '#222';
  ctx.font = '12px sans-serif';
  ctx.fillText(
    `bounds x ${min[0].toFixed(3)}…${max[0].toFixed(3)}  y ${min[1].toFixed(3)}…${max[1].toFixed(3)}  ` +
      `z ${min[2].toFixed(3)}…${max[2].toFixed(3)}  (largest extent ${extent.toFixed(3)}), ${triangles.length} triangles`,
    VIEW + 12,
    VIEW + 16,
  );

  writeFileSync(resolve(output), canvas.toBuffer('image/png'));
  console.log(`  ✓ ${output}`);
}

async function decode(bytes: Uint8Array) {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

function drawCross(ctx: SKRSContext2D, x: number, y: number): void {
  ctx.strokeStyle = '#d0021b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.moveTo(x - 10, y);
  ctx.lineTo(x + 10, y);
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x, y + 10);
  ctx.stroke();
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
