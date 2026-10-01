import { SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { createResource, type Resource } from './resource';

/**
 * A colour texture from `public/`, loaded once per URL in the background.
 *
 * The non-suspending replacement for drei's `useTexture`: a missing file leaves the resource `null`
 * and the caller drawing its flat version, instead of rejecting a suspense promise that no error
 * boundary catches. The texture is shared; a caller that needs its own repeat clones it.
 */
const cache = new Map<string, Resource<Texture>>();

export function colourTexture(url: string): Resource<Texture> {
  let resource = cache.get(url);
  if (!resource) {
    resource = createResource(async () => {
      const texture = await new TextureLoader().loadAsync(url);
      texture.colorSpace = SRGBColorSpace;
      return texture;
    });
    cache.set(url, resource);
  }
  return resource;
}
