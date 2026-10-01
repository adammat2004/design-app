'use client';

import { useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, CameraControls, Sky, SoftShadows } from '@react-three/drei';
import { NeutralToneMapping, SRGBColorSpace } from 'three';
import type { ARScene } from '@garden-studio/ar-contract';
import type { DrawnBox } from '../three/LibraryModel';
import { SceneNodes } from '../three/SceneNodes';
import { Finish, HAZE, SkyLight, type ViewportReport } from '../three/SceneAtmosphere';
import { cameraView, PREVIEW_FOV, sceneReach, type PreviewView } from '@/lib/ar/preview';

/**
 * The whole garden in 3D, drawn from the `ARScene` and from nothing else.
 *
 * A **preview**, not an editor: nothing here moves anything. Geometry is changed on the plan, and a
 * pergola or a gazebo is configured in its own editor, which a click on one opens. It shares the
 * structure editor's light, sky and finish (`SceneAtmosphere`) and its renderer (`SceneNodes`), so a
 * fence, a tree or a pergola looks the same here as round the structure being configured.
 *
 * Drawing only what the scene says is the point: the phone reads the same scene, so anything wrong
 * here — a patio in the wrong place, a lawn with a hole it should not have — is wrong on the phone
 * too, and is found on a desk rather than in a garden.
 */
export function GardenViewport({
  scene,
  sun,
  view,
  viewKey,
  pickable,
  onPick,
  coarse,
  onReport,
  onAssetDrawn,
}: {
  scene: ARScene;
  /** Unit vector towards the plan's sun, in scene coordinates. */
  sun: [number, number, number];
  view: PreviewView;
  /** Bumped to fly to the same view again. */
  viewKey: number;
  /** Nodes a click opens in the structure editor, by source element id. */
  pickable: ReadonlySet<string>;
  onPick?: (elementId: string) => void;
  coarse: boolean;
  onReport?: (report: ViewportReport) => void;
  /** Where each library model was drawn: the preview's alignment hook. */
  onAssetDrawn?: (sourceId: string, box: DrawnBox | null) => void;
}) {
  const reach = sceneReach(scene);
  const start = cameraView(scene, view);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ antialias: true, toneMapping: NeutralToneMapping, outputColorSpace: SRGBColorSpace }}
      performance={{ min: 0.5 }}
      camera={{ fov: PREVIEW_FOV, near: 0.1, far: 400, position: start.position }}
    >
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, reach * 1.2, reach * 3 + 30]} />
      <Sky
        distance={300}
        sunPosition={[sun[0] * 100, sun[1] * 100, sun[2] * 100]}
        turbidity={5}
        rayleigh={0.9}
        mieCoefficient={0.004}
        mieDirectionalG={0.8}
      />
      <SoftShadows size={22} samples={12} focus={0.6} />
      <SkyLight span={reach} sun={sun} />

      {/* The world beyond the plot, below its lowest surface so the garden's own ground draws over it. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[reach * 4 + 20, 64]} />
        <meshStandardMaterial color="#7f9a62" roughness={1} />
      </mesh>

      {/*
        Drawn from the scene alone — no painted ground, no full structure models — because it shows
        what the phone will. A library model is the scene's own `asset`, so the phone draws it too.
      */}
      <SceneNodes scene={scene} pickable={pickable} onPick={onPick} onAssetDrawn={onAssetDrawn} />

      <Camera scene={scene} view={view} viewKey={viewKey} reach={reach} />
      <AdaptiveDpr />
      <Finish coarse={coarse} onReport={onReport} />
    </Canvas>
  );
}

/* ------------------------------------------------------------------ camera */

/**
 * The camera, and the flights between the two views. Only choosing a view (or choosing it again,
 * which bumps `viewKey`) flies the camera; the scene changing does not throw away where somebody has
 * orbited to. Clamped short of the horizon so nobody orbits under the lawn.
 */
function Camera({
  scene,
  view,
  viewKey,
  reach,
}: {
  scene: ARScene;
  view: PreviewView;
  viewKey: number;
  reach: number;
}) {
  const controls = useRef<CameraControls>(null);
  const invalidate = useThree((state) => state.invalidate);
  const latest = useRef(scene);
  useEffect(() => {
    latest.current = scene;
  }, [scene]);
  useEffect(() => {
    const camera = controls.current;
    if (!camera) return;
    const { position, target } = cameraView(latest.current, view);
    void camera.setLookAt(...position, ...target, true);
    invalidate();
  }, [view, viewKey, invalidate]);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      regress
      minDistance={0.5}
      maxDistance={reach * 4 + 20}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.02}
      smoothTime={0.4}
    />
  );
}
