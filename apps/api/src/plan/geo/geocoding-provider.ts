import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { GeocodePrecision, GeocodeResult } from '@garden-studio/schema';

/**
 * Turns "12 Example Road, D04 X1Y2" into somewhere the map can open.
 *
 * One interface, two implementations, chosen by `GEOCODING_PROVIDER`. The app only ever needs
 * the map *near* the roof — the user pans to it — so what matters about a geocoder is that it
 * answers for rural Irish and British addresses at all, and says how sure it is: a rooftop
 * result opens at sixty metres across, a postcode centroid a hundred and forty.
 *
 * Each implementation takes `fetch` as a constructor argument so the tests can hand it canned
 * responses, the way the assistant tests inject a fake Anthropic client. No real geocoder is ever
 * called by the suite.
 *
 * Results are never stored and never logged: an address is personal data, and at least one
 * provider's terms forbid keeping "temporary" geocodes anyway. The browser shows the list once,
 * the user picks one, and only the position of the metre frame's origin is kept — see
 * `site.georeference`.
 */
export interface GeocodingProvider {
  readonly id: string;
  search(query: string): Promise<GeocodeResult[]>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Ireland and Great Britain, which is where the app's users and its imagery are. */
const COUNTRIES = { nominatim: 'ie,gb', esri: 'IRL,GBR' };

/* ---------------------------------------------------------------- Nominatim */

const NominatimResultSchema = z.array(
  z.object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    display_name: z.string(),
    addresstype: z.string().optional(),
    class: z.string().optional(),
  }),
);

/**
 * OpenStreetMap's public geocoder. No key, which makes it the development default, but its
 * usage policy is strict: one request a second, a User-Agent that identifies the application,
 * and no autocomplete — which is why the search box submits on Enter rather than on every
 * keystroke. Eircode coverage in OSM is thin, so a rural Irish Eircode often lands on the town.
 */
export class NominatimGeocoder implements GeocodingProvider {
  readonly id = 'nominatim';

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly userAgent: string,
    private readonly baseUrl = 'https://nominatim.openstreetmap.org',
  ) {}

  async search(query: string): Promise<GeocodeResult[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('countrycodes', COUNTRIES.nominatim);

    const response = await this.fetchImpl(url.toString(), {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Nominatim answered ${response.status}.`);

    return NominatimResultSchema.parse(await response.json()).map((row) => ({
      label: row.display_name,
      location: { latitude: row.lat, longitude: row.lon },
      precision: nominatimPrecision(row.addresstype ?? row.class ?? ''),
    }));
  }
}

function nominatimPrecision(type: string): GeocodePrecision {
  if (type === 'house' || type === 'building' || type === 'residential') return 'rooftop';
  if (type === 'road' || type === 'street' || type === 'highway') return 'street';
  if (type === 'postcode') return 'postcode';
  return 'locality';
}

/* ---------------------------------------------------------------- Esri */

const EsriCandidatesSchema = z.object({
  candidates: z.array(
    z.object({
      address: z.string(),
      location: z.object({ x: z.number(), y: z.number() }),
      attributes: z.object({ Addr_type: z.string().optional() }).optional(),
    }),
  ),
});

/**
 * The ArcGIS World Geocoding service, keyed. Sends `forStorage=false`: results are shown once and
 * dropped, which is the cheaper SKU and the honest description of what happens to them.
 */
export class EsriGeocoder implements GeocodingProvider {
  readonly id = 'esri';

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer',
  ) {}

  async search(query: string): Promise<GeocodeResult[]> {
    const url = new URL(`${this.baseUrl}/findAddressCandidates`);
    url.searchParams.set('SingleLine', query);
    url.searchParams.set('f', 'json');
    url.searchParams.set('maxLocations', '5');
    url.searchParams.set('sourceCountry', COUNTRIES.esri);
    url.searchParams.set('outFields', 'Addr_type');
    url.searchParams.set('forStorage', 'false');
    url.searchParams.set('token', this.apiKey);

    const response = await this.fetchImpl(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`ArcGIS geocoding answered ${response.status}.`);

    return EsriCandidatesSchema.parse(await response.json()).candidates.map((candidate) => ({
      label: candidate.address,
      location: { latitude: candidate.location.y, longitude: candidate.location.x },
      precision: esriPrecision(candidate.attributes?.Addr_type ?? ''),
    }));
  }
}

function esriPrecision(type: string): GeocodePrecision {
  if (type === 'PointAddress' || type === 'Subaddress') return 'rooftop';
  if (type === 'StreetAddress' || type === 'StreetName' || type === 'StreetInt') return 'street';
  if (type === 'Postal' || type === 'PostalExt' || type === 'PostalLoc') return 'postcode';
  return 'locality';
}

/* ---------------------------------------------------------------- selection */

/** Null when nothing is configured — the endpoint answers 503, the same as the assistant. */
export function resolveGeocoder(
  config: ConfigService,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): GeocodingProvider | null {
  const provider = config.get<string>('GEOCODING_PROVIDER');

  if (provider === 'nominatim') {
    return new NominatimGeocoder(
      fetchImpl,
      config.get<string>('GEOCODING_USER_AGENT') || 'GardenStudio/0.1 (development)',
    );
  }

  if (provider === 'esri') {
    const apiKey = config.get<string>('GEOCODING_API_KEY');
    return apiKey ? new EsriGeocoder(fetchImpl, apiKey) : null;
  }

  return null;
}
