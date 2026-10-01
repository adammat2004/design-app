'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BackSide, BoxGeometry, ConeGeometry, MeshBasicMaterial, type BufferGeometry } from 'three';
import type { ResolvedStructure, StructurePart, StructurePartGroup } from '@garden-studio/schema';
import { hardwareMaterial, materialForFinish } from '@/lib/structures/materials-3d';
import { modelFor } from '@/lib/structures/model-registry';
import { partGeometry } from '@/lib/structures/part-geometry';

/**
 * One structure, drawn from its parts in its own local frame.
 *
 * The frame is the parts' frame — X across the width, Y up, Z along the depth towards the front —
 * with the structure standing on the origin. It is **not** placed in the garden: this is a focused
 * view of one object, so its position and rotation in the plan are irrelevant here and never read.
 * Its size is: every part was sized from the element's rect, so what is on screen is exactly the
 * footprint the plan holds.
 *
 * Each part is its own mesh at its real size (`partGeometry`), with texture coordinates in metres and
 * the grain along its length — a shared unit box scaled per part was cheaper and smeared any texture
 * fifty times along a rafter. Materials are still shared per finish (`materialForFinish`). The hover
 * outline keeps the scaled unit shapes: it is a flat colour, so there is nothing to smear.
 */
const UNIT_BOX = new BoxGeometry(1, 1, 1);
/*
 * A four-sided cone turned a quarter so its base edges run along X and Z, then shifted so it stands
 * on its base: scaled by (w, rise, d) it is a hipped roof exactly covering a w × d footprint.
 */
const UNIT_PYRAMID = (() => {
  const geometry = new ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  geometry.rotateY(Math.PI / 4);
  geometry.translate(0, 0.5, 0);
  geometry.computeVertexNormals();
  return geometry;
})();

/*
 * The outline a hovered part is drawn with: its own shape, a few centimetres larger, back faces only,
 * so it shows as a rim round the part rather than a skin over it. Garden green, the colour the rest
 * of the editor says "you are pointing at this" with. A fixed margin rather than a scale, because a
 * 75 mm rafter scaled by a few per cent grows by nothing anyone could see.
 */
const OUTLINE = new MeshBasicMaterial({
  color: '#2f7a3e',
  side: BackSide,
  transparent: true,
  opacity: 0.9,
});
const OUTLINE_MARGIN = 0.04;
/** How long a clicked part stays outlined, so the eye can join the click to the tab that opened. */
const FLASH_MS = 1000;
/** A press that travelled further than this was an orbit, not a click. */
const CLICK_TRAVEL_PX = 4;

export function StructureModel({
  structure,
  onPick,
  detail = true,
}: {
  structure: ResolvedStructure;
  /** A part was clicked. Absent, the model is only a picture. */
  onPick?: (group: StructurePartGroup) => void;
  /**
   * Whether it is drawn in its full materials. A neighbouring structure is context, and context in
   * this view is flat and muted so the one being edited is the thing that reads.
   */
  detail?: boolean;
}) {
  const parts = useMemo(() => modelFor(structure).build(structure), [structure]);
  const geometries = useMemo(
    () =>
      new Map(
        parts.map((part) => [part.id, partGeometry(part, { model: structure.model })] as const),
      ),
    [parts, structure.model],
  );
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  const [hovered, setHovered] = useState<StructurePartGroup | null>(null);
  const [flashed, setFlashed] = useState<StructurePartGroup | null>(null);
  useEffect(() => {
    if (!flashed) return;
    const timer = window.setTimeout(() => setFlashed(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashed]);
  useEffect(() => () => void (document.body.style.cursor = ''), []);

  const pick = onPick
    ? {
        onPointerOver: (event: ThreeEvent<PointerEvent>, group: StructurePartGroup) => {
          event.stopPropagation();
          setHovered(group);
          document.body.style.cursor = 'pointer';
        },
        // Only the part being left: moving from one rafter to the next may report the new one first.
        onPointerOut: (group: StructurePartGroup) => {
          setHovered((current) => (current === group ? null : current));
          document.body.style.cursor = '';
        },
        onClick: (event: ThreeEvent<MouseEvent>, group: StructurePartGroup) => {
          event.stopPropagation();
          if (event.delta > CLICK_TRAVEL_PX) return;
          setFlashed(group);
          onPick(group);
        },
      }
    : null;

  return (
    <group>
      {parts.map((part) => (
        <PartMesh
          key={part.id}
          part={part}
          geometry={geometries.get(part.id)!}
          detail={detail}
          outlined={part.group === hovered || part.group === flashed}
          pick={pick}
        />
      ))}
    </group>
  );
}

type Pick = {
  onPointerOver: (event: ThreeEvent<PointerEvent>, group: StructurePartGroup) => void;
  onPointerOut: (group: StructurePartGroup) => void;
  onClick: (event: ThreeEvent<MouseEvent>, group: StructurePartGroup) => void;
};

function PartMesh({
  part,
  geometry,
  detail,
  outlined,
  pick,
}: {
  part: StructurePart;
  geometry: BufferGeometry;
  detail: boolean;
  outlined: boolean;
  pick: Pick | null;
}) {
  const finish = materialForFinish(part.finish, { detail });
  // A part with hardware — a timber post in its shoe — draws its second group in galvanised steel.
  const material = geometry.groups.length > 0 ? [finish, hardwareMaterial({ detail })] : finish;
  const { shape } = part;
  // A light strip gives light rather than blocking it.
  const casts = part.group !== 'light';
  const handlers = pick
    ? {
        onPointerOver: (event: ThreeEvent<PointerEvent>) => pick.onPointerOver(event, part.group),
        onPointerOut: () => pick.onPointerOut(part.group),
        onClick: (event: ThreeEvent<MouseEvent>) => pick.onClick(event, part.group),
      }
    : {};

  if (shape.kind === 'box') {
    const [w, h, d] = shape.size;
    return (
      <>
        <mesh
          geometry={geometry}
          material={material}
          position={shape.centre}
          castShadow={casts}
          receiveShadow
          {...handlers}
        />
        {outlined ? (
          <mesh
            geometry={UNIT_BOX}
            material={OUTLINE}
            position={shape.centre}
            scale={[w + OUTLINE_MARGIN, h + OUTLINE_MARGIN, d + OUTLINE_MARGIN]}
            raycast={() => null}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        position={shape.centre}
        castShadow
        receiveShadow
        {...handlers}
      />
      {outlined ? (
        <mesh
          geometry={UNIT_PYRAMID}
          material={OUTLINE}
          position={[shape.centre[0], shape.centre[1] - OUTLINE_MARGIN / 2, shape.centre[2]]}
          scale={[
            shape.base[0] + OUTLINE_MARGIN,
            shape.rise + OUTLINE_MARGIN,
            shape.base[1] + OUTLINE_MARGIN,
          ]}
          raycast={() => null}
        />
      ) : null}
    </>
  );
}
