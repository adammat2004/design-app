'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { CameraControls, ContactShadows, Environment, Lightformer, useTexture } from '@react-three/drei';
import { ACESFilmicToneMapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { ResolvedStructure } from '@garden-studio/schema';
import { StructureModel } from './StructureModel';

/**
 * The 3D view of one structure: the structure is the hero, and the setting is deliberately small.
 *
 * **Not a garden renderer.** A lawn, a paved pad the size of the footprint, a soft sky — enough to
 * read scale and shade, and nothing that tries to be the user's garden. Rebuilding the garden here
 * would be the retired Visualise view in a new engine, and the plan is where the garden is judged.
 *
 * - **Light**: one sun with a soft shadow map, plus a procedural environment built from
 *   `Lightformer`s rather than a downloaded HDRI, so metal and timber have something to reflect with
 *   no network request — the app has to work offline and with no keys.
 * - **Grounding**: `ContactShadows` under the posts, which is most of what stops a product render
 *   floating.
 * - **Cost**: `frameloop="demand"` — nothing is drawn unless the camera moves or the structure
 *   changes, so an idle configurator costs nothing. Device pixel ratio is capped at 2.
 * - **Tone**: ACES filmic with sRGB output, the three.js defaults R3F sets, stated so they are not
 *   lost to a later default change.
 */
export type CameraPreset = 'orbit' | 'front' | 'side' | 'top';

export function StructureViewport({
  structure,
  preset,
  presetKey,
}: {
  structure: ResolvedStructure;
  /** Which view to fly to. `orbit` is the three-quarter view it opens on. */
  preset: CameraPreset;
  /** Bumped to fly to the same preset again, which is what Reset does. */
  presetKey: number;
}) {
  const { width, depth, height } = structure;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      camera={{ fov: 38, near: 0.1, far: 200, position: orbitPosition(width, depth, height) }}
    >
      <color attach="background" args={['#e9eee8']} />
      <fog attach="fog" args={['#e9eee8', 22, 60]} />

      <Lighting span={Math.max(width, depth)} />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#fff4e2" position={[-8, 3, 6]} scale={[8, 4, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={0.5} color="#dfe8ff" position={[8, 3, -6]} scale={[8, 4, 1]} target={[0, 1, 0]} />
      </Environment>

      <Suspense fallback={<PlainGround width={width} depth={depth} />}>
        <TexturedGround width={width} depth={depth} />
      </Suspense>
      <ContactShadows position={[0, 0.012, 0]} scale={Math.max(width, depth) * 2.4} blur={2.4} far={3} opacity={0.5} resolution={512} />

      <StructureModel structure={structure} />
      {structure.lighting ? (
        <pointLight position={[0, height * 0.72, 0]} intensity={4} distance={Math.max(width, depth) * 1.6} color="#ffcf8a" decay={2} />
      ) : null}

      <Camera structure={structure} preset={preset} presetKey={presetKey} />
    </Canvas>
  );
}

function Lighting({ span }: { span: number }) {
  const reach = Math.max(4, span);
  return (
    <>
      <hemisphereLight args={['#f4f7ff', '#6f7d5c', 0.45]} />
      <directionalLight
        castShadow
        position={[reach * 1.1, reach * 1.8, reach * 0.9]}
        intensity={2.4}
        color="#fff6e8"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-camera-left={-reach * 1.4}
        shadow-camera-right={reach * 1.4}
        shadow-camera-top={reach * 1.4}
        shadow-camera-bottom={-reach * 1.4}
        shadow-camera-near={0.5}
        shadow-camera-far={reach * 6}
      />
    </>
  );
}

const PAD_MARGIN = 0.5;

function PlainGround({ width, depth }: { width: number; depth: number }) {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial color="#7f9a62" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} receiveShadow>
        <planeGeometry args={[width + PAD_MARGIN * 2, depth + PAD_MARGIN * 2]} />
        <meshStandardMaterial color="#cfc8b8" roughness={0.9} />
      </mesh>
    </>
  );
}

/**
 * The lawn and the paving pad, in the plan library's own photographs.
 *
 * The same tiles the 2D plan draws with, at their real sizes (turf 1.5 m, a paving slab 0.6 m), so
 * the ground reads at the scale the structure does. Wrapped in Suspense with the flat version as the
 * fallback: a missing file is a supported state everywhere in this app.
 */
function TexturedGround({ width, depth }: { width: number; depth: number }) {
  const [turf, paver] = useTexture(['/assets/plan/textures/tex-standard-turf-1.webp', '/assets/plan/textures/face-stone-paver-1.webp']);
  const padW = width + PAD_MARGIN * 2;
  const padD = depth + PAD_MARGIN * 2;
  // Clones, because `useTexture` caches one texture per URL for the whole page.
  const lawn = useMemo(() => tiled(turf!, 60 / 1.5, 60 / 1.5), [turf]);
  const pad = useMemo(() => tiled(paver!, padW / 0.6, padD / 0.6), [paver, padW, padD]);
  useEffect(() => () => lawn.dispose(), [lawn]);
  useEffect(() => () => pad.dispose(), [pad]);

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial map={lawn} color="#c9d6bb" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} receiveShadow>
        <planeGeometry args={[padW, padD]} />
        <meshStandardMaterial map={pad} roughness={0.85} />
      </mesh>
    </>
  );
}

function tiled(source: Texture, repeatU: number, repeatV: number): Texture {
  const texture = source.clone();
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.repeat.set(repeatU, repeatV);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Where the three-quarter view stands, far enough back to see the whole structure. */
function orbitPosition(width: number, depth: number, height: number): [number, number, number] {
  const reach = Math.max(width, depth, height) * 1.6 + 2;
  return [reach * 0.8, height * 0.9 + reach * 0.35, reach];
}

/**
 * The camera, and the flights to each preset.
 *
 * `CameraControls` rather than `OrbitControls` because presets want an animated move to an exact
 * look-at, which camera-controls does natively. The polar angle is clamped short of the horizon so a
 * user cannot orbit under the lawn, and distance is clamped to the structure's own size.
 */
function Camera({ structure, preset, presetKey }: { structure: ResolvedStructure; preset: CameraPreset; presetKey: number }) {
  const controls = useRef<CameraControls>(null);
  const invalidate = useThree((state) => state.invalidate);
  const { width, depth, height } = structure;
  const size = Math.max(width, depth, height);
  /*
   * The latest size, read by the flight without being one of its triggers: resizing the structure
   * must not throw away wherever the user has orbited to. Only choosing a preset — or Reset, which
   * bumps `presetKey` — flies the camera.
   */
  const dimensions = useRef({ width, depth, height });
  useEffect(() => {
    dimensions.current = { width, depth, height };
  }, [width, depth, height]);

  useEffect(() => {
    const camera = controls.current;
    if (!camera) return;
    const { width: w, depth: d, height: h } = dimensions.current;
    const reach = Math.max(w, d, h) * 1.6 + 2;
    const targetY = h * 0.45;
    const [x, y, z] =
      preset === 'front'
        ? [0, targetY + 0.3, reach]
        : preset === 'side'
          ? [reach, targetY + 0.3, 0]
          : preset === 'top'
            ? [0, reach * 1.35, 0.001]
            : orbitPosition(w, d, h);
    void camera.setLookAt(x, y, z, 0, preset === 'top' ? 0 : targetY, 0, true);
    invalidate();
  }, [preset, presetKey, invalidate]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={size * 0.6}
      maxDistance={size * 5 + 6}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.06}
      smoothTime={0.35}
    />
  );
}
