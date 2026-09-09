import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { AddressSearchPanel } from './AddressSearchPanel';

/*
 * The API client is mocked, not `fetch`: what is under test is how the panel treats each answer,
 * and asserting on request bodies would only re-test the client.
 */
vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');
  return { ...actual, geocode: vi.fn() };
});

const api = await import('@/lib/plan-api');
const geocode = vi.mocked(api.geocode);

const store = () => useBoundaryStore.getState();
const DUBLIN = { latitude: 53.3498, longitude: -6.2603 };

async function search(query: string) {
  fireEvent.change(screen.getByTestId('address-query'), { target: { value: query } });
  await act(async () => {
    fireEvent.submit(screen.getByTestId('address-query').closest('form')!);
  });
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  geocode.mockReset();
});

describe('address search', () => {
  it('lists several matches and centres the imagery on the one chosen', async () => {
    geocode.mockResolvedValue([
      { label: '1 Example Road, Dublin', location: DUBLIN, precision: 'rooftop' },
      { label: 'Example Road, Dublin', location: { latitude: 53.35, longitude: -6.26 }, precision: 'street' },
    ]);
    render(<AddressSearchPanel />);

    await search('1 Example Road');
    expect(screen.getByTestId('address-results')).toBeInTheDocument();
    expect(store().imageryAnchor).toBeNull();

    fireEvent.click(screen.getByTestId('address-result-0'));
    expect(store().imageryAnchor).toEqual(DUBLIN);
    // A rooftop result opens tight.
    expect(store().imageryViewSpan).toBe(60);
    expect(store().present.georeference).toBeNull();
  });

  it('takes a single match straight away, opening wider for a postcode centroid', async () => {
    geocode.mockResolvedValue([
      { label: 'D04, Dublin', location: DUBLIN, precision: 'postcode' },
    ]);
    render(<AddressSearchPanel />);

    await search('D04 X1Y2');
    expect(store().imageryAnchor).toEqual(DUBLIN);
    expect(store().imageryViewSpan).toBe(140);
    expect(screen.queryByTestId('address-results')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, and names the next moves', async () => {
    geocode.mockResolvedValue([]);
    render(<AddressSearchPanel />);

    await search('Nowhere');
    expect(screen.getByTestId('address-problem')).toHaveTextContent(/No match/);
    expect(screen.getByTestId('address-problem')).toHaveTextContent(/enter measurements/);
  });

  it('reports a server without address search as such, not as a failure', async () => {
    geocode.mockRejectedValue(new api.ApiError(503, 'unavailable'));
    render(<AddressSearchPanel />);

    await search('Anywhere');
    expect(screen.getByTestId('address-problem')).toHaveTextContent(/not set up on this server/);
  });

  it('never shows coordinates', async () => {
    geocode.mockResolvedValue([
      { label: 'A', location: DUBLIN, precision: 'rooftop' },
      { label: 'B', location: DUBLIN, precision: 'rooftop' },
    ]);
    const { container } = render(<AddressSearchPanel />);

    await search('A');
    expect(container.textContent).not.toContain('53.3');
    expect(container.textContent).not.toContain('6.26');
  });

  it('switches to measurements without losing anything', async () => {
    render(<AddressSearchPanel />);
    fireEvent.click(screen.getByTestId('switch-to-manual'));
    expect(store().mappingMethod).toBe('manual');
  });

  it('offers to remove location data once the plan is pinned', () => {
    store().georeferenceAt(DUBLIN);
    render(<AddressSearchPanel />);

    expect(screen.getByTestId('address-located')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('remove-location-data'));
    expect(store().present.georeference).toBeNull();
    expect(store().present.location).toBeNull();
  });
});
