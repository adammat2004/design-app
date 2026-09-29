'use client';

import { useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { CameraControls } from '@react-three/drei';
import { Plane, Vector3 } from 'three';
import type { ResolvedStructure, StructureResizeResult } from '@garden-studio/schema';
import { usePlanEditorStore } from '@/state/plan-editor-store';

/**
 * Handles on the structure's four sides and its top: drag a side to change the footprint, the top to
 * change the height.
 *
 * **Only a size, never a place.** A side handle asks for a width or a depth and nothing else, through
 * the same `planStructureResize` a typed size and the assistant use — so it keeps the side the
 * structure is against, stays inside the sizes it is made in, and stops dead where it would run into
 * something. Moving or turning the structure is a garden decision and stays on the plan.
 *
 * **The view is centred on the structure**, so a side under the pointer at local x is a structure
 * 2|x| wide whichever side the resize actually grew from: when it is anchored against a fence, it is
 * the garden around it that slides, which is what anchoring means.
 *
 * One drag is one undo entry (the gesture bracket), and each frame is planned from the structure as
 * it stood when the drag began. A drag that ends on a size that would not fit changes nothing more
 * and hands the refusal to `onBlocked`, so the settings can say what was in the way.
 */
type Axis = 'x' | 'z' | 'y';

interface Handle {
  id: string;
  axis: Axis;
  position: [number, number, number];
}

const HANDLE_RADIUS = 0.09;
const HANDLE_COLOUR = '#2f7a3e';
const HANDLE_HOVER = '#1b4332';
/** The page's cursor, set from event handlers only. */
const setCursor = (cursor: string) => {
  document.body.style.cursor = cursor;
};
/** Sizes are asked for to the centimetre: finer than that is the pointer shaking, not a decision. */
const round = (metres: number) => Math.round(metres * 100) / 100;

const AXES: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

export function handlesFor(structure: ResolvedStructure, floor = 0): Handle[] {
  const { width, depth, height } = structure;
  const mid = floor + height / 2;
  const clear = HANDLE_RADIUS * 1.6;
  return [
    { id: 'right', axis: 'x', position: [width / 2 + clear, mid, 0] },
    { id: 'left', axis: 'x', position: [-width / 2 - clear, mid, 0] },
    { id: 'front', axis: 'z', position: [0, mid, depth / 2 + clear] },
    { id: 'rear', axis: 'z', position: [0, mid, -depth / 2 - clear] },
    /*
     * Over the rear-right post rather than the middle of the roof: seen from above, the middle is
     * where the table is, and a handle there would take every drag meant for the furniture.
     */
    { id: 'top', axis: 'y', position: [width / 2, height + clear * 1.5, -depth / 2] },
  ];
}

export function StructureHandles({
  elementId,
  structure,
  floor = 0,
  onBlocked,
}: {
  elementId: string;
  structure: ResolvedStructure;
  floor?: number;
  onBlocked: (result: Extract<StructureResizeResult, { status: 'blocked' }>) => void;
}) {
  const getThree = useThree((state) => state.get);
  const [hovered, setHovered] = useState<string | null>(null);
  const drag = useRef<{
    handle: Handle;
    plane: Plane;
    pointerId: number;
    last: StructureResizeResult | null;
  } | null>(null);

  const orbit = (enabled: boolean) => {
    const controls = getThree().controls as CameraControls | null;
    if (controls) controls.enabled = enabled;
  };

  /*
   * The plane the pointer is read on: it contains the handle's axis and faces the camera as squarely
   * as that allows, so a side drags smoothly from any angle rather than racing off to the horizon
   * when the camera is low.
   */
  const planeFor = (handle: Handle) => {
    const axis = AXES[handle.axis];
    const view = new Vector3();
    getThree().camera.getWorldDirection(view);
    const normal = axis.clone().cross(view.clone().cross(axis));
    if (normal.lengthSq() < 1e-6) normal.copy(handle.axis === 'y' ? AXES.z : AXES.y);
    return new Plane().setFromNormalAndCoplanarPoint(
      normal.normalize(),
      new Vector3(...handle.position),
    );
  };

  const release = (event: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    if (!current) return;
    (event.target as unknown as Element).releasePointerCapture?.(current.pointerId);
    drag.current = null;
    usePlanEditorStore.getState().endGesture();
    orbit(true);
    setCursor('');
    if (current.last?.status === 'blocked') onBlocked(current.last);
  };

  return (
    <group>
      {handlesFor(structure, floor).map((handle) => (
        <mesh
          key={handle.id}
          position={handle.position}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(handle.id);
            setCursor(handle.axis === 'y' ? 'ns-resize' : 'ew-resize');
          }}
          onPointerOut={() => {
            setHovered((current) => (current === handle.id ? null : current));
            if (!drag.current) setCursor('');
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            (event.target as unknown as Element).setPointerCapture?.(event.pointerId);
            drag.current = {
              handle,
              plane: planeFor(handle),
              pointerId: event.pointerId,
              last: null,
            };
            usePlanEditorStore.getState().beginGesture();
            orbit(false);
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current || current.handle.id !== handle.id) return;
            event.stopPropagation();
            const at = event.ray.intersectPlane(current.plane, new Vector3());
            if (!at) return;
            const store = usePlanEditorStore.getState();
            if (handle.axis === 'y') {
              store.setStructureHeightLive(elementId, round(at.y - floor));
              return;
            }
            const along = Math.abs(handle.axis === 'x' ? at.x : at.z) - HANDLE_RADIUS * 1.6;
            const request =
              handle.axis === 'x' ? { width: round(along * 2) } : { depth: round(along * 2) };
            current.last = store.resizeStructureLive(elementId, request);
          }}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <sphereGeometry args={[HANDLE_RADIUS, 20, 14]} />
          <meshBasicMaterial color={hovered === handle.id ? HANDLE_HOVER : HANDLE_COLOUR} />
        </mesh>
      ))}
    </group>
  );
}
