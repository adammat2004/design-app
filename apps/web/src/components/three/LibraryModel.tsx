'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import { Box3, type Group } from 'three';
import type { AssetRef } from '@garden-studio/ar-contract';
import { libraryModel } from '@/lib/structures/model-library';
import { useResource } from '@/lib/structures/resource';

/** The world-space box a library model was drawn in, for the viewports' test hooks. */
export interface DrawnBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * A library model where the scene says one may stand, and `fallback` until it can.
 *
 * Placed exactly as the `AssetRef` says and nothing more: the base centre at `position`, turned by
 * `yaw` about +Y, and **scaled per axis to `size`** — `size / entry.naturalSize`, the one transform a
 * library entry's promise (metres, base-centred, front +Z) leaves to the renderer. The builder has
 * already decided the model fits; this draws it.
 *
 * `fallback` is the node's own parts. They are what draws while the file is on its way, and for good
 * if it never arrives — a 404, a blocked request, a model removed from the library after the scene
 * was built — because nothing here suspends. The swap is a redraw on a `frameloop="demand"` canvas,
 * so it asks for one.
 */
export function LibraryModel({
  asset,
  fallback,
  onDrawn,
}: {
  asset: AssetRef;
  fallback: ReactNode;
  /** Told the box it was drawn in once it is drawn, and `null` when it goes. */
  onDrawn?: (box: DrawnBox | null) => void;
}) {
  const model = useResource(libraryModel(asset.id));
  const invalidate = useThree((state) => state.invalidate);
  // A clone per use shares the loaded geometry and materials, so nothing here is disposed.
  const clone = useMemo(() => (model ? model.scene.clone(true) : null), [model]);
  const group = useRef<Group>(null);

  useEffect(() => {
    invalidate();
  }, [clone, invalidate]);

  useLayoutEffect(() => {
    if (!clone || !group.current || !onDrawn) return;
    group.current.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(group.current);
    onDrawn({ min: box.min.toArray(), max: box.max.toArray() });
    return () => onDrawn(null);
  }, [clone, asset, onDrawn]);

  if (!model || !clone) return <>{fallback}</>;
  const natural = model.entry.naturalSize;
  const scale: [number, number, number] = [
    asset.size[0] / natural[0],
    asset.size[1] / natural[1],
    asset.size[2] / natural[2],
  ];
  return (
    <group ref={group} position={asset.position} rotation-y={asset.yaw}>
      <primitive object={clone} scale={scale} />
    </group>
  );
}
