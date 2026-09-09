import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GeocodeResult, ImageryConfig } from '@garden-studio/schema';
import { type FetchLike, type GeocodingProvider, resolveGeocoder } from './geocoding-provider.js';
import { fillTileTemplate, resolveImageryConfig, type ResolvedImagery } from './imagery-config.js';

/**
 * The server half of aerial mapping: hands the browser its imagery configuration, proxies
 * tiles, and geocodes addresses — each behind the same rate limit and the same "not
 * configured is a supported state" rule the assistant follows.
 *
 * The constructor takes only `ConfigService`, because Nest reads the constructor to decide what
 * to inject and cannot resolve a `fetch` or a provider interface — the first boot with optional
 * parameters there failed on exactly that. Tests build one with `GeoService.withFakes` instead.
 */
@Injectable()
export class GeoService {
  private imagery: ResolvedImagery | null;
  private geocoder: GeocodingProvider | null;
  private fetchImpl: FetchLike = (input, init) => fetch(input, init);

  /**
   * In-process token bucket, per client and overall — the assistant's, for the same reason: the
   * API has no auth, and a reachable deployment would otherwise hand a stranger a geocoding bill
   * or a tile bill. The tile limit is generous because one pan is dozens of tiles; the geocode
   * limit is tight because one search is one.
   */
  private readonly geocodeHits = new Map<string, number[]>();
  private readonly tileHits = new Map<string, number[]>();

  private static readonly WINDOW_MS = 60_000;
  private static readonly GEOCODES_PER_CLIENT = 10;
  private static readonly GEOCODES_OVERALL = 30;
  private static readonly TILES_PER_CLIENT = 600;
  private static readonly TILES_OVERALL = 2_000;

  constructor(config: ConfigService) {
    this.imagery = resolveImageryConfig(config);
    this.geocoder = resolveGeocoder(config, this.fetchImpl);
  }

  /** Test seam: a service with nothing configured, then whatever fakes the test hands in. */
  static withFakes(fakes: {
    fetchImpl?: FetchLike;
    geocoder?: GeocodingProvider | null;
    imagery?: ResolvedImagery | null;
  }): GeoService {
    const empty = { get: () => undefined } as unknown as ConfigService;
    const service = new GeoService(empty);
    if (fakes.fetchImpl) service.fetchImpl = fakes.fetchImpl;
    service.geocoder = fakes.geocoder ?? null;
    service.imagery = fakes.imagery ?? null;
    return service;
  }

  get imageryAvailable(): boolean {
    return this.imagery !== null;
  }

  get geocodingAvailable(): boolean {
    return this.geocoder !== null;
  }

  imageryConfig(): ImageryConfig {
    if (!this.imagery) {
      throw new ServiceUnavailableException('Aerial imagery is not configured on this server.');
    }
    return this.imagery.public;
  }

  async geocode(query: string, client: string): Promise<GeocodeResult[]> {
    // Availability before the rate limit — see `AssistantService` for why.
    if (!this.geocoder) {
      throw new ServiceUnavailableException('Address search is not configured on this server.');
    }

    rateLimit(this.geocodeHits, client, GeoService.GEOCODES_PER_CLIENT, GeoService.GEOCODES_OVERALL);

    try {
      return await this.geocoder.search(query);
    } catch {
      // Never the upstream message: it can echo the query, and the query is an address.
      throw new BadGatewayException('The address service did not answer. Try again in a moment.');
    }
  }

  /**
   * One tile from the upstream provider, as bytes. Only for `proxy` delivery; a `direct`
   * configuration has nothing to proxy and answers 404 rather than fetching on the browser's
   * behalf — that is the whole point of the distinction.
   */
  async tile(
    tile: { z: number; x: number; y: number },
    retina: boolean,
    client: string,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    if (!this.imagery) {
      throw new ServiceUnavailableException('Aerial imagery is not configured on this server.');
    }
    const upstream = this.imagery.upstream;
    if (!upstream) throw new NotFoundException('Tiles are served directly by the provider.');

    const { minZoom, maxZoom } = this.imagery.public;
    const tiles = 2 ** tile.z;
    if (tile.z < minZoom || tile.z > maxZoom || tile.x < 0 || tile.y < 0 || tile.x >= tiles || tile.y >= tiles) {
      throw new NotFoundException('No such tile.');
    }

    rateLimit(this.tileHits, client, GeoService.TILES_PER_CLIENT, GeoService.TILES_OVERALL);

    const template = retina && upstream.retinaTemplate ? upstream.retinaTemplate : upstream.template;
    const response = await this.fetchImpl(fillTileTemplate(template, tile));
    if (!response.ok) throw new BadGatewayException('The imagery provider did not answer.');

    return {
      body: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'image/jpeg',
    };
  }
}

function rateLimit(hits: Map<string, number[]>, client: string, perClient: number, overall: number): void {
  const now = Date.now();
  const since = now - 60_000;

  for (const [key, times] of hits) {
    const recent = times.filter((time) => time > since);
    if (recent.length === 0) hits.delete(key);
    else hits.set(key, recent);
  }

  const own = hits.get(client) ?? [];
  const total = [...hits.values()].reduce((sum, times) => sum + times.length, 0);

  if (own.length >= perClient || total >= overall) {
    throw new HttpException('Too many requests — give it a minute.', HttpStatus.TOO_MANY_REQUESTS);
  }

  hits.set(client, [...own, now]);
}
