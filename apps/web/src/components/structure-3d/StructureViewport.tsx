'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, CameraControls, ContactShadows, Sky, SoftShadows } from '@react-three/drei';
import { NeutralToneMapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type {
  DesignElement,
  LocalFrame,
  NeighbourhoodSolid,
  Point,
  ResolvedStructure,
  StructurePartGroup,
  StructureResizeResult,
} from '@garden-studio/schema';
import { StructureFloor, StructureInterior, FLOOR_THICKNESS } from './StructureInterior';
import { StructureHandles } from './StructureHandles';
import { StructureModel } from './StructureModel';
import { StructureSurroundings } from './StructureSurroundings';
import type { ARScene } from '@garden-studio/ar-contract';
import type { LibraryOutcome } from '@garden-studio/ar-builder';
import { LibraryModel } from '../three/LibraryModel';
import { NEIGHBOURHOOD_REACH } from '@garden-studio/schema';
import { Finish, HAZE, SkyLight, type ViewportReport } from '../three/SceneAtmosphere';
import { useResource } from '@/lib/structures/resource';
import { colourTexture } from '@/lib/structures/textures';

/**
 * The 3D view of one structure: the structure is the hero, and the setting is its neighbourhood.
 *
 * **In its garden.** With the surroundings on, the garden is the AR scene builder's scene of the plan,
 * drawn by the renderer the whole-garden preview uses (`StructureSurroundings` → `SceneNodes`): the
 * terrace it stands on, the beds planted as the plan plants them, the fence, the house with its doors,
 * the trees, the retaining walls and the edging. Within `NEIGHBOURHOOD_REACH` it is painted in full
 * and in the clear; beyond, it fades into the haze. Off, it is the structure alone on a plain lawn.
 * This is a configurator, never a place to move things: the plan is where the garden is changed.
 *
 * - **What is inside it** — its floor and the furniture standing in it — is always drawn, and the
 *   furniture can be picked up and moved (`StructureInterior`).
 * - **Light**: the plan's own sun (`sunInFrame`), so a shadow falls the way the plan draws it, with
 *   percentage-closer soft shadows whose penumbra widens with distance from the caster. The sky light
 *   is a CC0 overcast HDRI checked in beside the app (`SKY_ENVIRONMENT`) — image-based light with no
 *   sun of its own, so there is still one sun — and the studio `Lightformer`s while it loads or if it
 *   is missing. Either way nothing is fetched from outside: the app works offline.
 * - **Finish**: on the `high` render tier (`renderTier`), ambient occlusion, bloom on the LED strip,
 *   tone mapping and SMAA in one post pass (`StructurePostFX`); on `low`, the renderer's own.
 * - **Cost**: `frameloop="demand"` — nothing is drawn unless the camera moves or the plan changes.
 *   Device pixel ratio is capped at 2 and drops while the camera moves.
 * - **Tone**: Khronos PBR Neutral with sRGB output on both tiers. A finish is a colour promise, and
 *   ACES filmic, which this view used first, shifts a swatch's hue on the way to the screen.
 */
export type CameraPreset = 'orbit' | 'front' | 'side' | 'top';

export type { ViewportReport };

export function StructureViewport({
  structure,
  element,
  look = null,
  elements,
  frame,
  scene = null,
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
  coarse = false,
  onReport,
}: {
  structure: ResolvedStructure;
  element: DesignElement;
  /**
   * How it is drawn: a library model (`matchLibraryAsset`) or its own parts. Decided by the
   * workspace, once, so the viewport and its test hook cannot disagree.
   */
  look?: LibraryOutcome | null;
  /** The plan as it stands when no gesture is open: what the surroundings are drawn from. */
  elements: DesignElement[];
  frame: LocalFrame;
  /** The garden around it, in its own frame, or `null` to show it alone on a plain lawn. */
  scene?: ARScene | null;
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
  /** A touch device: the post pass is not attempted (`renderTier`). */
  coarse?: boolean;
  /** Told the render tier and how the sky loaded, whenever either changes. */
  onReport?: (report: ViewportReport) => void;
}) {
  const { width, depth, height } = structure;
  // How far the garden is drawn in full detail round the structure: the fog's clear range and the sun's
  // shadow reach. The scene beyond is still there, fading into the haze.
  const half = Math.max(width, depth) / 2 + NEIGHBOURHOOD_REACH;
  const reach = scene ? half : Math.max(width, depth);
  const near = scene ? orbitDistance(width, depth, height) + half * 0.6 : 22;
  const floored = structure.floor !== null;
  const floorTop = floored ? FLOOR_THICKNESS : 0;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      frameloop="demand"
      gl={{ antialias: true, toneMapping: NeutralToneMapping, outputColorSpace: SRGBColorSpace }}
      performance={{ min: 0.5 }}
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

      <SkyLight span={reach} sun={sun} />

      <Ground width={width} depth={depth} pad={!scene && !floored} />
      {scene ? (
        <StructureSurroundings
          scene={scene}
          element={element}
          elements={elements}
          light={light}
        />
      ) : null}
      <ContactShadows
        position={[0, floorTop + 0.012, 0]}
        scale={Math.max(width, depth) * 2.4}
        blur={2.4}
        far={3}
        opacity={0.3}
        resolution={512}
      />

      <StructureFloor element={element} elements={elements} frame={frame} light={light} />
      <StructureInterior pieces={interior} frame={frame} floor={floorTop} pieceId={pieceId} />
      {look?.kind === 'model' ? (
        /*
         * The library model, on the structure's own origin and scaled to exactly its size. Not
         * pickable: a model has no parts to open a tab by, and clicking it to land on an arbitrary
         * tab would teach the wrong thing. The tabs and the handles still edit it, because they edit
         * the element.
         */
        <LibraryModel
          asset={{
            id: look.match.entry.id,
            position: [0, 0, 0],
            yaw: look.match.turned ? Math.PI / 2 : 0,
            size: look.match.size,
          }}
          fallback={<StructureModel structure={structure} onPick={onPick} />}
        />
      ) : (
        <StructureModel structure={structure} onPick={onPick} />
      )}
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
      <AdaptiveDpr />
      <Finish coarse={coarse} onReport={onReport} />
    </Canvas>
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

const TURF = colourTexture('/assets/plan/textures/tex-standard-turf-1.webp');
const PAVER = colourTexture('/assets/plan/textures/face-stone-paver-1.webp');

/**
 * The lawn and the paving pad, in the plan library's own photographs.
 *
 * The same tiles the 2D plan draws with, at their real sizes (turf 1.5 m, a paving slab 0.6 m), so
 * the ground reads at the scale the structure does. Flat until both files have arrived, and flat
 * for good if either is missing: a missing file is a supported state everywhere in this app, and
 * with the suspending loader this replaced a 404 here took the whole view down with it.
 */
function Ground({ width, depth, pad }: { width: number; depth: number; pad: boolean }) {
  const turf = useResource(TURF);
  const paver = useResource(PAVER);
  if (!turf || !paver) return <PlainGround width={width} depth={depth} pad={pad} />;
  return <TexturedGround width={width} depth={depth} pad={pad} turf={turf} paver={paver} />;
}

function TexturedGround({
  width,
  depth,
  pad: showPad,
  turf,
  paver,
}: {
  width: number;
  depth: number;
  pad: boolean;
  turf: Texture;
  paver: Texture;
}) {
  const padW = width + PAD_MARGIN * 2;
  const padD = depth + PAD_MARGIN * 2;
  // Clones, because one texture per URL is shared by the whole page.
  const lawn = useMemo(() => tiled(turf, 60 / 1.5, 60 / 1.5), [turf]);
  const pad = useMemo(() => tiled(paver, padW / 0.6, padD / 0.6), [paver, padW, padD]);
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
      regress
      minDistance={size * 0.6}
      maxDistance={size * 5 + 6}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.06}
      smoothTime={0.35}
    />
  );
}
