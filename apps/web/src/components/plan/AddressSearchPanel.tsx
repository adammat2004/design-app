'use client';

import { useRef, useState } from 'react';
import { Crosshair, MapPin, Search, Trash2 } from 'lucide-react';
import { GEOCODE_VIEW_SPAN, type GeocodeResult } from '@garden-studio/schema';
import { ApiError, geocode } from '@/lib/plan-api';
import { useBoundaryStore } from '@/state/boundary-store';
import { useGeolocation } from './use-geolocation';

/**
 * Finding the property on the photograph.
 *
 * A search box that submits on Enter, not an autocomplete: one geocoder the app can use has a
 * usage policy that forbids per-keystroke queries, and a garden is looked up once. Picking a
 * result centres the imagery; it does **not** fix the plan's origin. That happens at the first
 * corner the user clicks, so what the document keeps is a point on their fence and never a
 * geocoder's guess — see `georeferenceAt`.
 *
 * The result list shows labels only. Coordinates are never displayed, never stored and never
 * put in the project name.
 */
export function AddressSearchPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const anchor = useBoundaryStore((state) => state.imageryAnchor);
  const locateImagery = useBoundaryStore((state) => state.locateImagery);
  const clearGeoreference = useBoundaryStore((state) => state.clearGeoreference);
  const setMappingMethod = useBoundaryStore((state) => state.setMappingMethod);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const geolocation = useGeolocation(
    (location) => locateImagery(location, GEOCODE_VIEW_SPAN.street),
    'Search for the address instead.',
  );

  const located = draft.georeference !== null;
  const centred = anchor !== null || located;

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setSearching(true);
    setProblem(null);
    try {
      const found = await geocode(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      if (found.length === 0) {
        setProblem('No match. Try the Eircode or postcode, use your location, or enter measurements instead.');
      } else if (found.length === 1) {
        choose(found[0]!);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setResults(null);
      setProblem(
        error instanceof ApiError && error.status === 429
          ? 'Too many searches at once — give it a minute.'
          : error instanceof ApiError && error.status === 503
            ? 'Address search is not set up on this server. You can still enter measurements.'
            : 'The address service did not answer. Try again, or enter measurements instead.',
      );
    } finally {
      if (inFlight.current === controller) setSearching(false);
    }
  }

  function choose(result: GeocodeResult) {
    locateImagery(result.location, GEOCODE_VIEW_SPAN[result.precision]);
    setResults(null);
  }

  return (
    <section data-testid="address-search" className="space-y-3 border-t border-garden-line pt-4">
      <h2 className="flex items-center gap-2 text-xs font-semibold text-garden-ink">
        <MapPin aria-hidden className="h-4 w-4 text-garden-muted" />
        Find my property
      </h2>

      {located ? (
        <div data-testid="address-located" className="space-y-2">
          <p className="text-[11px] leading-relaxed text-garden-muted">
            The plan is pinned to the photograph at corner A. Keep clicking round the boundary;
            the lengths are estimates until you check them.
          </p>
          <button
            type="button"
            data-testid="remove-location-data"
            onClick={clearGeoreference}
            className="flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1 text-[11px] font-semibold text-garden-forest hover:bg-garden-sage"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            Remove location data
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={search} className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-1 rounded-md border border-garden-line bg-white px-2 py-1 focus-within:border-garden-green">
              <span className="sr-only">Address, Eircode or postcode</span>
              <input
                type="search"
                data-testid="address-query"
                placeholder="Address, Eircode or postcode"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoComplete="off"
                className="w-full min-w-0 bg-transparent text-sm text-garden-ink placeholder:text-garden-muted focus-visible:outline-none"
              />
            </label>
            <button
              type="submit"
              data-testid="address-submit"
              disabled={searching || query.trim().length < 2}
              aria-label="Search"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-garden-forest text-white hover:bg-garden-green disabled:opacity-50"
            >
              <Search aria-hidden className="h-4 w-4" />
            </button>
          </form>

          {results && results.length > 1 ? (
            <ul data-testid="address-results" className="space-y-1">
              {results.map((result, index) => (
                <li key={`${result.label}-${index}`}>
                  <button
                    type="button"
                    data-testid={`address-result-${index}`}
                    onClick={() => choose(result)}
                    className="w-full rounded-lg border border-garden-line bg-white px-2 py-1.5 text-left text-[11px] leading-snug text-garden-ink hover:border-garden-green"
                  >
                    {result.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="imagery-use-my-location"
              onClick={geolocation.ask}
              disabled={geolocation.asking}
              className="flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1 text-[11px] font-semibold text-garden-forest hover:bg-garden-sage disabled:opacity-50"
            >
              <Crosshair aria-hidden className="h-3.5 w-3.5" />
              {geolocation.asking ? 'Locating…' : 'Use my location'}
            </button>
            <button
              type="button"
              data-testid="switch-to-manual"
              onClick={() => setMappingMethod('manual')}
              className="text-[11px] font-semibold text-garden-forest underline-offset-2 hover:underline"
            >
              Enter measurements instead
            </button>
          </div>

          <p data-testid="address-hint" className="text-[11px] leading-relaxed text-garden-muted">
            {centred
              ? 'Pan and zoom until your roof is in view, then click the corners of your property — fences, walls and hedges, with the house inside. Your first click pins the plan to the photograph.'
              : 'Search once, then find your roof on the photograph. A postcode lands nearby rather than on the door.'}
          </p>

          {problem || geolocation.problem ? (
            <p data-testid="address-problem" role="status" className="text-[11px] text-garden-muted">
              {problem ?? geolocation.problem}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
