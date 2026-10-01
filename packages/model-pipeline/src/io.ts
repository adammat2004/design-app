import { createHash } from 'node:crypto';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/**
 * One reader and writer for every GLB this repository makes or checks.
 *
 * Every extension is registered, and meshopt both ways, so a file this package wrote can be read
 * back by it — the furniture models and the library models are both meshopt-compressed, and a
 * reader without the decoder fails on them with "Please install extension dependency" rather than
 * anything that names the cause.
 *
 * **Never Draco.** Its decoder is a WebAssembly file a browser fetches from a CDN, which the web
 * app does not allow; meshopt's decoder is bundled with three.js.
 */
export async function createIO(): Promise<NodeIO> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  // Warnings and errors only: glTF-Transform logs every type `prune` removes, which is noise here.
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
}

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export { MeshoptEncoder, MeshoptSimplifier };
