'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  Color,
  MeshStandardMaterial,
  Object3D,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
} from 'three';
import { rankOf } from '@garden-studio/ar-builder';
import type {
  ARMaterial,
  ARScene,
  Mesh,
  ModelNode,
  PlantsNode,
  SolidNode,
  SurfaceNode,
} from '@garden-studio/ar-contract';
import { isStructureFinish, type LocalPoint } from '@garden-studio/schema';
import { meshGeometry, modelRing } from '@/lib/ar/preview';
import { furnitureModel } from '@/lib/structures/furniture-models';
import {
  CONTEXT_TONES,
  contextSolidMaterial,
  cushionMaterial,
  foliageMaterial,
  furnitureMaterial,
  materialForFinish,
} from '@/lib/structures/materials-3d';
import { fitToFootprint } from '@/lib/structures/model-fit';
import {
  broadleafCrown,
  clippedMass,
  coniferCrown,
  CROWN_VARIANTS,
  shrubCrown,
  treeShape,
  trunkGeometry,
  tuftGeometry,
} from '@/lib/structures/nature-geometry';
import { useResource } from '@/lib/structures/resource';
import { extrudedGeometry, furnitureParts } from '@/lib/structures/surroundings-geometry';
import { HouseOpening } from './HouseOpening';
import { LibraryModel, type DrawnBox } from './LibraryModel';

/**
 * An `ARScene` drawn in three.js — the one renderer of the garden in 3D, used by the whole-garden
 * preview and by the structure editor's surroundings alike, so a fence, a tree or a hedge looks the
 * same in both and there is one place that decides how.
 *
 * It draws what the scene says. Two hooks let a caller that holds the plan draw some of it better —
 * the structure editor paints the ground near the structure with the plan's own painter
 * (`paintGround`) and draws a neighbouring pergola with its full model (`drawSolid`) — while the
 * preview uses neither, because its job is to show exactly what the phone will draw.
 */
export interface SceneNodesProps {
  scene: ARScene;
  /** Nodes to leave out, by `sourceId` — the structure being edited and what stands inside it. */
  exclude?: ReadonlySet<string>;
  /** Solids a click opens in the structure editor, by `sourceId`. */
  pickable?: ReadonlySet<string>;
  onPick?: (sourceId: string) => void;
  /** Paint a surface with something better than its scene colour, or `null` to draw it flat. */
  paintGround?: (node: SurfaceNode) => PaintedGround | null;
  /** Draw a solid some other way, or `undefined` to draw it from the scene. */
  drawSolid?: (node: SolidNode) => ReactNode | undefined;
  /**
   * Told the world box each library model was drawn in, by `sourceId`, and `null` when it goes — the
   * whole-garden preview's test hook for "the model stands where the plan says".
   */
  onAssetDrawn?: (sourceId: string, box: DrawnBox | null) => void;
}

export interface PaintedGround {
  material: Material;
  /** UVs for each vertex of the node's mesh, by its position in the scene. */
  uv: (x: number, z: number) => [number, number];
  dispose: () => void;
}

export function SceneNodes({
  scene,
  exclude,
  pickable,
  onPick,
  paintGround,
  drawSolid,
  onAssetDrawn,
}: SceneNodesProps) {
  const materials = useMaterials(scene.materials);
  const shown = useMemo(
    () => scene.nodes.filter((node) => node.visibleByDefault && !(node.sourceId && exclude?.has(node.sourceId))),
    [scene, exclude],
  );
  const plants = useMemo(() => shown.filter((node): node is PlantsNode => node.kind === 'plants'), [shown]);
  return (
    <>
      {shown.map((node) => {
        switch (node.kind) {
          case 'surface':
            return <Surface key={node.id} node={node} material={materials.get(node.material)} paint={paintGround} />;
          case 'solid': {
            const custom = drawSolid?.(node);
            if (custom !== undefined) return <group key={node.id}>{custom}</group>;
            return (
              <Solid
                key={node.id}
                node={node}
                materials={materials}
                colour={scene.materials[node.parts[0]!.material]?.baseColor}
                onPick={node.sourceId && pickable?.has(node.sourceId) ? () => onPick?.(node.sourceId!) : undefined}
                onAssetDrawn={onAssetDrawn}
              />
            );
          }
          case 'model':
            return <Model key={node.id} node={node} />;
          case 'plants':
            return null;
        }
      })}
      <Planting nodes={plants} colours={scene.materials} />
    </>
  );
}

/* ------------------------------------------------------------------ materials */

/**
 * One material per scene material. A structure finish (`finish:<id>`) is the structure editor's own
 * PBR material, which is shaped like `ARMaterial` in the first place — so a neighbouring pergola has
 * its timber in both views — and is shared for the page, so it is never disposed here. Anything else is
 * a flat material made for this scene and disposed with it.
 */
function useMaterials(table: Record<string, ARMaterial>): Map<string, Material> {
  const built = useMemo(() => {
    const owned: Material[] = [];
    const map = new Map<string, Material>();
    for (const material of Object.values(table)) {
      const finish = material.id.startsWith('finish:') ? material.id.slice('finish:'.length) : null;
      if (finish && isStructureFinish(finish)) {
        map.set(material.id, materialForFinish(finish, { detail: false }));
        continue;
      }
      const flat = new MeshStandardMaterial({
        color: new Color(material.baseColor),
        roughness: material.roughness,
        metalness: material.metalness,
      });
      owned.push(flat);
      map.set(material.id, flat);
    }
    return { map, owned };
  }, [table]);
  useEffect(() => () => built.owned.forEach((material) => material.dispose()), [built]);
  return built.map;
}

function MeshOf({
  mesh,
  material,
  receive = false,
  cast = false,
}: {
  mesh: Mesh;
  material: Material | undefined;
  receive?: boolean;
  cast?: boolean;
}) {
  const geometry = useMemo(() => meshGeometry(mesh), [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} receiveShadow={receive} castShadow={cast} />;
}

/* ------------------------------------------------------------------ the ground */

/**
 * How thick paving and decking are laid, so they have an edge where they meet the lawn. Drawn, not
 * stated: the scene's surface is its top at `y`, and a slab is how a patio reads as built.
 */
const SLAB = 0.03;
const SLABBED = new Set(['paving', 'decking', 'path']);

function Surface({
  node,
  material,
  paint,
}: {
  node: SurfaceNode;
  material: Material | undefined;
  paint?: (node: SurfaceNode) => PaintedGround | null;
}) {
  const painted = useMemo(() => paint?.(node) ?? null, [paint, node]);
  useEffect(() => () => painted?.dispose(), [painted]);
  const geometry = useMemo(() => {
    const built = meshGeometry(node.mesh);
    if (painted) {
      const uvs = new Float32Array((node.mesh.positions.length / 3) * 2);
      for (let i = 0; i < node.mesh.positions.length / 3; i++) {
        const [u, v] = painted.uv(node.mesh.positions[i * 3]!, node.mesh.positions[i * 3 + 2]!);
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
      }
      built.setAttribute('uv', new BufferAttribute(uvs, 2));
    }
    return built;
  }, [node.mesh, painted]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const slab = SLABBED.has(node.category) ? SLAB : 0;
  const edge = useMemo(
    () =>
      slab > 0
        ? extrudedGeometry(
            node.outline.map(([x, z]) => ({ x, z })),
            node.y,
            slab - 0.002,
          )
        : null,
    [slab, node.outline, node.y],
  );
  useEffect(() => () => edge?.dispose(), [edge]);
  const surface = painted?.material ?? material;
  return (
    <>
      <mesh geometry={geometry} material={surface} position-y={slab} receiveShadow />
      {edge ? <mesh geometry={edge} material={material} castShadow receiveShadow /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ solids */

function Solid({
  node,
  materials,
  colour,
  onPick,
  onAssetDrawn,
}: {
  node: SolidNode;
  materials: Map<string, Material>;
  colour: string | undefined;
  onPick?: () => void;
  onAssetDrawn?: (sourceId: string, box: DrawnBox | null) => void;
}) {
  const sourceId = node.sourceId ?? node.id;
  const drawn = useCallback(
    (box: DrawnBox | null) => onAssetDrawn?.(sourceId, box),
    [onAssetDrawn, sourceId],
  );
  const parts = node.hedge ? (
    <Hedge hedge={node.hedge} colour={colour ?? CONTEXT_TONES.shrub} />
  ) : (
    node.parts.map((part, index) => (
      <MeshOf key={index} mesh={part.mesh} material={materials.get(part.material)} receive cast />
    ))
  );
  return (
    <group
      onClick={
        onPick
          ? (event) => {
              event.stopPropagation();
              onPick();
            }
          : undefined
      }
      onPointerOver={onPick ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={onPick ? () => (document.body.style.cursor = '') : undefined}
    >
      {/* A library model where the builder matched one; its own parts until it loads, or if it never does. */}
      {node.asset ? (
        <LibraryModel asset={node.asset} fallback={parts} onDrawn={onAssetDrawn ? drawn : undefined} />
      ) : (
        parts
      )}
      {node.openings?.map((opening, index) => (
        <HouseOpening
          key={index}
          base={0}
          opening={{
            type: opening.kind,
            a: { x: opening.a[0], z: opening.a[1] },
            b: { x: opening.b[0], z: opening.b[1] },
            outward: { x: opening.outward[0], z: opening.outward[1] },
            bottom: opening.bottom,
            top: opening.top,
          }}
        />
      ))}
    </group>
  );
}

/** How deep a hedge's clipped crown is, and how far apart its lumps are. */
const HEDGE_CROWN = 0.28;
const HEDGE_LUMP = 0.5;

/**
 * A clipped hedge: a solid body with a crown of lumps along its top, so the top reads as clipped
 * foliage rather than a lid. Drawn wherever the scene says a solid is a hedge — a hedge boundary or a
 * bed planted as hedging — in the hedge's own colour.
 */
function Hedge({ hedge, colour }: { hedge: NonNullable<SolidNode['hedge']>; colour: string }) {
  const ring = useMemo(() => hedge.outline.map(([x, z]): LocalPoint => ({ x, z })), [hedge.outline]);
  const { base, height } = hedge;
  const body = useMemo(() => extrudedGeometry(ring, base, Math.max(0.05, height - HEDGE_CROWN)), [ring, base, height]);
  useEffect(() => () => body?.dispose(), [body]);
  const lumps = useMemo(() => {
    const found: Instance[] = [];
    const xs = ring.map((point) => point.x);
    const zs = ring.map((point) => point.z);
    const lump = new Color(colour).multiplyScalar(1.2);
    for (let x = Math.min(...xs) + HEDGE_LUMP / 2; x < Math.max(...xs); x += HEDGE_LUMP) {
      for (let z = Math.min(...zs) + HEDGE_LUMP / 2; z < Math.max(...zs); z += HEDGE_LUMP) {
        if (!insideRing({ x, z }, ring)) continue;
        found.push({
          at: [x, base + height - HEDGE_CROWN * 1.9, z],
          yaw: x + z,
          spread: HEDGE_LUMP * 1.4,
          height: HEDGE_CROWN * 2,
          colour: lump,
        });
      }
    }
    return found;
  }, [ring, base, height, colour]);
  if (!body) return null;
  return (
    <>
      <mesh geometry={body} material={contextSolidMaterial(colour, 1)} castShadow receiveShadow />
      {lumps.length ? <PlantInstances instances={lumps} geometry={clippedMass(0)} /> : null}
    </>
  );
}

function insideRing(point: LocalPoint, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.z > point.z !== b.z > point.z && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/* ------------------------------------------------------------------ models */

function Model({ node }: { node: ModelNode }) {
  if (node.category === 'tree') return <Tree node={node} />;
  if (node.category === 'shrub') return <Shrub node={node} />;
  return <Furniture node={node} />;
}

/** A tree: the crown and stem its species and size give, the same in every view. */
function Tree({ node }: { node: ModelNode }) {
  const canopy = node.size[0] / 2;
  const height = node.size[1];
  const shape = useMemo(
    () => treeShape(node.id, node.model, canopy, height, canopy * 0.12),
    [node.id, node.model, canopy, height],
  );
  const crown = shape.form === 'conifer' ? coniferCrown(shape.variant) : broadleafCrown(shape.variant);
  const tone = shape.form === 'conifer' ? CONTEXT_TONES.conifer : CONTEXT_TONES.tree;
  const [x, y, z] = node.position;
  return (
    <group position={[x, y, z]}>
      {shape.stems.map((stem, index) => (
        <mesh
          key={index}
          geometry={trunkGeometry()}
          material={contextSolidMaterial(CONTEXT_TONES.trunk, 1)}
          position={[stem.x, 0, stem.z]}
          rotation={[stem.lean * Math.sign(stem.z || 1), 0, -stem.lean * Math.sign(stem.x || 1)]}
          scale={[stem.radius, stem.height, stem.radius]}
          castShadow
          receiveShadow
        />
      ))}
      <mesh
        geometry={crown}
        material={foliageMaterial(tone)}
        position={[0, shape.crown.y, 0]}
        rotation-y={shape.variant * 1.3}
        scale={[shape.crown.across, shape.crown.up, shape.crown.across]}
        castShadow
        receiveShadow
      />
    </group>
  );
}

function Shrub({ node }: { node: ModelNode }) {
  const up = Math.max(0.3, node.size[1]) / 2;
  const [x, y, z] = node.position;
  return (
    <mesh
      geometry={shrubCrown(Math.floor(rankOf(node.id) * CROWN_VARIANTS))}
      material={foliageMaterial(CONTEXT_TONES.shrub)}
      position={[x, y + up * 0.9, z]}
      scale={[node.size[0] / 2, up, node.size[2] / 2]}
      castShadow
      receiveShadow
    />
  );
}

/**
 * Furniture, play and light fittings: the checked-in model where there is one, fitted into the
 * footprint by one uniform scale (`fit: 'contain'`), and otherwise the handful of solids the
 * structure editor draws the same piece as, its seat pads in fabric.
 */
function Furniture({ node }: { node: ModelNode }) {
  const ring = useMemo(() => modelRing(node), [node]);
  const base = node.position[1];
  const model = useResource(furnitureModel(node.model));
  const fit = useMemo(
    () => (model ? fitToFootprint(model.entry.naturalSize, ring, base) : null),
    [model, ring, base],
  );
  const geometries = useMemo(
    () =>
      fit
        ? []
        : furnitureParts(node.model, ring, base, node.size[1]).flatMap((part) => {
            const geometry = extrudedGeometry(part.ring, part.base, part.height);
            return geometry ? [{ geometry, cushion: part.cushion === true }] : [];
          }),
    [fit, node.model, ring, base, node.size],
  );
  useEffect(() => () => geometries.forEach((part) => part.geometry.dispose()), [geometries]);
  const material = furnitureMaterial(undefined);
  if (model && fit) {
    return (
      <mesh
        geometry={model.geometry}
        material={material}
        position={fit.position}
        rotation-y={fit.yaw}
        scale={fit.scale}
        castShadow
        receiveShadow
      />
    );
  }
  return (
    <>
      {geometries.map(({ geometry, cushion }) => (
        <mesh
          key={geometry.uuid}
          geometry={geometry}
          material={cushion ? cushionMaterial({ detail: false }) : material}
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ planting */

/** Grasses are tufts; everything else in a bed reads as a lobed crown at this distance. */
function formGeometry(plant: PlantsNode['plant'], variant: number): BufferGeometry {
  return plant === 'grass' ? tuftGeometry(variant) : shrubCrown(variant);
}

type Instance = { at: [number, number, number]; yaw: number; spread: number; height: number; colour: Color };

/**
 * Every bed's infill as instanced crowns: one draw per form and variant, however many plants the
 * garden holds. Coloured from the bed's own material in the scene — its `tones`, one per plant by its
 * `tone`, which is what the plan draws each plant in.
 */
function Planting({ nodes, colours }: { nodes: PlantsNode[]; colours: Record<string, ARMaterial> }) {
  const groups = useMemo(() => {
    const byForm = new Map<string, { plant: PlantsNode['plant']; variant: number; instances: Instance[] }>();
    for (const node of nodes) {
      const material = colours[node.material];
      const base = new Color(material?.baseColor ?? CONTEXT_TONES.shrub);
      // The bed's own few colours where the scene gives them, each plant its tone of them; else one
      // green, varied a little per plant so a border is not a single flat colour.
      const tones = material?.tones?.map((tone) => new Color(tone)) ?? null;
      node.instances.forEach((instance, index) => {
        const rank = rankOf(`${node.id}:${index}`);
        const colour =
          tones && instance.tone !== undefined
            ? tones[Math.min(tones.length - 1, Math.floor(instance.tone * tones.length))]!.clone()
            : base.clone().multiplyScalar(0.82 + ((rank * 7919) % 1) * 0.3);
        const variant = Math.floor(rank * CROWN_VARIANTS);
        const key = `${node.plant === 'grass' ? 'grass' : 'crown'}:${variant}`;
        const group = byForm.get(key) ?? { plant: node.plant, variant, instances: [] };
        group.instances.push({ at: instance.at, yaw: instance.yaw, spread: instance.spread, height: instance.height, colour });
        byForm.set(key, group);
      });
    }
    return [...byForm.entries()];
  }, [nodes, colours]);
  return (
    <>
      {groups.map(([key, group]) => (
        <PlantInstances key={key} instances={group.instances} geometry={formGeometry(group.plant, group.variant)} />
      ))}
    </>
  );
}

function PlantInstances({ instances, geometry }: { instances: Instance[]; geometry: BufferGeometry }) {
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new Object3D();
    instances.forEach((instance, index) => {
      const across = instance.spread / 2;
      const up = Math.max(0.1, instance.height) / 2;
      dummy.position.set(instance.at[0], instance.at[1] + up * 0.9, instance.at[2]);
      dummy.rotation.set(0, instance.yaw, 0);
      dummy.scale.set(across, up, across);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, instance.colour);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [instances, invalidate]);
  return (
    <instancedMesh
      // A new count needs a new mesh: an instanced mesh's capacity is fixed when it is made.
      key={instances.length}
      ref={ref}
      args={[geometry, foliageMaterial(null), instances.length]}
      castShadow
      receiveShadow
    />
  );
}
