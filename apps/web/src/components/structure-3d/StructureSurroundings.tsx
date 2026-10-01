'use client';

import { useCallback, useMemo } from 'react';
import { planToGround, yawFromPlanDegrees, type ARScene, type SurfaceNode, type SolidNode } from '@garden-studio/ar-contract';
import {
  NEIGHBOURHOOD_REACH,
  piecesInside,
  resolveStructure,
  type DesignElement,
  type Point,
} from '@garden-studio/schema';
import { sceneFrameOf } from '@/lib/ar/preview';
import { rasterSurfaceMaterial } from '@/lib/structures/materials-3d';
import { rasterUv, surfaceRaster } from '@/lib/structures/surface-raster';
import { SceneNodes, type PaintedGround } from '../three/SceneNodes';
import { LibraryModel } from '../three/LibraryModel';
import { StructureModel } from './StructureModel';

/**
 * The garden around the structure being edited — the AR scene builder's scene of the plan, drawn by
 * the same renderer as the whole-garden preview (`SceneNodes`), under one transform into the
 * structure's local frame. So the fence, the house with its doors, the trees, the retaining walls and
 * the edging round a pergola are the ones the phone will show; there is no second opinion here about
 * where anything is, which is what this used to be (`structureNeighbourhood`, now only a frame and
 * the furniture inside).
 *
 * Two things are drawn better than the scene alone can, because this view holds the plan and is
 * where a structure is judged against its setting:
 *
 * - **The ground near it is painted by the plan's own surface painter** — slabs, joints, gravel, turf —
 *   looked up by each surface's `sourceId`. Only within `NEIGHBOURHOOD_REACH`: a raster is up to
 *   2048 px square, and painting every zone of a whole garden would spend hundreds of megabytes on
 *   ground the fog has taken. Beyond it the scene's own colour, which is the painted colour's mean.
 * - **A neighbouring pergola or gazebo is its full model** (`StructureModel`), bevels and all, rather
 *   than the plain boxes the scene carries for a renderer that has no parts builder.
 *
 * The structure itself, its floor and the furniture inside it are left out: they are drawn live by the
 * editor, which is what is being edited.
 */
export function StructureSurroundings({
  scene,
  element,
  elements,
  light,
}: {
  scene: ARScene;
  /** The structure being edited. */
  element: DesignElement;
  /** The plan as it stands when no gesture is open: what the scene was built from. */
  elements: DesignElement[];
  /** The plan's light, so the painted ground is lit from where the 3D sun is. */
  light: Point | undefined;
}) {
  const origin = scene.frame.origin.plan;
  const byId = useMemo(() => new Map(elements.map((item) => [item.id, item])), [elements]);
  const frame = useMemo(() => sceneFrameOf(scene), [scene]);
  const exclude = useMemo(
    () => new Set([element.id, ...piecesInside(element, elements).map((piece) => piece.id)]),
    [element, elements],
  );

  const shape = element.shape.kind === 'rect' ? element.shape : null;
  const centre = shape ? planToGround(shape.centre, origin) : ([0, 0] as const);
  const yaw = yawFromPlanDegrees(shape?.rotation ?? 0);
  const base = element.elevation ?? 0;
  const reach = (shape ? Math.max(shape.width, shape.depth) / 2 : 0) + NEIGHBOURHOOD_REACH;

  const paintGround = useCallback(
    (node: SurfaceNode): PaintedGround | null => {
      const source = node.sourceId ? byId.get(node.sourceId) : undefined;
      if (!source || !withinReach(node.outline, centre, reach)) return null;
      const raster = surfaceRaster(source, elements, light);
      if (!raster) return null;
      const uvOf = rasterUv(raster, frame);
      const { material, texture } = rasterSurfaceMaterial(raster.canvas as unknown as HTMLCanvasElement);
      return {
        material,
        uv: (x, z) => uvOf({ x, z }),
        dispose: () => {
          texture.dispose();
          material.dispose();
        },
      };
    },
    // `centre` is a fresh tuple each render; its numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byId, elements, light, frame, centre[0], centre[1], reach],
  );

  const drawSolid = useCallback(
    (node: SolidNode) => {
      const source = node.sourceId ? byId.get(node.sourceId) : undefined;
      const resolved = source ? resolveStructure(source) : null;
      if (!source || !resolved || source.shape.kind !== 'rect') return undefined;
      const [x, z] = planToGround(source.shape.centre, origin);
      const parts = (
        <group position={[x, source.elevation ?? 0, z]} rotation-y={yawFromPlanDegrees(source.shape.rotation ?? 0)}>
          <StructureModel structure={resolved} detail={false} />
        </group>
      );
      // A neighbour a library model depicts is drawn with it, as the preview draws it.
      return node.asset ? <LibraryModel asset={node.asset} fallback={parts} /> : parts;
    },
    [byId, origin],
  );

  // Scene → local: move the structure's centre and base to the origin, then turn by its own yaw.
  return (
    <group rotation-y={-yaw}>
      <group position={[-centre[0], -base, -centre[1]]}>
        <SceneNodes scene={scene} exclude={exclude} paintGround={paintGround} drawSolid={drawSolid} />
      </group>
    </group>
  );
}

/** Whether any of a surface reaches into the square the structure's detail is drawn within. */
function withinReach(outline: [number, number][], centre: readonly [number, number], reach: number): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of outline) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  // A circle round the square's corners, so a turned structure's window is covered too.
  const r = reach * Math.SQRT2;
  return maxX >= centre[0] - r && minX <= centre[0] + r && maxZ >= centre[1] - r && minZ <= centre[1] + r;
}
