import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { hashString, mulberry32 } from '@garden-studio/schema';

/**
 * Plants and trees as three.js geometry: the crowns, tufts, clipped masses and trunks every 3D view
 * draws a garden's planting with. Where each plant stands is the scene's (`plantPlacements`, through
 * the AR scene builder); this is only what it looks like.
 *
 * Pure and deterministic — every random choice is seeded from an id with the plan's own `prng`, so
 * the same garden draws the same crowns every time. `BufferGeometry` needs no WebGL, so all of it is
 * tested in jsdom. Each crown spans one unit each way and is scaled to its plant.
 */

/* ---------------------------------------------------------------- crowns */

/** Crown geometries are built once per form and variant, then scaled per plant. */
const cache = new Map<string, BufferGeometry>();
/** How many distinct crowns each form has: enough that a border is not a row of clones. */
export const CROWN_VARIANTS = 4;

function cached(key: string, build: () => BufferGeometry): BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const geometry = build();
  cache.set(key, geometry);
  return geometry;
}

/**
 * A sphere pushed in and out by 3D noise: the lumpy mass every crown and shrub is built from. The
 * noise is read at each vertex's own position, so the duplicated vertices of neighbouring faces move
 * together and the surface never cracks.
 */
function lumpySphere(seed: number, detail: number, roughness: number): BufferGeometry {
  const noise = new SimplexNoise({ random: mulberry32(seed) });
  const geometry = new IcosahedronGeometry(1, detail);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const bumps =
      noise.noise3d(x * 1.6, y * 1.6, z * 1.6) * 0.65 +
      noise.noise3d(x * 3.4, y * 3.4, z * 3.4) * 0.35;
    const scale = 1 + bumps * roughness;
    position.setXYZ(i, x * scale, y * scale, z * scale);
  }
  geometry.deleteAttribute('uv');
  return geometry;
}

/**
 * Shades a crown from dark underneath to light on top — the self-shadowing a real crown has, which
 * a single-coloured blob lacks and which is most of why it reads as foliage rather than as a ball.
 * Multiplied by each instance's own colour.
 */
function shadeByHeight(geometry: BufferGeometry, low = 0.72, high = 1.08): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const position = geometry.getAttribute('position');
  const colours: number[] = [];
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
    const shade = low + (high - low) * Math.pow(t, 0.8);
    colours.push(shade, shade, shade);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}

/**
 * Scales a geometry so it spans −1…1 across and −1…1 up: a unit crown every plant is sized from.
 * Its vertices are welded first, so it shades as one soft mass rather than as facets — a crown lit
 * face by face reads as a cut gem, not as leaves.
 */
function toUnit(source: BufferGeometry): BufferGeometry {
  source.deleteAttribute('normal');
  const geometry = mergeVertices(source, 1e-4);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  const across = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const up = (box.max.y - box.min.y) / 2;
  geometry.translate(-cx, -cy, -cz);
  geometry.scale(1 / across, 1 / up, 1 / across);
  geometry.computeVertexNormals();
  return geometry;
}

/** A broadleaf crown: several lumpy lobes clustered into one, like a real tree's masses of leaf. */
export function broadleafCrown(variant: number): BufferGeometry {
  return cached(`broadleaf:${variant}`, () => {
    const random = mulberry32(hashString(`broadleaf:${variant}`));
    const lobes: BufferGeometry[] = [];
    const count = 6 + Math.floor(random() * 3);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + random() * 0.6;
      const reach = i === 0 ? 0 : 0.45 + random() * 0.2;
      const size = i === 0 ? 0.75 : 0.45 + random() * 0.2;
      const lobe = lumpySphere(hashString(`lobe:${variant}:${i}`), 3, 0.2);
      lobe.applyMatrix4(
        new Matrix4()
          .makeScale(size, size * 0.85, size)
          .setPosition(Math.cos(angle) * reach, (random() - 0.35) * 0.45, Math.sin(angle) * reach),
      );
      lobes.push(lobe);
    }
    return shadeByHeight(toUnit(mergeGeometries(lobes)!));
  });
}

/** An evergreen: tiers of drooping skirts narrowing to a point. */
export function coniferCrown(variant: number): BufferGeometry {
  return cached(`conifer:${variant}`, () => {
    const random = mulberry32(hashString(`conifer:${variant}`));
    const tiers: BufferGeometry[] = [];
    const count = 4;
    for (let i = 0; i < count; i += 1) {
      const radius = 1 - i * 0.2 + random() * 0.06;
      const tier = new ConeGeometry(radius, 0.9, 12, 1, true);
      tier.deleteAttribute('uv');
      tier.translate(0, i * 0.55, 0);
      tiers.push(tier.toNonIndexed());
    }
    return shadeByHeight(toUnit(mergeGeometries(tiers)!), 0.65, 1.05);
  });
}

/** A shrub or a border plant: one lumpy mass. */
export function shrubCrown(variant: number): BufferGeometry {
  return cached(`shrub:${variant}`, () =>
    shadeByHeight(toUnit(lumpySphere(hashString(`shrub:${variant}`), 3, 0.24)), 0.72, 1.08),
  );
}

/** A grass: a fountain of blades leaning out from the middle. */
export function tuftGeometry(variant: number): BufferGeometry {
  return cached(`tuft:${variant}`, () => {
    const random = mulberry32(hashString(`tuft:${variant}`));
    const blades: BufferGeometry[] = [];
    const count = 14;
    for (let i = 0; i < count; i += 1) {
      const blade = new ConeGeometry(0.06, 1, 3, 1);
      blade.deleteAttribute('uv');
      const lean = 0.25 + random() * 0.45;
      const turn = (i / count) * Math.PI * 2 + random() * 0.4;
      blade.translate(0, 0.5, 0);
      blade.applyMatrix4(new Matrix4().makeRotationZ(lean));
      blade.applyMatrix4(new Matrix4().makeRotationY(turn));
      blades.push(blade.toNonIndexed());
    }
    return shadeByHeight(toUnit(mergeGeometries(blades)!), 0.65, 1.1);
  });
}

/** A clipped mass: a soft, squarer block, as box and yew are grown. */
export function clippedMass(variant: number): BufferGeometry {
  return cached(`clipped:${variant}`, () => {
    const geometry = lumpySphere(hashString(`clipped:${variant}`), 2, 0.08);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      // Pull the sphere towards a cube: sign(v)·|v|^0.6 squares off the shoulders.
      const squared = (value: number) => Math.sign(value) * Math.pow(Math.abs(value), 0.6);
      position.setXYZ(
        i,
        squared(position.getX(i)),
        squared(position.getY(i)),
        squared(position.getZ(i)),
      );
    }
    return shadeByHeight(toUnit(geometry), 0.75, 1.05);
  });
}

/** A trunk of unit height and radius, tapering to the top. */
export function trunkGeometry(): BufferGeometry {
  return cached('trunk', () => {
    const trunk = new CylinderGeometry(0.7, 1, 1, 7, 1);
    trunk.translate(0, 0.5, 0);
    return trunk;
  });
}

/* ---------------------------------------------------------------- trees */

export type TreeForm = 'broadleaf' | 'conifer' | 'multistem';

export function treeForm(symbol: string | undefined): TreeForm {
  if (symbol === 'tree-evergreen') return 'conifer';
  if (symbol === 'tree-multistem') return 'multistem';
  return 'broadleaf';
}

export interface TreeShape {
  form: TreeForm;
  variant: number;
  /** The crown's centre height and its half-extents: across (the canopy radius) and up. */
  crown: { y: number; across: number; up: number };
  /** The trunk or stems: where each stands, its radius and how tall it is. */
  stems: { x: number; z: number; radius: number; height: number; lean: number }[];
}

/**
 * How a tree of a given canopy and height is built: a crown held within the canopy radius the plan
 * draws (the rule `canopyRing` keeps in 2D), sitting on a trunk that meets it.
 */
export function treeShape(
  id: string,
  symbol: string | undefined,
  canopy: number,
  height: number,
  trunk: number,
): TreeShape {
  const form = treeForm(symbol);
  const variant = hashString(id) % CROWN_VARIANTS;
  // A broadleaf carries its crown on a clear stem, as a garden tree is grown: about the top 55%.
  const up = form === 'conifer' ? height * 0.42 : Math.min(height * 0.28, canopy * 0.9);
  const crownY = height - up;
  const stemHeight = crownY - up * (form === 'conifer' ? 0.7 : 0.35);
  const radius = Math.min(0.22, Math.max(0.07, trunk * 0.45));
  const stems =
    form === 'multistem'
      ? [0, 1, 2].map((i) => {
          const angle = (i / 3) * Math.PI * 2 + variant;
          return {
            x: Math.cos(angle) * radius * 1.5,
            z: Math.sin(angle) * radius * 1.5,
            radius: radius * 0.6,
            height: stemHeight,
            lean: 0.12,
          };
        })
      : [{ x: 0, z: 0, radius, height: stemHeight, lean: 0 }];
  return { form, variant, crown: { y: crownY, across: canopy, up }, stems };
}
