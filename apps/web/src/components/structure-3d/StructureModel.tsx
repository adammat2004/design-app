'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BackSide, BoxGeometry, ConeGeometry, MeshBasicMaterial } from 'three';
import type { ResolvedStructure, StructurePart, StructurePartGroup } from '@garden-studio/schema';
import { materialForFinish } from '@/lib/structures/materials-3d';
import { modelFor } from '@/lib/structures/model-registry';

/**
 * One structure, drawn from its parts in its own local frame.
 *
 * The frame is the parts' frame — X across the width, Y up, Z along the depth towards the front —
 * with the structure standing on the origin. It is **not** placed in the garden: this is a focused
 * view of one object, so its position and rotation in the plan are irrelevant here and never read.
 * Its size is: every part was sized from the element's rect, so what is on screen is exactly the
 * footprint the plan holds.
 *
 * One shared unit box and one unit pyramid, scaled per part, so a pergola with forty rafters builds
 * two geometries rather than forty. Materials are shared the same way (`materialForFinish`).
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
}: {
  structure: ResolvedStructure;
  /** A part was clicked. Absent, the model is only a picture. */
  onPick?: (group: StructurePartGroup) => void;
}) {
  const parts = useMemo(() => modelFor(structure).build(structure), [structure]);
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
  outlined,
  pick,
}: {
  part: StructurePart;
  outlined: boolean;
  pick: Pick | null;
}) {
  const material = materialForFinish(part.finish);
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
          geometry={UNIT_BOX}
          material={material}
          position={shape.centre}
          scale={shape.size}
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
        geometry={UNIT_PYRAMID}
        material={material}
        position={shape.centre}
        scale={[shape.base[0], shape.rise, shape.base[1]]}
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
