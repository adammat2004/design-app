'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  CameraControls,
  ContactShadows,
  Environment,
  Lightformer,
  Sky,
  SoftShadows,
  useTexture,
} from '@react-three/drei';
import { ACESFilmicToneMapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type {
  DesignElement,
  LocalFrame,
  NeighbourhoodSolid,
  Point,
  ResolvedStructure,
  StructureNeighbourhood,
  StructurePartGroup,
  StructureResizeResult,
} from '@garden-studio/schema';
import { StructureFloor, StructureInterior, FLOOR_THICKNESS } from './StructureInterior';
import { StructureHandles } from './StructureHandles';
import { StructureModel } from './StructureModel';
import { StructureSurroundings } from './StructureSurroundings';

/**
 * The 3D view of one structure: the structure is the hero, and the setting is its neighbourhood.
 *
 * **Its neighbourhood, not the garden.** With the surroundings on, the garden a few metres round the
 * structure is drawn from `structureNeighbourhood` — the terrace it stands on, the beds planted as the
 * plan plants them, the fence, the house with its doors, the trees — cut to a window and fading into
 * the haze, so a size or a screen is judged against the place. Beyond the window is a plain lawn. Off,
 * it is the structure alone on that lawn. Rebuilding the whole garden here would be the retired
 * Visualise view in a new engine, and the plan is where the garden is judged.
 *
 * - **What is inside it** — its floor and the furniture standing in it — is always drawn, and the
 *   furniture can be picked up and moved (`StructureInterior`).
 * - **Light**: the plan's own sun (`sunInFrame`), so a shadow falls the way the plan draws it, with
 *   percentage-closer soft shadows whose penumbra widens with distance from the caster; a procedural
 *   sky and a `Lightformer` environment rather than a downloaded HDRI — the app works offline.
 * - **Cost**: `frameloop="demand"` — nothing is drawn unless the camera moves or the plan changes.
 *   Device pixel ratio is capped at 2.
 * - **Tone**: ACES filmic with sRGB output, stated so they are not lost to a later default change.
 */
export type CameraPreset = 'orbit' | 'front' | 'side' | 'top';

/** The haze the far garden fades into, matched to the sky's horizon. */
const HAZE = '#dfe6e6';

export function StructureViewport({
  structure,
  element,
  elements,
  frame,
  neighbourhood = null,
  interior,
  pieceId,
  sun,
  light,
  preset,
  presetKey,
  onMissed,
  onPick,
  handles = false,
  onBlocked,
}: {
  structure: ResolvedStructure;
  element: DesignElement;
  /** The plan as it stands when no gesture is open: what the surroundings are drawn from. */
  elements: DesignElement[];
  frame: LocalFrame;
  /** The garden around it, in its own frame, or `null` to show it alone on a plain lawn. */
  neighbourhood?: StructureNeighbourhood | null;
  /** The furniture standing inside it, live. */
  interior: NeighbourhoodSolid[];
  pieceId: string | null;
  /** Unit vector towards the sun, in the structure's frame. */
  sun: [number, number, number];
  /** The plan's light, for the painted ground. */
  light: Point | undefined;
  preset: CameraPreset;
  /** Bumped to fly to the same preset again, which is what Reset does. */
  presetKey: number;
  /** A click on nothing in particular: puts down whatever piece was picked up. */
  onMissed: () => void;
  /** A part of the structure was clicked. */
  onPick?: (group: StructurePartGroup) => void;
  /** Resize handles on the sides and the top: off where a finger would have to share them with the orbit. */
  handles?: boolean;
  /** A handle drag ended on a size that would not fit. */
  onBlocked?: (result: Extract<StructureResizeResult, { status: 'blocked' }>) => void;
}) {
  const { width, depth, height } = structure;
  const reach = neighbourhood ? neighbourhood.half : Math.max(width, depth);
  const near = neighbourhood ? orbitDistance(width, depth, height) + neighbourhood.half * 0.6 : 22;
  const floored = structure.floor !== null;
  const floorTop = floored ? FLOOR_THICKNESS : 0;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      camera={{ fov: 38, near: 0.1, far: 200, position: orbitPosition(width, depth, height) }}
      onPointerMissed={onMissed}
    >
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, near, near + 34]} />
      <Sky
        distance={150}
        sunPosition={[sun[0] * 100, sun[1] * 100, sun[2] * 100]}
        turbidity={5}
        rayleigh={0.9}
        mieCoefficient={0.004}
        mieDirectionalG={0.8}
      />
      <SoftShadows size={22} samples={12} focus={0.6} />

      <Lighting span={reach} sun={sun} />
      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={2.2}
          position={[0, 8, 0]}
          rotation-x={Math.PI / 2}
          scale={[12, 12, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          color="#fff4e2"
          position={[-8, 3, 6]}
          scale={[8, 4, 1]}
          target={[0, 1, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.5}
          color="#dfe8ff"
          position={[8, 3, -6]}
          scale={[8, 4, 1]}
          target={[0, 1, 0]}
        />
      </Environment>

      <Suspense
        fallback={<PlainGround width={width} depth={depth} pad={!neighbourhood && !floored} />}
      >
        <TexturedGround width={width} depth={depth} pad={!neighbourhood && !floored} />
      </Suspense>
      {neighbourhood ? (
        <StructureSurroundings
          neighbourhood={neighbourhood}
          elements={elements}
          frame={frame}
          light={light}
        />
      ) : null}
      <ContactShadows
        position={[0, floorTop + 0.012, 0]}
        scale={Math.max(width, depth) * 2.4}
        blur={2.4}
        far={3}
        opacity={0.45}
        resolution={512}
      />

      <StructureFloor element={element} elements={elements} frame={frame} light={light} />
      <StructureInterior pieces={interior} frame={frame} floor={floorTop} pieceId={pieceId} />
      <StructureModel structure={structure} onPick={onPick} />
      {handles && onBlocked ? (
        <StructureHandles elementId={element.id} structure={structure} onBlocked={onBlocked} />
      ) : null}
      {structure.lighting ? (
        <pointLight
          position={[0, height * 0.72, 0]}
          intensity={4}
          distance={Math.max(width, depth) * 1.6}
          color="#ffcf8a"
          decay={2}
        />
      ) : null}

      <Camera structure={structure} preset={preset} presetKey={presetKey} />
    </Canvas>
  );
}

/**
 * The sun, where the plan puts it. Its shadow camera is fitted to the window: every shadow in view
 * is cast, and none of the map's resolution is spent on garden the fog has already taken.
 */
function Lighting({ span, sun }: { span: number; sun: [number, number, number] }) {
  const reach = Math.max(4, span);
  const distance = reach * 3;
  return (
    <>
      {/* Fill from the sky: enough that the side away from the sun is shade, not a hole. */}
      <hemisphereLight args={['#eef3ff', '#8a9670', 0.95]} />
      <directionalLight
        castShadow
        position={[sun[0] * distance, sun[1] * distance, sun[2] * distance]}
        intensity={2.6}
        color="#fff4e3"
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-camera-left={-reach * 1.2}
        shadow-camera-right={reach * 1.2}
        shadow-camera-top={reach * 1.2}
        shadow-camera-bottom={-reach * 1.2}
        shadow-camera-near={0.5}
        shadow-camera-far={distance * 2.5}
      />
    </>
  );
}

const PAD_MARGIN = 0.5;

/** Below the neighbourhood's lowest surface, so the garden's own ground always draws over it. */
const BEYOND_Y = -0.004;

function PlainGround({ width, depth, pad }: { width: number; depth: number; pad: boolean }) {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, pad ? 0 : BEYOND_Y, 0]} receiveShadow>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial color="#7f9a62" roughness={1} />
      </mesh>
      {pad ? (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} receiveShadow>
          <planeGeometry args={[width + PAD_MARGIN * 2, depth + PAD_MARGIN * 2]} />
          <meshStandardMaterial color="#cfc8b8" roughness={0.9} />
        </mesh>
      ) : null}
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
function TexturedGround({
  width,
  depth,
  pad: showPad,
}: {
  width: number;
  depth: number;
  pad: boolean;
}) {
  const [turf, paver] = useTexture([
    '/assets/plan/textures/tex-standard-turf-1.webp',
    '/assets/plan/textures/face-stone-paver-1.webp',
  ]);
  const padW = width + PAD_MARGIN * 2;
  const padD = depth + PAD_MARGIN * 2;
  // Clones, because `useTexture` caches one texture per URL for the whole page.
  const lawn = useMemo(() => tiled(turf!, 60 / 1.5, 60 / 1.5), [turf]);
  const pad = useMemo(() => tiled(paver!, padW / 0.6, padD / 0.6), [paver, padW, padD]);
  useEffect(() => () => lawn.dispose(), [lawn]);
  useEffect(() => () => pad.dispose(), [pad]);

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, showPad ? 0 : BEYOND_Y, 0]} receiveShadow>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial map={lawn} color="#c9d6bb" roughness={1} />
      </mesh>
      {showPad ? (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} receiveShadow>
          <planeGeometry args={[padW, padD]} />
          <meshStandardMaterial map={pad} roughness={0.85} />
        </mesh>
      ) : null}
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

/** How far back the three-quarter view stands, far enough to see the whole structure. */
function orbitDistance(width: number, depth: number, height: number): number {
  return Math.max(width, depth, height) * 1.6 + 2;
}

/** Where the three-quarter view stands. */
function orbitPosition(width: number, depth: number, height: number): [number, number, number] {
  const reach = orbitDistance(width, depth, height);
  return [reach * 0.8, height * 0.9 + reach * 0.35, reach];
}

/**
 * The camera, and the flights to each preset.
 *
 * `CameraControls` rather than `OrbitControls` because presets want an animated move to an exact
 * look-at, which camera-controls does natively. The polar angle is clamped short of the horizon so a
 * user cannot orbit under the lawn, and distance is clamped to the structure's own size.
 */
function Camera({
  structure,
  preset,
  presetKey,
}: {
  structure: ResolvedStructure;
  preset: CameraPreset;
  presetKey: number;
}) {
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
