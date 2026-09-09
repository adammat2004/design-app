import { z } from 'zod';
import { SiteLocationSchema } from './site.js';

/**
 * The wire shapes for aerial mapping: what the browser needs to know to draw imagery, and what
 * an address search returns.
 *
 * Both are deliberately provider-agnostic. Every imagery source the app might use — the
 * mainstream satellite mosaics and the national orthophoto services alike — serves Web Mercator
 * raster tiles addressed by `(z, x, y)`, so "a URL template, a credit line and a zoom range" is
 * the whole contract; the browser code never learns which provider is behind it. That is the
 * seam a second provider (one per country, say) plugs into later, and it costs one interface.
 */

/** How the browser reaches a tile. */
export const ImageryDeliverySchema = z.enum([
  /** The API fetches tiles and serves them same-origin, keeping any key on the server. */
  'proxy',
  /**
   * The browser fetches from the provider directly. Some providers forbid proxying, and then the
   * template carries a URL-restricted public token instead.
   */
  'direct',
]);
export type ImageryDelivery = z.infer<typeof ImageryDeliverySchema>;

export const ImageryConfigSchema = z.object({
  /** A short stable id, for cache keys and the dev HUD. Never shown to the user. */
  provider: z.string().min(1),
  /**
   * With `{z}`, `{x}` and `{y}` placeholders. For `proxy` delivery this is the API's own path;
   * for `direct` it is the provider's, token included.
   */
  tileTemplate: z.string().min(1),
  /** A second template for high-density displays, if the provider offers one. */
  retinaTemplate: z.string().min(1).nullable().default(null),
  delivery: ImageryDeliverySchema,
  /** The credit line every provider requires to be visible while its imagery is on screen. */
  attribution: z.string().min(1),
  minZoom: z.number().int().min(0).max(24).default(0),
  maxZoom: z.number().int().min(0).max(24),
  tileSize: z.union([z.literal(256), z.literal(512)]).default(256),
});
export type ImageryConfig = z.infer<typeof ImageryConfigSchema>;

/**
 * How closely a geocoder pinned the query. Drives how far out the map starts: a rooftop result
 * can open at sixty metres across, a postcode centroid is often a hundred metres from the door.
 */
export const GeocodePrecisionSchema = z.enum(['rooftop', 'street', 'postcode', 'locality']);
export type GeocodePrecision = z.infer<typeof GeocodePrecisionSchema>;

export const GeocodeRequestSchema = z.object({
  query: z.string().trim().min(2).max(200),
});
export type GeocodeRequest = z.infer<typeof GeocodeRequestSchema>;

export const GeocodeResultSchema = z.object({
  /** A one-line label to show in the results list. Never persisted. */
  label: z.string().min(1),
  location: SiteLocationSchema,
  precision: GeocodePrecisionSchema,
});
export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

export const GeocodeResponseSchema = z.object({
  results: z.array(GeocodeResultSchema),
});
export type GeocodeResponse = z.infer<typeof GeocodeResponseSchema>;

/**
 * How wide the first view should be for a result of this precision, in metres across the shorter
 * side of the canvas. Sixty metres is a suburban plot and its neighbours; a postcode or locality
 * result needs enough around it for the user to find the roof by eye.
 */
export const GEOCODE_VIEW_SPAN: Record<GeocodePrecision, number> = {
  rooftop: 60,
  street: 90,
  postcode: 140,
  locality: 400,
};
