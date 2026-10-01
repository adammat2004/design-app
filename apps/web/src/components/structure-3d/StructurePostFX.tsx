'use client';

import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * The finish on the `high` render tier: what turns a correctly lit model into a photograph of one.
 *
 * - **Ambient occlusion (N8AO)**, in metres rather than screen pixels, so a rafter seated on a beam
 *   darkens the joint by the same amount whatever the zoom. It is what grounds a structure: the dark
 *   line where a post meets the paving, where a slat meets its rail. Soft shadows and the contact
 *   shadow already darken the ground under it, so the intensity is held low rather than letting the
 *   three stack into a black ring.
 * - **Bloom** above a threshold of 1, which in this scene only the warm LED strip reaches — so the
 *   integrated lighting reads as light rather than as a pale plastic bar, and nothing else glows.
 * - **Tone mapping, once, at the end** (the composer turns the renderer's own off while it is
 *   mounted). Khronos PBR Neutral, the same curve the `low` tier's renderer uses, because a finish is
 *   a colour promise: "Dark aluminium" has to read as its swatch, and ACES shifts the hue on the way.
 * - **SMAA** last, on display colour. The composer's own multisampling is off: SMAA does the job for
 *   a fraction of the memory at twice the device pixel ratio.
 *
 * Nothing here accumulates over frames, which is what keeps it honest under `frameloop="demand"`:
 * every frame drawn is complete. While the camera is moving the pass drops to half-resolution
 * occlusion (`performance.current` is regressed by the controls) and the frame drawn when it settles
 * is full quality.
 */
export function StructurePostFX() {
  const moving = useThree((state) => state.performance.current < 1);
  return (
    <EffectComposer multisampling={0}>
      <N8AO
        aoRadius={AO_RADIUS_M}
        distanceFalloff={0.6}
        intensity={AO_INTENSITY}
        quality="medium"
        halfRes={moving}
      />
      <Bloom luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.45} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <SMAA />
    </EffectComposer>
  );
}

/** How far the occlusion reaches: about a joist's depth, so it darkens joints and not whole bays. */
const AO_RADIUS_M = 0.45;
const AO_INTENSITY = 1.6;
