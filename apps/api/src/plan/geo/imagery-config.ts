import type { ConfigService } from '@nestjs/config';
import { ImageryConfigSchema, type ImageryConfig } from '@garden-studio/schema';

/**
 * Aerial imagery, configured rather than coded.
 *
 * Every provider the app might use serves Web Mercator raster tiles by `(z, x, y)`, so the
 * whole of "which provider" is a URL template, a credit line and a zoom range in `.env`. The
 * browser is handed the *public* half of that and never learns the provider's own URL when
 * tiles are proxied — which is the default, because it keeps any key on the server, serves the
 * tiles same-origin (a cross-origin tile without CORS headers taints every Konva layer), and
 * gives the rate limit something to hold on to.
 *
 * `direct` exists for the providers whose terms forbid proxying. Then the template is sent to
 * the browser as-is, which means whatever token it carries is public: it has to be one the
 * provider lets you restrict by URL.
 *
 * **Not configured is a supported state, not an error** — exactly as `ANTHROPIC_API_KEY` is.
 * `resolveImageryConfig` returns `null`, the endpoint answers 503, and the "Find my property"
 * card on step 1 says aerial mapping is not set up on this server. `pnpm dev` and the whole
 * suite work without it.
 *
 * Nothing here says which provider's imagery may be *traced*: that is a licence question, and
 * the `.env.example` notes which of the mainstream providers restrict it.
 */

export interface ResolvedImagery {
  /** What the browser is told. */
  public: ImageryConfig;
  /** What the proxy fetches from. Null for `direct` delivery. */
  upstream: { template: string; retinaTemplate: string | null } | null;
}

/** The API's own tile path. The browser prefixes its API base URL. */
export const PROXY_TILE_PATH = '/imagery/tiles/{z}/{x}/{y}';
export const PROXY_RETINA_TILE_PATH = '/imagery/tiles/{z}/{x}/{y}@2x';

export function resolveImageryConfig(config: ConfigService): ResolvedImagery | null {
  const template = config.get<string>('IMAGERY_TILE_TEMPLATE');
  const attribution = config.get<string>('IMAGERY_ATTRIBUTION');
  if (!template || !attribution) return null;

  const delivery = config.get<string>('IMAGERY_DELIVERY') === 'direct' ? 'direct' : 'proxy';
  const retinaTemplate = config.get<string>('IMAGERY_RETINA_TEMPLATE') || null;

  const parsed = ImageryConfigSchema.safeParse({
    provider: config.get<string>('IMAGERY_PROVIDER') || 'imagery',
    tileTemplate: delivery === 'proxy' ? PROXY_TILE_PATH : template,
    retinaTemplate:
      delivery === 'proxy' ? (retinaTemplate ? PROXY_RETINA_TILE_PATH : null) : retinaTemplate,
    delivery,
    attribution,
    minZoom: numberOr(config.get<string>('IMAGERY_MIN_ZOOM'), 0),
    maxZoom: numberOr(config.get<string>('IMAGERY_MAX_ZOOM'), 19),
    tileSize: numberOr(config.get<string>('IMAGERY_TILE_SIZE'), 256),
  });

  // A malformed template is a configuration bug, and a server that boots with imagery quietly
  // off would hide it. Loud, once, at startup.
  if (!parsed.success) {
    throw new Error(`IMAGERY_* configuration is invalid: ${parsed.error.message}`);
  }

  return {
    public: parsed.data,
    upstream: delivery === 'proxy' ? { template, retinaTemplate } : null,
  };
}

/** Substitutes `{z}`, `{x}` and `{y}` in a template. */
export function fillTileTemplate(
  template: string,
  tile: { z: number; x: number; y: number },
): string {
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(tile.y));
}

function numberOr(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
}
