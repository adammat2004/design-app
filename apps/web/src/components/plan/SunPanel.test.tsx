import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { SunPanel } from './SunPanel';

/**
 * Plain DOM, no Konva, so the whole panel renders under jsdom.
 *
 * The behaviour worth protecting here is not the markup — it is that **location gates every solar
 * claim in the app**. A plan that has never been located must draw with the conventional light and
 * say so, and it must stay that way no matter what else the user sets.
 */

const store = () => useBoundaryStore.getState();

beforeEach(() => {
  resetBoundaryStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('north', () => {
  it('records where north is', () => {
    render(<SunPanel />);

    fireEvent.change(screen.getByTestId('orientation'), { target: { value: '90' } });

    expect(store().present.orientation).toBe(90);
  });

  it('starts pointing up, which is where the compass has always pointed', () => {
    render(<SunPanel />);

    expect(screen.getByTestId('orientation')).toHaveValue(0);
  });
});

describe('location, which is the gate', () => {
  it('starts unset, and says why rather than guessing', () => {
    render(<SunPanel />);

    expect(store().present.location).toBeNull();
    expect(screen.getByTestId('sun-unset')).toBeInTheDocument();
    expect(screen.queryByTestId('sun-time')).not.toBeInTheDocument();
  });

  it('stays unset when only north is given', () => {
    // The whole point of the split: orientation says which way the plot is turned, not where on
    // Earth it is, and solar altitude is a function of latitude.
    render(<SunPanel />);

    fireEvent.change(screen.getByTestId('orientation'), { target: { value: '137' } });

    expect(store().present.location).toBeNull();
    expect(screen.getByTestId('sun-unset')).toBeInTheDocument();
  });

  it('accepts typed coordinates and reveals the sun controls', () => {
    render(<SunPanel />);

    fireEvent.change(screen.getByTestId('manual-latitude'), { target: { value: '53.4' } });
    fireEvent.change(screen.getByTestId('manual-longitude'), { target: { value: '-2.98' } });
    fireEvent.click(screen.getByTestId('set-location'));

    expect(store().present.location).toEqual({ latitude: 53.4, longitude: -2.98 });
    expect(screen.getByTestId('sun-located')).toHaveTextContent('53.40°N, 2.98°W');
    expect(screen.getByTestId('sun-time')).toBeInTheDocument();
  });

  it('refuses coordinates that are not on Earth, rather than clamping them', () => {
    // A latitude of 91 is a bad reading, not a garden slightly too far north. Clamping to 90
    // would draw a plausible arctic sun over whatever the user actually meant.
    render(<SunPanel />);

    fireEvent.change(screen.getByTestId('manual-latitude'), { target: { value: '91' } });
    fireEvent.change(screen.getByTestId('manual-longitude'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('set-location'));

    expect(store().present.location).toBeNull();
  });

  it('can be cleared, which switches the shadows back off', () => {
    // Set before rendering: a Zustand write outside `act` does not flush a re-render, so a store
    // change made after `render` would not be on screen for the click to find.
    store().setLocation({ latitude: 53.4, longitude: -2.98 });
    render(<SunPanel />);

    fireEvent.click(screen.getByTestId('clear-location'));

    expect(store().present.location).toBeNull();
    expect(screen.getByTestId('sun-unset')).toBeInTheDocument();
  });
});

describe('using the browser location', () => {
  it('stores what the browser reports', () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 51.5, longitude: -0.12 } }),
      },
    });

    render(<SunPanel />);
    fireEvent.click(screen.getByTestId('use-my-location'));

    expect(store().present.location).toEqual({ latitude: 51.5, longitude: -0.12 });
  });

  it('names the refusal AND the way round it', () => {
    // Every error branch has to leave the user with a next move. The manual fields are always on
    // screen, so the message points at them rather than just reporting a failure.
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) =>
          fail({ code: 1, PERMISSION_DENIED: 1 }),
      },
    });

    render(<SunPanel />);
    fireEvent.click(screen.getByTestId('use-my-location'));

    expect(screen.getByTestId('sun-problem')).toHaveTextContent(/refused/i);
    expect(screen.getByTestId('sun-problem')).toHaveTextContent(/type the coordinates/i);
    expect(store().present.location).toBeNull();
  });

  it('copes with a browser that cannot do it at all', () => {
    vi.stubGlobal('navigator', {});

    render(<SunPanel />);
    fireEvent.click(screen.getByTestId('use-my-location'));

    expect(screen.getByTestId('sun-problem')).toHaveTextContent(/cannot share a location/i);
  });
});

describe('the instant being drawn', () => {
  beforeEach(() => {
    store().setLocation({ latitude: 53.4, longitude: -2.98 });
  });

  it('defaults to mid-afternoon on the longest day', () => {
    render(<SunPanel />);

    expect(screen.getByTestId('sun-time')).toHaveTextContent('15:00');
    expect(screen.getByTestId('sun-date')).toHaveTextContent('21 Jun');
  });

  it('moves the time of day', () => {
    render(<SunPanel />);

    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '480' } });

    expect(store().present.sun.minutes).toBe(480);
    expect(screen.getByTestId('sun-time')).toHaveTextContent('08:00');
  });

  it('moves the time of year without disturbing the hour', () => {
    render(<SunPanel />);

    fireEvent.change(screen.getByLabelText('Time of year'), { target: { value: '355' } });

    expect(store().present.sun).toEqual({ dayOfYear: 355, minutes: 900 });
  });

  it('says so when the sun is down, rather than just drawing nothing', () => {
    render(<SunPanel />);

    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '0' } });

    expect(screen.getByTestId('sun-below-horizon')).toBeInTheDocument();
  });
});
