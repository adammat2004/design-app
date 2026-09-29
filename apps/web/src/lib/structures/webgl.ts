/**
 * Whether this browser can draw the 3D view at all.
 *
 * Asked once, before a `Canvas` is mounted, because a WebGL context that fails to come up leaves
 * React Three Fiber with nothing to draw into and the user with a blank grey box — which reads as
 * the editor having broken rather than as the browser lacking something. The probe context is lost
 * straight away: browsers cap live contexts, and this one would otherwise hold a slot for nothing.
 */
let cached: boolean | null = null;

export function webglAvailable(doc: Pick<Document, 'createElement'> = document): boolean {
  if (cached !== null && doc === document) return cached;
  let answer = false;
  try {
    const canvas = doc.createElement('canvas');
    const context = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    answer = context !== null;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    answer = false;
  }
  if (doc === document) cached = answer;
  return answer;
}
