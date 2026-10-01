'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { StructurePostFX } from '../structure-3d/StructurePostFX';
import { SKY_ENVIRONMENT } from '@/lib/structures/environment';
import { useModelsStatus, type ModelsStatus } from '@/lib/structures/furniture-models';
import { usePbrSettled, usePbrStatus, type PbrStatus } from '@/lib/structures/pbr-textures';
import { hasFloatTargets, renderTier, type RenderTier } from '@/lib/structures/render-tier';
import { useResource, useResourceStatus, type ResourceStatus } from '@/lib/structures/resource';

/**
 * The light, the sky and the finish every 3D view in the app shares: the structure configurator and
 * the whole-garden preview. One sun (the plan's), one sky (the checked-in overcast HDRI, or the
 * studio light while it loads), one tone curve and one post pass — so a pergola looks the same in
 * the garden as it does on its own, and a change to the light is made once.
 */

/** The haze the far garden fades into, matched to the sky's horizon. */
export const HAZE = '#dfe6e6';

/** What the viewport ended up drawing with, for the test hooks on its wrapper. */
export type ViewportReport = {
  tier: RenderTier;
  sky: ResourceStatus;
  pbr: PbrStatus;
  models: ModelsStatus;
};

/**
 * The light: the plan's sun, and the sky around it.
 *
 * The sky is the checked-in overcast HDRI once it has loaded, and the studio `Lightformer`s until
 * then (or for good, if the file is missing) — the look this view had before the sky existed. The
 * hemisphere fill is turned down under the HDRI because the dome already does its job: lighting the
 * side away from the sun, and far better, since it comes from somewhere rather than from everywhere.
 */
export function SkyLight({ span, sun }: { span: number; sun: [number, number, number] }) {
  const sky = useResource(SKY_ENVIRONMENT);
  const invalidate = useThree((state) => state.invalidate);
  // The environment is set on the scene rather than drawn, so nothing else asks for the new frame.
  useEffect(() => invalidate(), [sky, invalidate]);
  return (
    <>
      <Lighting span={span} sun={sun} fill={sky ? SKY_FILL : STUDIO_FILL} />
      {sky ? (
        <Environment map={sky} environmentIntensity={SKY_INTENSITY} />
      ) : (
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
      )}
    </>
  );
}

/** How bright the sky dome lights the scene. The HDRI's own units, tuned by eye against the sun. */
const SKY_INTENSITY = 0.35;
/** The hemisphere fill under the sky dome, and under the studio lights it replaces. */
const SKY_FILL = 0.12;
const STUDIO_FILL = 0.95;

/**
 * The sun, where the plan puts it. Its shadow camera is fitted to the window: every shadow in view
 * is cast, and none of the map's resolution is spent on garden the fog has already taken.
 */
function Lighting({
  span,
  sun,
  fill,
}: {
  span: number;
  sun: [number, number, number];
  fill: number;
}) {
  const reach = Math.max(4, span);
  const distance = reach * 3;
  return (
    <>
      {/* Fill from the sky: enough that the side away from the sun is shade, not a hole. */}
      <hemisphereLight args={['#eef3ff', '#8a9670', fill]} />
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

/**
 * Which finish this device gets, decided where the WebGL context can be asked, and reported up to
 * the wrapper's test hooks with how the sky and the material library loaded.
 *
 * Materials dress themselves in place when their set arrives (`materials-3d.ts`), which changes
 * nothing React can see — so this is also what asks for the frame that shows them.
 */
export function Finish({
  coarse,
  onReport,
}: {
  coarse: boolean;
  onReport?: (report: ViewportReport) => void;
}) {
  const floatTargets = useThree((state) => hasFloatTargets(state.gl.extensions));
  const tier = renderTier({ coarse, floatTargets });
  const sky = useResourceStatus(SKY_ENVIRONMENT);
  const pbr = usePbrStatus();
  const models = useModelsStatus();
  const settled = usePbrSettled();
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => invalidate(), [settled, invalidate]);
  useEffect(() => onReport?.({ tier, sky, pbr, models }), [onReport, tier, sky, pbr, models]);
  return tier === 'high' ? <StructurePostFX /> : null;
}
