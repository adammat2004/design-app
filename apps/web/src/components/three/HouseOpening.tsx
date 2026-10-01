'use client';

import type { NeighbourhoodOpening } from '@garden-studio/schema';
import { CONTEXT_TONES, contextSolidMaterial } from '@/lib/structures/materials-3d';

/**
 * A door or a window drawn on a house's wall, shared by every 3D view — the structure editor's
 * neighbourhood and the whole-garden preview — so a door looks the same in both. It cuts nothing:
 * a frame and a pane or a leaf set proud of the wall, which is all a garden view needs.
 */
/** How far a door or a window stands proud of the wall, so it reads without cutting the wall. */
const PROUD = 0.03;
const SOLID_DOORS = new Set(['back-door', 'front-door', 'garage-door']);

/** A door or a window on the wall: a frame, and glass or a door leaf set in it. */
export function HouseOpening({ opening, base }: { opening: NeighbourhoodOpening; base: number }) {
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
