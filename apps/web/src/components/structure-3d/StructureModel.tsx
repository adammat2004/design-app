'use client';

import { useMemo } from 'react';
import { BoxGeometry, ConeGeometry } from 'three';
import type { ResolvedStructure, StructurePart } from '@garden-studio/schema';
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

export function StructureModel({ structure }: { structure: ResolvedStructure }) {
  const parts = useMemo(() => modelFor(structure).build(structure), [structure]);

  return (
    <group>
      {parts.map((part) => (
        <PartMesh key={part.id} part={part} />
      ))}
    </group>
  );
}

function PartMesh({ part }: { part: StructurePart }) {
  const material = materialForFinish(part.finish);
  const { shape } = part;
  // A light strip gives light rather than blocking it.
  const casts = part.group !== 'light';

  if (shape.kind === 'box') {
    return (
      <mesh
        geometry={UNIT_BOX}
        material={material}
        position={shape.centre}
        scale={shape.size}
        castShadow={casts}
        receiveShadow
      />
    );
  }

  return (
    <mesh
      geometry={UNIT_PYRAMID}
      material={material}
      position={shape.centre}
      scale={[shape.base[0], shape.rise, shape.base[1]]}
      castShadow
      receiveShadow
    />
  );
}
