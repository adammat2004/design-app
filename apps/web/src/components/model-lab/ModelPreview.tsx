'use client';

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { BoxGeometry, EdgesGeometry, NeutralToneMapping, SRGBColorSpace, type Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * A processed model as the reviewer judges it: on a half-metre grid, inside the box it measures,
 * with an arrow along +Z — the way a library entry promises its front faces.
 *
 * `turnDeg` is the quarter turn the reviewer is trying, *relative to the turn the file was processed
 * with*, so what is on screen is what publishing with that turn will produce: the reviewer turns it
 * until the model's front looks down the arrow. A gazebo has no front, and any turn will do; a shed's
 * door has one, and only a person can say which face it is.
 */
export function ModelPreview({
  url,
  turnDeg,
  size,
  stretchY = 1,
}: {
  url: string;
  turnDeg: number;
  /** Width, height, depth of the processed model, in metres. */
  size: [number, number, number];
  /** An upright stretch to show before it is applied, relative to the processed file. */
  stretchY?: number;
}) {
  const [scene, setScene] = useState<Group | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.loadAsync(url).then(
      (gltf) => {
        if (!alive) return;
        gltf.scene.traverse((object) => {
          object.castShadow = true;
          object.receiveShadow = true;
        });
        setScene(gltf.scene);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const [w, unstretched, d] = size;
  const h = unstretched * stretchY;
  const reach = Math.max(w, h, d);
  const box = useMemo(() => new EdgesGeometry(new BoxGeometry(w, h, d)), [w, h, d]);
  useEffect(() => () => box.dispose(), [box]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-garden-muted">
        The processed model could not be loaded.
      </div>
    );
  }

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: NeutralToneMapping, outputColorSpace: SRGBColorSpace }}
      camera={{ fov: 38, position: [reach * 1.6, reach * 1.1, reach * 1.9] }}
    >
      <color attach="background" args={['#f3f1ec']} />
      <hemisphereLight args={['#ffffff', '#b8b2a4', 1.2]} />
      <directionalLight position={[reach * 2, reach * 3, reach * 1.5]} intensity={2.2} castShadow />
      <Grid
        args={[reach * 4, reach * 4]}
        cellSize={0.5}
        sectionSize={1}
        cellColor="#c9c3b5"
        sectionColor="#9d9686"
        fadeDistance={reach * 6}
      />
      {scene ? (
        <group rotation-y={(turnDeg * Math.PI) / 180} scale={[1, stretchY, 1]}>
          <primitive object={scene} />
        </group>
      ) : null}
      {/* The box the model measures, which is the footprint it will be fitted to. */}
      <lineSegments geometry={box} position={[0, h / 2, 0]}>
        <lineBasicMaterial color="#2f7a3e" />
      </lineSegments>
      {/* +Z: where the front must face. */}
      <group position={[0, 0.02, d / 2 + 0.35]}>
        <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.25]}>
          <coneGeometry args={[0.18, 0.4, 3]} />
          <meshBasicMaterial color="#d9772b" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.08, 0.5]} />
          <meshBasicMaterial color="#d9772b" />
        </mesh>
      </group>
      <OrbitControls makeDefault target={[0, h / 2, 0]} />
    </Canvas>
  );
}
