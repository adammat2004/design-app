'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  Color,
  Matrix4,
  Object3D,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
} from 'three';
import {
  heightFor,
  isStructureFinish,
  STRUCTURE_FINISHES,
  type DesignElement,
  type LocalFrame,
  type LocalPoint,
  type NeighbourhoodOpening,
  type NeighbourhoodPlant,
  type NeighbourhoodSolid,
  type NeighbourhoodSurface,
  type Point,
  type RoofMaterial,
  type StructureNeighbourhood,
} from '@garden-studio/schema';
import { ROOF_TONES } from '@/lib/render/roof';
import { BOUNDARY_PALETTE } from '@/lib/materials/symbols/boundary';
import {
  CONTEXT_TONES,
  contextSolidMaterial,
  cushionMaterial,
  foliageMaterial,
  rasterSurfaceMaterial,
} from '@/lib/structures/materials-3d';
import {
  bedPlants,
  broadleafCrown,
  clippedMass,
  coniferCrown,
  MAX_BED_PLANTS,
  postsAlong,
  shade,
  shrubCrown,
  treeShape,
  trunkGeometry,
  tuftGeometry,
  type PlantInstance,
} from '@/lib/structures/nature-geometry';
import { rasterUv, surfaceRaster } from '@/lib/structures/surface-raster';
import {
  extrudedGeometry,
  furnitureParts,
  roofGeometry,
  surfaceColour,
  surfaceGeometry,
  tiledUv,
} from '@/lib/structures/surroundings-geometry';
import { StructureModel } from './StructureModel';

/**
 * The garden around the structure being edited: the ground it stands on, the beds and paths near
 * it, the fence, the house, trees, and any other pergola close by.
 *
 * It draws what `structureNeighbourhood` decided, in the structure's local frame, and decides
 * nothing about where anything is. The ground is painted by the plan's own surface painter; the
 * beds are planted where the plan plants them; a tree is the shape of its species. This is the
 * structure's neighbourhood, not a 3D garden (see "Visualise was removed" in CLAUDE.md).
 */
export function StructureSurroundings({
  neighbourhood,
  elements,
  frame,
  light,
}: {
  neighbourhood: StructureNeighbourhood;
  elements: DesignElement[];
  frame: LocalFrame;
  /** The plan's light, so the painted ground is lit from where the 3D sun is. */
  light: Point | undefined;
}) {
  const byId = useMemo(() => new Map(elements.map((element) => [element.id, element])), [elements]);
  return (
    <>
      <Ground
        neighbourhood={neighbourhood}
        byId={byId}
        elements={elements}
        frame={frame}
        light={light}
      />
      <BedPlanting neighbourhood={neighbourhood} byId={byId} elements={elements} frame={frame} />
      {neighbourhood.solids.map((solid) =>
        solid.kind === 'boundary' ? (
          <Boundary key={solid.id} solid={solid} />
        ) : (
          <Solid key={solid.id} solid={solid} />
        ),
      )}
      {neighbourhood.house ? <House house={neighbourhood.house} /> : null}
      {neighbourhood.plants.map((plant) =>
        plant.kind === 'tree' ? (
          <Tree key={plant.id} plant={plant} />
        ) : (
          <Shrub key={plant.id} plant={plant} />
        ),
      )}
      {neighbourhood.structures.map((other) => (
        <group
          key={other.id}
          position={[other.at.x, other.base, other.at.z]}
          rotation-y={other.yaw}
        >
          <StructureModel structure={other.structure} />
        </group>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- the ground */

/** Each surface is lifted this far above the one beneath it, in the plan's stacking order. */
const LAYER_LIFT = 0.0015;
/** Paving and decking are laid as slabs this thick, so they have an edge where they meet the lawn. */
const SLAB = 0.03;
const SLABBED = new Set(['paved-area']);

function Ground({
  neighbourhood,
  byId,
  elements,
  frame,
  light,
}: {
  neighbourhood: StructureNeighbourhood;
  byId: Map<string, DesignElement>;
  elements: DesignElement[];
  frame: LocalFrame;
  light: Point | undefined;
}) {
  const meshes = useMemo(() => {
    const built: {
      id: string;
      geometry: BufferGeometry;
      material: Material;
      dispose: () => void;
    }[] = [];
    neighbourhood.surfaces.forEach((surface, rank) => {
      const element = byId.get(surface.id);
      if (!element || isHedge(surface)) return;
      const slab = SLABBED.has(surface.category) ? SLAB : 0;
      const top = surface.y + (rank + 1) * LAYER_LIFT + slab;
      const raster = surfaceRaster(element, elements, light);
      const geometry = surfaceGeometry(
        surface.ring,
        top,
        raster ? rasterUv(raster, frame) : tiledUv(1, 1),
        slab,
      );
      if (!geometry) return;
      if (raster) {
        const { material, texture } = rasterSurfaceMaterial(
          raster.canvas as unknown as HTMLCanvasElement,
        );
        built.push({
          id: surface.id,
          geometry,
          material,
          dispose: () => {
            texture.dispose();
            material.dispose();
          },
        });
      } else {
        const material = contextSolidMaterial(surfaceColour(surface.material, surface.category), 1);
        built.push({ id: surface.id, geometry, material, dispose: () => undefined });
      }
      // A raised terrace stands on a plinth of its own paving, as the plan draws its retaining face.
      const rise = surface.y - neighbourhood.ground;
      if (rise >= 0.075) {
        const plinth = extrudedGeometry(surface.ring, neighbourhood.ground, rise);
        if (plinth) {
          built.push({
            id: `${surface.id}-plinth`,
            geometry: plinth,
            material: contextSolidMaterial(surfaceColour(surface.material, surface.category), 0.9),
            dispose: () => undefined,
          });
        }
      }
    });
    return built;
  }, [neighbourhood, byId, elements, frame, light]);
  useEffect(
    () => () =>
      meshes.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.dispose();
      }),
    [meshes],
  );

  return (
    <>
      {meshes.map((mesh) => (
        <mesh
          key={mesh.id}
          geometry={mesh.geometry}
          material={mesh.material}
          castShadow
          receiveShadow
        />
      ))}
      {neighbourhood.surfaces.filter(isHedge).map((surface) => (
        <HedgeMass key={surface.id} surface={surface} byId={byId} />
      ))}
    </>
  );
}

function isHedge(surface: NeighbourhoodSurface): boolean {
  return surface.category === 'planting-bed' && surface.material === 'hedging';
}

/* ---------------------------------------------------------------- planting */

const FORM_GEOMETRY: Record<PlantInstance['form'], (variant: number) => BufferGeometry> = {
  blob: shrubCrown,
  tufted: tuftGeometry,
  'clipped-mass': clippedMass,
};

type PlacedPlant = PlantInstance & { base: number };

/**
 * The plants in every bed near the structure, where the plan plants them, drawn as instanced crowns:
 * one draw per form and variant however many plants a border holds.
 */
function BedPlanting({
  neighbourhood,
  byId,
  elements,
  frame,
}: {
  neighbourhood: StructureNeighbourhood;
  byId: Map<string, DesignElement>;
  elements: DesignElement[];
  frame: LocalFrame;
}) {
  const groups = useMemo(() => {
    const all: PlacedPlant[] = [];
    for (const surface of neighbourhood.surfaces) {
      if (surface.category !== 'planting-bed' || isHedge(surface)) continue;
      const bed = byId.get(surface.id);
      if (!bed) continue;
      for (const plant of bedPlants(bed, elements, frame, neighbourhood.half)) {
        all.push({ ...plant, base: surface.y });
      }
    }
    const byForm = new Map<string, PlacedPlant[]>();
    for (const plant of all.slice(0, MAX_BED_PLANTS)) {
      const key = `${plant.form}:${plant.variant}`;
      byForm.set(key, [...(byForm.get(key) ?? []), plant]);
    }
    return [...byForm.entries()];
  }, [neighbourhood, byId, elements, frame]);

  return (
    <>
      {groups.map(([key, plants]) => (
        <PlantInstances
          key={key}
          plants={plants}
          geometry={FORM_GEOMETRY[plants[0]!.form](plants[0]!.variant)}
        />
      ))}
    </>
  );
}

function PlantInstances({ plants, geometry }: { plants: PlacedPlant[]; geometry: BufferGeometry }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new Object3D();
    const colour = new Color();
    plants.forEach((plant, index) => {
      const across = plant.spread / 2;
      const up = Math.max(0.1, plant.height) / 2;
      dummy.position.set(plant.at.x, plant.base + up * 0.9, plant.at.z);
      dummy.rotation.set(0, plant.rotation, 0);
      dummy.scale.set(across, up, across);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, colour.set(plant.colour));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [plants]);

  return (
    <instancedMesh
      // A new count needs a new mesh: an instanced mesh's capacity is fixed when it is made.
      key={plants.length}
      ref={ref}
      args={[geometry, foliageMaterial(null), plants.length]}
      castShadow
      receiveShadow
    />
  );
}

/** A clipped hedge planted as a bed: a solid body with a crown of lumps along its top. */
function HedgeMass({
  surface,
  byId,
}: {
  surface: NeighbourhoodSurface;
  byId: Map<string, DesignElement>;
}) {
  const element = byId.get(surface.id);
  const height = element ? heightFor(element) : 1.8;
  return <HedgeBody ring={surface.ring} base={surface.y} height={height} />;
}

const HEDGE_CROWN = 0.28;
const HEDGE_LUMP = 0.5;

function HedgeBody({ ring, base, height }: { ring: LocalPoint[]; base: number; height: number }) {
  const body = useMemo(
    () => extrudedGeometry(ring, base, height - HEDGE_CROWN),
    [ring, base, height],
  );
  useEffect(() => () => body?.dispose(), [body]);
  // Lumps over the top on a grid inside the ring, so the top reads as clipped foliage, not a lid.
  const lumps = useMemo(() => {
    const found: PlacedPlant[] = [];
    const xs = ring.map((point) => point.x);
    const zs = ring.map((point) => point.z);
    for (let x = Math.min(...xs) + HEDGE_LUMP / 2; x < Math.max(...xs); x += HEDGE_LUMP) {
      for (let z = Math.min(...zs) + HEDGE_LUMP / 2; z < Math.max(...zs); z += HEDGE_LUMP) {
        if (!insideRing({ x, z }, ring)) continue;
        found.push({
          id: `${x.toFixed(2)}:${z.toFixed(2)}`,
          form: 'clipped-mass',
          variant: Math.abs(Math.round(x * 7 + z * 13)) % 4,
          at: { x, z },
          spread: HEDGE_LUMP * 1.4,
          height: HEDGE_CROWN * 2,
          rotation: x + z,
          colour: shade(BOUNDARY_PALETTE.hedge.body, 1.2),
          base: base + height - HEDGE_CROWN * 1.9,
        });
      }
    }
    return found;
  }, [ring, base, height]);
  if (!body) return null;
  return (
    <>
      <mesh
        geometry={body}
        material={contextSolidMaterial(BOUNDARY_PALETTE.hedge.body, 1)}
        castShadow
        receiveShadow
      />
      {lumps.length ? <PlantInstances plants={lumps} geometry={clippedMass(0)} /> : null}
    </>
  );
}

function insideRing(point: LocalPoint, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function Tree({ plant }: { plant: NeighbourhoodPlant }) {
  const shape = useMemo(
    () => treeShape(plant.id, plant.symbol, plant.canopy, plant.height, plant.trunk),
    [plant.id, plant.symbol, plant.canopy, plant.height, plant.trunk],
  );
  const crown =
    shape.form === 'conifer' ? coniferCrown(shape.variant) : broadleafCrown(shape.variant);
  const tone = shape.form === 'conifer' ? CONTEXT_TONES.conifer : CONTEXT_TONES.tree;
  return (
    <group position={[plant.at.x, plant.base, plant.at.z]}>
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

function Shrub({ plant }: { plant: NeighbourhoodPlant }) {
  const up = Math.max(0.3, plant.height) / 2;
  return (
    <mesh
      geometry={shrubCrown(plant.id.length % 4)}
      material={foliageMaterial(CONTEXT_TONES.shrub)}
      position={[plant.at.x, plant.base + up * 0.9, plant.at.z]}
      scale={[plant.canopy, up, plant.canopy]}
      castShadow
      receiveShadow
    />
  );
}

/* ---------------------------------------------------------------- boundaries */

/**
 * A boundary as it is built: a fence is posts with panels between them and a rail along the top, a
 * wall is masonry with piers and a coping, a railing is balusters under a rail, a hedge is clipped
 * foliage. The spacing is the plan's own (`BOUNDARY_PALETTE.postSpacing`), so the 3D posts stand
 * where the plan draws them.
 */
function Boundary({ solid }: { solid: NeighbourhoodSolid }) {
  const kind = solid.boundary ?? 'fence';
  const palette = BOUNDARY_PALETTE[kind];
  const { base, height, ring, run } = solid;

  const parts = useMemo(() => {
    const body: BufferGeometry[] = [];
    const detail: BufferGeometry[] = [];
    const cap: BufferGeometry[] = [];
    const push = (list: BufferGeometry[], geometry: BufferGeometry | null) => {
      if (geometry) list.push(geometry);
    };
    if (kind === 'fence') {
      push(body, extrudedGeometry(ring, base + 0.08, height - 0.14));
      push(detail, extrudedGeometry(ring, base + height - 0.08, 0.06));
    } else if (kind === 'wall') {
      push(body, extrudedGeometry(ring, base, height - 0.07));
      push(cap, extrudedGeometry(ring, base + height - 0.07, 0.07));
    } else if (kind === 'railing') {
      push(detail, extrudedGeometry(ring, base + height - 0.05, 0.05));
      push(detail, extrudedGeometry(ring, base + 0.1, 0.04));
    }
    return { body, detail, cap };
  }, [kind, ring, base, height]);
  useEffect(
    () => () =>
      [...parts.body, ...parts.detail, ...parts.cap].forEach((geometry) => geometry.dispose()),
    [parts],
  );

  if (kind === 'hedge') return <HedgeBody ring={ring} base={base} height={height} />;

  const spacing = kind === 'railing' ? 0.14 : (palette.postSpacing ?? 1.8);
  const postSize = kind === 'wall' ? 0.34 : kind === 'railing' ? 0.025 : 0.1;
  const posts = run ? postsAlong(run, spacing) : [];
  const postHeight = kind === 'wall' ? height + 0.08 : height;
  const inward = run?.inward ?? { x: 0, z: 0 };
  // Posts stand on the boundary line, their inner faces flush with the panel.
  const inset = kind === 'wall' ? 0.11 : postSize / 2;

  return (
    <>
      {parts.body.map((geometry, index) => (
        <mesh
          key={`b${index}`}
          geometry={geometry}
          material={contextSolidMaterial(palette.body, 0.9)}
          castShadow
          receiveShadow
        />
      ))}
      {parts.detail.map((geometry, index) => (
        <mesh
          key={`d${index}`}
          geometry={geometry}
          material={contextSolidMaterial(palette.detail ?? palette.body, 0.85)}
          castShadow
          receiveShadow
        />
      ))}
      {parts.cap.map((geometry, index) => (
        <mesh
          key={`c${index}`}
          geometry={geometry}
          material={contextSolidMaterial(palette.cap ?? palette.body, 0.8)}
          castShadow
          receiveShadow
        />
      ))}
      {posts.length ? (
        <Posts
          points={posts.map((point) => ({
            x: point.x + inward.x * inset,
            z: point.z + inward.z * inset,
          }))}
          base={base}
          size={postSize}
          height={postHeight}
          colour={kind === 'wall' ? palette.body : (palette.detail ?? palette.body)}
        />
      ) : null}
    </>
  );
}

const UNIT_BOX = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

function Posts({
  points,
  base,
  size,
  height,
  colour,
}: {
  points: LocalPoint[];
  base: number;
  size: number;
  height: number;
  colour: string;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    points.forEach((point, index) => {
      mesh.setMatrixAt(
        index,
        matrix.makeScale(size, height, size).setPosition(point.x, base, point.z),
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [points, base, size, height]);
  return (
    <instancedMesh
      key={points.length}
      ref={ref}
      args={[UNIT_BOX, contextSolidMaterial(colour, 0.85), points.length]}
      castShadow
      receiveShadow
    />
  );
}

/* ---------------------------------------------------------------- buildings */

function solidTone(solid: NeighbourhoodSolid): string {
  if (solid.kind === 'furniture') return CONTEXT_TONES.furniture;
  if (isStructureFinish(solid.material ?? undefined)) {
    return STRUCTURE_FINISHES[solid.material as keyof typeof STRUCTURE_FINISHES].baseColor;
  }
  return surfaceColour(solid.material, solid.category ?? 'structure');
}

function Solid({ solid }: { solid: NeighbourhoodSolid }) {
  const geometries = useMemo(() => {
    const parts =
      solid.kind === 'furniture'
        ? furnitureParts(solid.symbol, solid.ring, solid.base, solid.height)
        : [{ ring: solid.ring, base: solid.base, height: solid.height }];
    return parts.flatMap((part) => {
      const geometry = extrudedGeometry(part.ring, part.base, part.height);
      return geometry ? [{ geometry, cushion: 'cushion' in part && part.cushion === true }] : [];
    });
  }, [solid]);
  useEffect(() => () => geometries.forEach((part) => part.geometry.dispose()), [geometries]);
  const material = contextSolidMaterial(solidTone(solid), 0.85);
  return (
    <>
      {geometries.map(({ geometry, cushion }) => (
        <mesh
          key={geometry.uuid}
          geometry={geometry}
          material={cushion ? cushionMaterial() : material}
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}

function House({ house }: { house: NonNullable<StructureNeighbourhood['house']> }) {
  const walls = useMemo(
    () => extrudedGeometry(house.ring, house.base, house.eaves),
    [house.ring, house.base, house.eaves],
  );
  const material = house.roofMaterial as RoofMaterial;
  const roof = useMemo(
    () => roofGeometry(house.ring, house.base + house.eaves, material),
    [house.ring, house.base, house.eaves, material],
  );
  useEffect(() => () => walls?.dispose(), [walls]);
  useEffect(
    () => () => {
      roof?.roof.dispose();
      roof?.gables?.dispose();
    },
    [roof],
  );
  const wall = contextSolidMaterial(CONTEXT_TONES.houseWall, 0.95);
  return (
    <>
      {walls ? <mesh geometry={walls} material={wall} castShadow receiveShadow /> : null}
      {roof ? (
        <mesh
          geometry={roof.roof}
          material={contextSolidMaterial(ROOF_TONES[material]?.base ?? ROOF_TONES.slate.base, 0.8)}
          castShadow
          receiveShadow
        />
      ) : null}
      {roof?.gables ? (
        <mesh geometry={roof.gables} material={wall} castShadow receiveShadow />
      ) : null}
      {house.openings.map((opening, index) => (
        <Opening key={index} opening={opening} base={house.base} />
      ))}
    </>
  );
}

/** How far a door or a window stands proud of the wall, so it reads without cutting the wall. */
const PROUD = 0.03;
const SOLID_DOORS = new Set(['back-door', 'front-door', 'garage-door']);

/** A door or a window on the wall: a frame, and glass or a door leaf set in it. */
function Opening({ opening, base }: { opening: NeighbourhoodOpening; base: number }) {
  const width = Math.hypot(opening.b.x - opening.a.x, opening.b.z - opening.a.z);
  const height = opening.top - opening.bottom;
  if (width <= 0 || height <= 0) return null;
  const yaw = -Math.atan2(opening.b.z - opening.a.z, opening.b.x - opening.a.x);
  const mid = { x: (opening.a.x + opening.b.x) / 2, z: (opening.a.z + opening.b.z) / 2 };
  const at = (out: number): [number, number, number] => [
    mid.x + opening.outward.x * out,
    base + opening.bottom + height / 2,
    mid.z + opening.outward.z * out,
  ];
  const glazed = !SOLID_DOORS.has(opening.type);
  return (
    <>
      <mesh
        position={at(PROUD / 2)}
        rotation-y={yaw}
        material={contextSolidMaterial(CONTEXT_TONES.frame, 0.6)}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width + 0.12, height + 0.1, PROUD]} />
      </mesh>
      <mesh
        position={at(PROUD + 0.005)}
        rotation-y={yaw}
        material={contextSolidMaterial(
          glazed ? CONTEXT_TONES.glass : CONTEXT_TONES.door,
          glazed ? 0.35 : 0.7,
        )}
      >
        <boxGeometry args={[width - 0.08, height - 0.08, 0.01]} />
      </mesh>
    </>
  );
}
