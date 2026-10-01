'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { Plane, Vector3 } from 'three';
import type { CameraControls } from '@react-three/drei';
import {
  elementOutline,
  structureFloor,
  type DesignElement,
  type LocalFrame,
  type LocalPoint,
  type NeighbourhoodSolid,
  type Point,
} from '@garden-studio/schema';
import {
  contextSolidMaterial,
  cushionMaterial,
  dressFloor,
  furnitureMaterial,
  PIECE_OUTLINE,
  rasterSurfaceMaterial,
} from '@/lib/structures/materials-3d';
import { furnitureModel } from '@/lib/structures/furniture-models';
import { fitToFootprint } from '@/lib/structures/model-fit';
import { useResource } from '@/lib/structures/resource';
import { rasterUv, surfaceRaster } from '@/lib/structures/surface-raster';
import {
  extrudedGeometry,
  furnitureParts,
  surfaceColour,
  surfaceGeometry,
  tiledUv,
} from '@/lib/structures/surroundings-geometry';
import { usePlanEditorStore } from '@/state/plan-editor-store';

/**
 * The furniture standing inside the structure — the part of the 3D view you can pick up.
 *
 * Hover outlines a piece, a press picks it up (the Inside tab follows), and a drag slides it across
 * the floor: the pointer's ray is met with the floor plane in the structure's own frame, turned back
 * into plan metres, and handed to `movePieceLive`, which holds the piece inside the structure. The
 * whole drag is one gesture, so one undo entry. The camera stops orbiting while a piece is held,
 * or the drag would also swing the view.
 *
 * A piece with a model in the furniture library (`furniture-models.ts`) is drawn as that model, fitted
 * into its footprint by one uniform scale (`fitToFootprint`) and dressed in the piece's own material;
 * until it arrives, if it never does, or if it would not fit, it is the boxes `furnitureParts` draws,
 * at the same places — the layouts are shared, so nothing jumps when the model lands.
 */
export function StructureInterior({
  pieces,
  frame,
  floor,
  pieceId,
}: {
  pieces: NeighbourhoodSolid[];
  frame: LocalFrame;
  /** Height of the floor surface the pieces stand on. */
  floor: number;
  pieceId: string | null;
}) {
  return (
    <>
      {pieces.map((piece) => (
        <Piece
          key={piece.id}
          piece={piece}
          frame={frame}
          floor={floor}
          selected={piece.id === pieceId}
        />
      ))}
    </>
  );
}

function Piece({
  piece,
  frame,
  floor,
  selected,
}: {
  piece: NeighbourhoodSolid;
  frame: LocalFrame;
  floor: number;
  selected: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  // Read at the moment of the drag rather than held from render: the orbit is switched off while a
  // piece is carried, and a value captured during render is not ours to change afterwards.
  const getThree = useThree((state) => state.get);
  const orbit = (enabled: boolean) => {
    const controls = getThree().controls as CameraControls | null;
    if (controls) controls.enabled = enabled;
  };
  const drag = useRef<{ offset: LocalPoint; pointerId: number } | null>(null);
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -floor), [floor]);

  const model = useResource(furnitureModel(piece.symbol));
  const fit = useMemo(
    () => (model ? fitToFootprint(model.entry.naturalSize, piece.ring, piece.base + floor) : null),
    [model, piece.ring, piece.base, floor],
  );

  const geometries = useMemo(
    () =>
      (fit
        ? []
        : furnitureParts(piece.symbol, piece.ring, piece.base + floor, piece.height)
      ).flatMap((part) => {
        const geometry = extrudedGeometry(part.ring, part.base, part.height);
        return geometry ? [{ geometry, cushion: part.cushion === true }] : [];
      }),
    [piece, floor, fit],
  );
  useEffect(() => () => geometries.forEach((part) => part.geometry.dispose()), [geometries]);

  const centre = useMemo(() => {
    const sum = piece.ring.reduce((acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }), {
      x: 0,
      z: 0,
    });
    return { x: sum.x / piece.ring.length, z: sum.z / piece.ring.length };
  }, [piece.ring]);

  const hit = (event: ThreeEvent<PointerEvent>): LocalPoint | null => {
    const at = event.ray.intersectPlane(plane, new Vector3());
    return at ? { x: at.x, z: at.z } : null;
  };

  const release = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    (event.target as unknown as Element).releasePointerCapture?.(drag.current.pointerId);
    drag.current = null;
    usePlanEditorStore.getState().endGesture();
    orbit(true);
  };

  const material = furnitureMaterial(piece.material ?? undefined);
  const outline = selected || hovered;

  return (
    <group
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'grab';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = '';
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        const at = hit(event);
        const store = usePlanEditorStore.getState();
        store.selectPiece(piece.id);
        if (!at) return;
        (event.target as unknown as Element).setPointerCapture?.(event.pointerId);
        drag.current = {
          offset: { x: centre.x - at.x, z: centre.z - at.z },
          pointerId: event.pointerId,
        };
        store.beginGesture();
        orbit(false);
        document.body.style.cursor = 'grabbing';
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        event.stopPropagation();
        const at = hit(event);
        if (!at) return;
        const local = { x: at.x + drag.current.offset.x, z: at.z + drag.current.offset.z };
        usePlanEditorStore.getState().movePieceLive(piece.id, frame.toPlan(local));
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {model && fit ? (
        <mesh
          geometry={model.geometry}
          material={material}
          position={fit.position}
          rotation-y={fit.yaw}
          scale={fit.scale}
          castShadow
          receiveShadow
        >
          {outline ? (
            <Outlines
              thickness={selected ? 3 : 2}
              color={PIECE_OUTLINE}
              opacity={selected ? 1 : 0.6}
              transparent
            />
          ) : null}
        </mesh>
      ) : null}
      {geometries.map(({ geometry, cushion }) => (
        <mesh
          key={geometry.uuid}
          geometry={geometry}
          material={cushion ? cushionMaterial() : material}
          castShadow
          receiveShadow
        >
          {outline ? (
            <Outlines
              thickness={selected ? 3 : 2}
              color={PIECE_OUTLINE}
              opacity={selected ? 1 : 0.6}
              transparent
            />
          ) : null}
        </mesh>
      ))}
    </group>
  );
}

/** How thick a structure's floor is laid: a slab of paving or a deck, standing proud of the ground. */
export const FLOOR_THICKNESS = 0.04;

/**
 * The floor laid inside the structure, painted by the plan's own surface painter so its slabs and
 * joints are the ones the 2D plan draws. Nothing where the structure stands on the garden's ground.
 */
export function StructureFloor({
  element,
  elements,
  frame,
  light,
}: {
  element: DesignElement;
  elements: DesignElement[];
  frame: LocalFrame;
  light: Point | undefined;
}) {
  const built = useMemo(() => {
    const floor = structureFloor(element);
    if (!floor) return null;
    const ring = elementOutline(floor).map(frame.toLocal);
    const raster = surfaceRaster(floor, elements, light);
    const geometry = surfaceGeometry(
      ring,
      FLOOR_THICKNESS,
      raster ? rasterUv(raster, frame) : tiledUv(1, 1),
      FLOOR_THICKNESS,
      // Relief under the painted joints, laid in metres (`dressFloor`).
      (point) => [point.x, -point.z],
    );
    if (!geometry) return null;
    if (raster) {
      const { material, texture } = rasterSurfaceMaterial(
        raster.canvas as unknown as HTMLCanvasElement,
      );
      if (floor.material) dressFloor(material, floor.material);
      return { geometry, material, dispose: () => (texture.dispose(), material.dispose()) };
    }
    return {
      geometry,
      material: contextSolidMaterial(surfaceColour(floor.material ?? null, 'paved-area'), 0.9),
      dispose: () => undefined,
    };
  }, [element, elements, frame, light]);
  useEffect(
    () => () => {
      built?.geometry.dispose();
      built?.dispose();
    },
    [built],
  );
  if (!built) return null;
  return <mesh geometry={built.geometry} material={built.material} castShadow receiveShadow />;
}
