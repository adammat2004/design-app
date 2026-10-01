import { Document, type Material } from '@gltf-transform/core';
import sharp from 'sharp';
import { getBounds } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';
import { createIO } from './io.js';
import { inspect } from './inspect.js';
import { MalformedModelError, processModel, STRUCTURE_BUDGETS, type Budgets } from './process.js';

/*
 * Every model here is built in the test, so the suite needs no Meshy file, no network and no key.
 * The shapes are boxes because a box's bounding box is known exactly: what normalising should do to
 * it can be written down rather than measured.
 */

type Vec3 = [number, number, number];

/** An axis-aligned box as 12 triangles with UVs, added to `document` under one node. */
function addBox(
  document: Document,
  options: { size: Vec3; centre?: Vec3; material?: Material | null; name?: string },
) {
  const [w, h, d] = options.size;
  const [cx, cy, cz] = options.centre ?? [0, 0, 0];
  const x = [cx - w / 2, cx + w / 2];
  const y = [cy - h / 2, cy + h / 2];
  const z = [cz - d / 2, cz + d / 2];
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    positions.push(x[i & 1]!, y[(i >> 1) & 1]!, z[(i >> 2) & 1]!);
    uvs.push(i & 1, (i >> 1) & 1);
  }
  // Two triangles per face, wound outwards.
  const indices = [
    0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3,
    5, 3, 7, 5,
  ];
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const primitive = document
    .createPrimitive()
    .setAttribute(
      'POSITION',
      document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(positions))
        .setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      document.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array(indices))
        .setBuffer(buffer),
    );
  if (options.material) primitive.setMaterial(options.material);
  return document
    .createNode(options.name ?? 'box')
    .setMesh(document.createMesh(options.name ?? 'box').addPrimitive(primitive));
}

/** A flat grid of `cells × cells` quads on y = 0, for a mesh with triangles to spare. */
function addGrid(document: Document, cells: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= cells; j += 1) {
    for (let i = 0; i <= cells; i += 1) {
      positions.push(i / cells, 0.0001 * Math.sin(i * j), j / cells);
      uvs.push(i / cells, j / cells);
    }
  }
  const at = (i: number, j: number) => j * (cells + 1) + i;
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      indices.push(
        at(i, j),
        at(i, j + 1),
        at(i + 1, j),
        at(i + 1, j),
        at(i, j + 1),
        at(i + 1, j + 1),
      );
    }
  }
  const buffer = document.createBuffer();
  const primitive = document
    .createPrimitive()
    .setAttribute(
      'POSITION',
      document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(positions))
        .setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      document.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint32Array(indices))
        .setBuffer(buffer),
    );
  return document.createNode('grid').setMesh(document.createMesh('grid').addPrimitive(primitive));
}

async function png(colour: { r: number; g: number; b: number }, px = 256): Promise<Uint8Array> {
  /*
   * A gradient with noise on it, so it is a picture rather than a colour: `prune` bakes a texture
   * that is one colour into its material's factors (correctly — 1 × the map's mean), which would make
   * the metal-map test about that optimisation instead of about the map surviving.
   */
  const raw = Buffer.alloc(px * px * 3);
  let seed = 1;
  for (let i = 0; i < raw.length; i += 3) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const n = (seed % 40) + Math.floor(((i / 3) % px) / 8);
    raw[i] = Math.min(255, colour.r + n);
    raw[i + 1] = Math.min(255, colour.g + n);
    raw[i + 2] = Math.min(255, colour.b + n);
  }
  return sharp(raw, { raw: { width: px, height: px, channels: 3 } })
    .png()
    .toBuffer();
}

/** A Meshy-shaped material: metallic 1 with the metal in the map, plus an emission map. */
async function meshyMaterial(
  document: Document,
  options: { metalMap: boolean; emission: boolean },
) {
  const material = document
    .createMaterial('Material_0')
    .setMetallicFactor(1)
    .setRoughnessFactor(1)
    .setDoubleSided(true)
    .setBaseColorTexture(
      document
        .createTexture('base')
        .setMimeType('image/png')
        .setImage(await png({ r: 90, g: 60, b: 40 })),
    )
    .setNormalTexture(
      document
        .createTexture('normal')
        .setMimeType('image/png')
        .setImage(await png({ r: 128, g: 128, b: 220 })),
    );
  if (options.metalMap) {
    material.setMetallicRoughnessTexture(
      document
        .createTexture('mr')
        .setMimeType('image/png')
        .setImage(await png({ r: 220, g: 160, b: 0 })),
    );
  }
  if (options.emission) {
    material.setEmissiveTexture(
      document
        .createTexture('emission')
        .setMimeType('image/png')
        .setImage(await png({ r: 0, g: 0, b: 0 })),
    );
  }
  return material;
}

async function glb(document: Document): Promise<Uint8Array> {
  return (await createIO()).writeBinary(document);
}

const near = (actual: number, expected: number, tolerance = 2e-3) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThan(tolerance);

const ROOMY: Budgets = { ...STRUCTURE_BUDGETS };

describe('normalising', () => {
  it('stands a model that was centred, moved and scaled in its file on the origin, at the size asked for', async () => {
    const document = new Document();
    const node = addBox(document, { size: [2, 1, 1] })
      .setTranslation([5, 3, -2])
      .setScale([0.5, 0.5, 0.5]);
    document.createScene('scene').addChild(node);

    const { bytes, report } = await processModel(await glb(document), {
      nominal: { width: 4, depth: 2, height: 1.5 },
      budgets: ROOMY,
    });
    const out = inspect(await (await createIO()).readBinary(bytes));

    // In the file the box was 1 × 0.5 × 0.5 around (5, 3, −2); `contain` in 4 × 2 is a scale of 4.
    near(report.normalised.scale, 4);
    near(out.size[0], 4);
    near(out.size[1], 2);
    near(out.size[2], 2);
    near(out.bounds.min[1], 0);
    near((out.bounds.min[0] + out.bounds.max[0]) / 2, 0);
    near((out.bounds.min[2] + out.bounds.max[2]) / 2, 0);
    expect(report.defects).toEqual([]);
    expect(report.outputValidation.errors).toBe(0);
  });

  it('keeps its proportions and says so when its height is far from the height asked for', async () => {
    const document = new Document();
    document.createScene('scene').addChild(addBox(document, { size: [1, 1, 1] }));
    const { report } = await processModel(await glb(document), {
      nominal: { width: 3, depth: 3, height: 2 },
      budgets: ROOMY,
    });
    // Scaled uniformly to 3 m across, so 3 m tall — 50% over — and never squashed to fit.
    near(report.normalised.naturalSize[1], 3);
    expect(report.warnings.some((warning) => warning.includes('50% off'))).toBe(true);
    expect(report.defects).toEqual([]);
  });

  it('stretches it upright to the height asked for only when a reviewer chooses to', async () => {
    const document = new Document();
    document.createScene('scene').addChild(addBox(document, { size: [2, 1, 2] }));
    const bytes = await glb(document);
    const options = { nominal: { width: 3, depth: 3, height: 2.7 }, budgets: ROOMY };

    // Uniform: 3 m across makes it 1.5 m tall, and that is reported rather than corrected.
    const plain = await processModel(bytes, options);
    near(plain.report.normalised.naturalSize[1], 1.5);
    expect(plain.report.normalised.heightStretch).toBe(1);

    const fitted = await processModel(bytes, { ...options, fitHeight: true });
    near(fitted.report.normalised.naturalSize[0], 3);
    near(fitted.report.normalised.naturalSize[1], 2.7);
    near(fitted.report.normalised.heightStretch, 1.8);
    near(fitted.report.output.bounds.min[1], 0);
    expect(fitted.report.warnings.join(' ')).toMatch(/stretched upright ×1.80/);
  });

  it('turns a quarter when review says so, +Z towards +X for 90°', async () => {
    const document = new Document();
    const scene = document.createScene('scene');
    scene.addChild(addBox(document, { size: [1, 1, 1], name: 'body' }));
    // A small marker standing out of the +Z face: where the "front" is in the file.
    scene.addChild(
      addBox(document, { size: [0.2, 0.2, 0.5], centre: [0, 0, 0.75], name: 'front' }),
    );

    const { bytes } = await processModel(await glb(document), {
      nominal: { width: 1.5, depth: 1, height: 1 },
      frontYawDeg: 90,
      budgets: ROOMY,
    });
    const out = await (await createIO()).readBinary(bytes);
    near(inspect(out).size[0], 1.5);
    near(inspect(out).size[2], 1);
    // Where the marker went: out along +X, on the middle of the body's Z.
    const front = out
      .getRoot()
      .listNodes()
      .find((node) => node.getName() === 'front')!;
    const box = getBounds(front);
    expect((box.min[0]! + box.max[0]!) / 2).toBeGreaterThan(0.4);
    near((box.min[2]! + box.max[2]!) / 2, 0);
  });

  it('refuses a turn that is not a quarter', async () => {
    const document = new Document();
    document.createScene('scene').addChild(addBox(document, { size: [1, 1, 1] }));
    await expect(
      processModel(await glb(document), {
        nominal: { width: 1, depth: 1, height: 1 },
        frontYawDeg: 45,
        budgets: ROOMY,
      }),
    ).rejects.toThrow(/quarter turn/);
  });
});

describe('optimising', () => {
  it('drops emission, keeps the metal map, and shrinks every texture to the budget', async () => {
    const document = new Document();
    const material = await meshyMaterial(document, { metalMap: true, emission: true });
    document.createScene('scene').addChild(addBox(document, { size: [1, 1, 1], material }));

    const { report } = await processModel(await glb(document), {
      nominal: { width: 1, depth: 1, height: 1 },
      budgets: { ...ROOMY, maxTexturePx: 64 },
    });
    expect(report.optimised.removedEmission).toBe(1);
    expect(report.output.maxTexturePx).toBeLessThanOrEqual(64);
    const [out] = report.output.materials;
    expect(out!.hasEmissiveTexture).toBe(false);
    // The trap: metalness 1 is only safe because the map says where the metal is.
    expect(out!.metallicFactor).toBe(1);
    expect(out!.hasMetallicRoughnessTexture).toBe(true);
    expect(report.output.textures.every((texture) => texture.mimeType === 'image/jpeg')).toBe(true);
    // A normal map with no tangents gets MikkTSpace ones, so no renderer has to invent its own.
    expect(report.optimised.generatedTangents).toBe(true);
    expect(report.outputValidation.messages.join(' ')).not.toContain('GENERATED_TANGENT_SPACE');
    expect(report.defects).toEqual([]);
  });

  it('refuses a material that will render as polished metal', async () => {
    const document = new Document();
    const material = await meshyMaterial(document, { metalMap: false, emission: false });
    document.createScene('scene').addChild(addBox(document, { size: [1, 1, 1], material }));
    const { report } = await processModel(await glb(document), {
      nominal: { width: 1, depth: 1, height: 1 },
      budgets: ROOMY,
    });
    expect(report.defects.some((defect) => defect.includes('polished metal'))).toBe(true);
  });

  it('simplifies a mesh over the triangle budget down to it', async () => {
    const document = new Document();
    document.createScene('scene').addChild(addGrid(document, 40));
    const { report } = await processModel(await glb(document), {
      nominal: { width: 1, depth: 1, height: 0.01 },
      budgets: { ...ROOMY, triangles: 500 },
      heightTolerance: Infinity,
    });
    expect(report.input.counts.triangles).toBe(3200);
    expect(report.optimised.simplified?.from).toBe(3200);
    expect(report.output.counts.triangles).toBeLessThanOrEqual(500);
    expect(report.defects).toEqual([]);
  });

  it('refuses a file over the byte budget rather than publishing it', async () => {
    const document = new Document();
    const material = await meshyMaterial(document, { metalMap: true, emission: false });
    document.createScene('scene').addChild(addBox(document, { size: [1, 1, 1], material }));
    const { report } = await processModel(await glb(document), {
      nominal: { width: 1, depth: 1, height: 1 },
      budgets: { ...ROOMY, bytes: 1000 },
    });
    expect(report.defects.some((defect) => defect.includes('over the'))).toBe(true);
  });
});

describe('malformed input', () => {
  it('refuses bytes that are not a glTF with an error that says so', async () => {
    const junk = new TextEncoder().encode('this is not a model');
    await expect(
      processModel(junk, { nominal: { width: 1, depth: 1, height: 1 }, budgets: ROOMY }),
    ).rejects.toBeInstanceOf(MalformedModelError);
  });
});
