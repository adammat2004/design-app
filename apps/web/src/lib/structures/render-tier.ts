/**
 * How much of the 3D view's finish a device gets.
 *
 * - `high`: the post-processing pass — ambient occlusion in the joints and under the rafters, a glow
 *   on a lit strip, and tone mapping done once at the end on half-float colour.
 * - `low`: the renderer's own tone mapping and nothing after it; what the view drew before.
 *
 * A **coarse pointer** is read as the phone or tablet it almost always is, whose GPU would be asked
 * for soft shadows and screen-space occlusion at twice the pixel count of a laptop. And without
 * **float colour targets** the pass has nowhere to keep light brighter than white, so bloom has
 * nothing to find and the tone mapping has already clipped — the pass would cost everything and add
 * nothing.
 */
export type RenderTier = 'high' | 'low';

export function renderTier({
  coarse,
  floatTargets,
}: {
  coarse: boolean;
  floatTargets: boolean;
}): RenderTier {
  return !coarse && floatTargets ? 'high' : 'low';
}

/** Whether a WebGL context can render into half-float colour, which the post pass writes. */
export function hasFloatTargets(extensions: { has(name: string): boolean }): boolean {
  return extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float');
}
