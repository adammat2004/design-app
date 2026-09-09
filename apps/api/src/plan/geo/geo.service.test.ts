import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { EsriGeocoder, NominatimGeocoder, resolveGeocoder, type FetchLike } from './geocoding-provider.js';
import { GeoService } from './geo.service.js';
import { fillTileTemplate, PROXY_TILE_PATH, resolveImageryConfig } from './imagery-config.js';

/**
 * No geocoder and no tile server is ever called: `fetch` is a fake handed in, the way the
 * assistant tests inject a fake Anthropic client. What is under test is the mapping from each
 * provider's shape to ours, the configuration rules, and the token bucket.
 */

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveImageryConfig', () => {
  it('is null with nothing configured, which is a supported state', () => {
    expect(resolveImageryConfig(config({}))).toBeNull();
  });

  it('proxies by default and hides the upstream template from the browser', () => {
    const resolved = resolveImageryConfig(
      config({
        IMAGERY_TILE_TEMPLATE: 'https://tiles.example/{z}/{y}/{x}?key=secret',
        IMAGERY_ATTRIBUTION: 'Imagery © Example',
        IMAGERY_MAX_ZOOM: '20',
      }),
    );
    expect(resolved?.public.tileTemplate).toBe(PROXY_TILE_PATH);
    expect(resolved?.public.delivery).toBe('proxy');
    expect(resolved?.public.maxZoom).toBe(20);
    expect(resolved?.public.retinaTemplate).toBeNull();
    expect(JSON.stringify(resolved?.public)).not.toContain('secret');
    expect(resolved?.upstream?.template).toContain('secret');
  });

  it('sends the provider template straight to the browser for direct delivery', () => {
    const resolved = resolveImageryConfig(
      config({
        IMAGERY_TILE_TEMPLATE: 'https://tiles.example/{z}/{x}/{y}?token=public',
        IMAGERY_RETINA_TEMPLATE: 'https://tiles.example/{z}/{x}/{y}@2x?token=public',
        IMAGERY_ATTRIBUTION: '© Example',
        IMAGERY_DELIVERY: 'direct',
      }),
    );
    expect(resolved?.public.tileTemplate).toBe('https://tiles.example/{z}/{x}/{y}?token=public');
    expect(resolved?.public.retinaTemplate).toContain('@2x');
    expect(resolved?.upstream).toBeNull();
  });

  it('fills a template in either coordinate order', () => {
    expect(fillTileTemplate('https://t/{z}/{y}/{x}.jpg', { z: 19, x: 5, y: 7 })).toBe('https://t/19/7/5.jpg');
  });
});

describe('geocoders', () => {
  it('maps Nominatim rows, with a User-Agent, to labelled results with a precision', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse([
        { lat: '53.34', lon: '-6.26', display_name: '1 Example Road, Dublin', addresstype: 'house' },
        { lat: '53.30', lon: '-6.20', display_name: 'D04, Dublin', addresstype: 'postcode' },
      ]),
    );
    const results = await new NominatimGeocoder(fetchImpl, 'Test/1').search('1 Example Road');

    expect(results).toEqual([
      { label: '1 Example Road, Dublin', location: { latitude: 53.34, longitude: -6.26 }, precision: 'rooftop' },
      { label: 'D04, Dublin', location: { latitude: 53.3, longitude: -6.2 }, precision: 'postcode' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('countrycodes=ie%2Cgb');
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe('Test/1');
  });

  it('maps ArcGIS candidates and never asks to store them', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        candidates: [
          { address: '5 Example St', location: { x: -0.12, y: 51.5 }, attributes: { Addr_type: 'PointAddress' } },
          { address: 'SW1A', location: { x: -0.13, y: 51.49 }, attributes: { Addr_type: 'Postal' } },
        ],
      }),
    );
    const results = await new EsriGeocoder(fetchImpl, 'key').search('5 Example St');

    expect(results.map((r) => r.precision)).toEqual(['rooftop', 'postcode']);
    expect(results[0]?.location).toEqual({ latitude: 51.5, longitude: -0.12 });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('forStorage=false');
  });

  it('resolves to null without a provider, and without a key for a keyed provider', () => {
    expect(resolveGeocoder(config({}))).toBeNull();
    expect(resolveGeocoder(config({ GEOCODING_PROVIDER: 'esri' }))).toBeNull();
    expect(resolveGeocoder(config({ GEOCODING_PROVIDER: 'nominatim' }))?.id).toBe('nominatim');
  });
});

describe('GeoService', () => {
  const imagery = resolveImageryConfig(
    config({ IMAGERY_TILE_TEMPLATE: 'https://t/{z}/{x}/{y}', IMAGERY_ATTRIBUTION: '© T', IMAGERY_MAX_ZOOM: '19' }),
  );

  it('answers 503 for both routes when nothing is configured', async () => {
    const service = GeoService.withFakes({});
    expect(() => service.imageryConfig()).toThrow(HttpException);
    await expect(service.geocode('anywhere', 'c')).rejects.toMatchObject({ status: 503 });
    expect(service.imageryAvailable).toBe(false);
    expect(service.geocodingAvailable).toBe(false);
  });

  it('turns an upstream failure into a 502 that does not echo the query', async () => {
    const geocoder = { id: 'fake', search: async () => { throw new Error('boom 12 Secret Lane'); } };
    const service = GeoService.withFakes({ geocoder });
    await expect(service.geocode('12 Secret Lane', 'c')).rejects.toMatchObject({ status: 502 });
    await expect(service.geocode('12 Secret Lane', 'c')).rejects.not.toThrow(/Secret Lane/);
  });

  it('rate-limits geocoding per client', async () => {
    const geocoder = { id: 'fake', search: async () => [] };
    const service = GeoService.withFakes({ geocoder });
    for (let i = 0; i < 10; i += 1) await service.geocode('q', 'same');
    await expect(service.geocode('q', 'same')).rejects.toMatchObject({ status: 429 });
    // Another client still gets through: the per-client cap bit, not the overall one.
    await expect(service.geocode('q', 'other')).resolves.toEqual([]);
  });

  it('proxies a tile from the upstream template and refuses one outside the zoom range', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const service = GeoService.withFakes({ fetchImpl, imagery });

    const tile = await service.tile({ z: 19, x: 5, y: 7 }, false, 'c');
    expect(tile.contentType).toBe('image/png');
    expect([...tile.body]).toEqual([1, 2, 3]);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://t/19/5/7');

    await expect(service.tile({ z: 20, x: 0, y: 0 }, false, 'c')).rejects.toMatchObject({ status: 404 });
    await expect(service.tile({ z: 19, x: -1, y: 0 }, false, 'c')).rejects.toMatchObject({ status: 404 });
  });

  it('has nothing to proxy for direct delivery', async () => {
    const direct = resolveImageryConfig(
      config({ IMAGERY_TILE_TEMPLATE: 'https://t/{z}/{x}/{y}', IMAGERY_ATTRIBUTION: '© T', IMAGERY_DELIVERY: 'direct' }),
    );
    const service = GeoService.withFakes({ imagery: direct });
    await expect(service.tile({ z: 1, x: 0, y: 0 }, false, 'c')).rejects.toMatchObject({ status: 404 });
  });
});
