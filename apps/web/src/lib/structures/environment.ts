import { EquirectangularReflectionMapping, type DataTexture } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { PBR_CATALOGUE } from './pbr/catalogue';
import { absentResource, createResource, type Resource } from './resource';

/**
 * The sky the 3D view is lit by: a CC0 overcast dome (`SKY_HDRI`), checked in under
 * `public/assets/hdri/` and loaded from there — never from a CDN, so the view works offline.
 *
 * Image-based light is what makes a material read as a material: a timber face picks up the sky's
 * gradient, aluminium shows a soft reflection instead of a flat grey, and the side away from the sun
 * is lit by the dome rather than by a uniform ambient term. It carries no sun of its own; the plan's
 * sun is the directional light, so there is still exactly one.
 *
 * `null` until it arrives and for good if it never does, and the viewport draws its studio
 * `Lightformer` environment in the meantime — the look this view had before the sky existed.
 */
export const SKY_ENVIRONMENT: Resource<DataTexture> = PBR_CATALOGUE.hdri
  ? createResource(async () => {
      const texture = await new RGBELoader().loadAsync(`/assets/${PBR_CATALOGUE.hdri!.file}`);
      texture.mapping = EquirectangularReflectionMapping;
      return texture;
    })
  : absentResource();
