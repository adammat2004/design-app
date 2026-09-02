'use client';

import { useState } from 'react';
import { Compass, Crosshair, Sun } from 'lucide-react';
import { hasSolarPosition, solarPosition } from '@garden-studio/schema';
import { useBoundaryStore } from '@/state/boundary-store';

/**
 * Where the garden is, which way it faces, and when we are looking at it.
 *
 * These three are one concept and they belong together. North lived in `OpeningsPanel` — a panel
 * about doors — purely because that is where it was added; splitting north from location would
 * put half of "sun and shade" in a panel about door positions and the other half here.
 *
 * **Location is the gate on every solar claim in the app.** Until it is filled in, the plan draws
 * with the conventional top-left light and says nothing about sun or shade. That is deliberate:
 * `orientation` can sensibly default because "north is up" is a real statement about a drawing,
 * but there is no latitude that is true of anywhere, and a plausible-looking guess would have the
 * design built confidently around a fact the user never stated. Offered, not applied — the same
 * rule `suggestedDoorWall` follows for the inferred patio door.
 */
export function SunPanel() {
  const draft = useBoundaryStore((state) => state.present);
  const setOrientation = useBoundaryStore((state) => state.setOrientation);
  const setLocation = useBoundaryStore((state) => state.setLocation);
  const setSun = useBoundaryStore((state) => state.setSun);

  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const located = hasSolarPosition(draft);
  const position = solarPosition(draft);

  const useMyLocation = () => {
    setProblem(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setProblem('This browser cannot share a location. Type the coordinates instead.');
      return;
    }

    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setAsking(false);
        setLocation({
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
        });
      },
      /*
       * Every branch names what went wrong AND what to do about it. A bare "location failed"
       * leaves the user with no next move, and the next move here is always the same one: the
       * manual fields below are not a fallback for failure, they are always available.
       */
      (error) => {
        setAsking(false);
        setProblem(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was refused. Type the coordinates instead.'
            : 'Could not get a location just now. Type the coordinates instead.',
        );
      },
      { timeout: 10_000 },
    );
  };

  return (
    <section data-testid="sun-panel" className="space-y-3 border-t border-garden-line pt-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-garden-forest">
        <Sun aria-hidden className="h-4 w-4 text-garden-muted" />
        Sun and shade
      </h3>

      <div className="flex items-center gap-2">
        <Compass aria-hidden className="h-4 w-4 shrink-0 text-garden-muted" />
        <label className="flex flex-1 items-center gap-2 text-[11px] text-garden-muted">
          North is
          <input
            type="number"
            step={5}
            min={0}
            max={359}
            data-testid="orientation"
            aria-label="Degrees clockwise from the top of the plan to true north"
            value={Math.round(draft.orientation)}
            onChange={(event) => setOrientation(Number(event.target.value))}
            className="w-16 rounded-md border border-garden-line bg-white px-2 py-1 text-sm text-garden-ink focus-visible:outline-none"
          />
          <span aria-hidden>° from up</span>
        </label>
      </div>

      {located ? (
        <LocatedControls
          latitude={draft.location!.latitude}
          longitude={draft.location!.longitude}
          altitude={position?.altitude ?? null}
          sun={draft.sun}
          onChangeSun={setSun}
          onClear={() => setLocation(null)}
        />
      ) : (
        <p data-testid="sun-unset" className="text-[11px] leading-relaxed text-garden-muted">
          Shadows are off until Garden Studio knows where the garden is. Latitude is what sets how
          high the sun gets, so there is no sensible default to guess.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="use-my-location"
          onClick={useMyLocation}
          disabled={asking}
          className="flex items-center gap-1.5 rounded-full border border-garden-line px-3 py-1 text-[11px] font-semibold text-garden-forest hover:bg-garden-sage disabled:opacity-50"
        >
          <Crosshair aria-hidden className="h-3.5 w-3.5" />
          {asking ? 'Locating…' : 'Use my location'}
        </button>

        <ManualLocation onSet={setLocation} />
      </div>

      {problem ? (
        <p data-testid="sun-problem" role="status" className="text-[11px] text-garden-muted">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

function LocatedControls({
  latitude,
  longitude,
  altitude,
  sun,
  onChangeSun,
  onClear,
}: {
  latitude: number;
  longitude: number;
  altitude: number | null;
  sun: { dayOfYear: number; minutes: number };
  onChangeSun: (sun: { dayOfYear?: number; minutes?: number }) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center justify-between text-[11px] text-garden-muted">
        <span data-testid="sun-located">
          {formatLatitude(latitude)}, {formatLongitude(longitude)}
        </span>
        <button
          type="button"
          data-testid="clear-location"
          onClick={onClear}
          className="text-[11px] font-semibold text-garden-forest underline-offset-2 hover:underline"
        >
          Clear
        </button>
      </p>

      <label className="block text-[11px] text-garden-muted">
        <span className="flex items-center justify-between">
          Time of day
          <span data-testid="sun-time" className="font-semibold text-garden-ink">
            {formatTimeOfDay(sun.minutes)}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1439}
          step={15}
          aria-label="Time of day"
          value={sun.minutes}
          onChange={(event) => onChangeSun({ minutes: Number(event.target.value) })}
          className="w-full accent-garden-forest"
        />
      </label>

      <label className="block text-[11px] text-garden-muted">
        <span className="flex items-center justify-between">
          Time of year
          <span data-testid="sun-date" className="font-semibold text-garden-ink">
            {formatDayOfYear(sun.dayOfYear)}
          </span>
        </span>
        <input
          type="range"
          min={1}
          max={365}
          step={1}
          aria-label="Time of year"
          value={sun.dayOfYear}
          onChange={(event) => onChangeSun({ dayOfYear: Number(event.target.value) })}
          className="w-full accent-garden-forest"
        />
      </label>

      {/*
        The honest report when the sun is down. Without it the shadows simply vanish and the
        controls look broken, rather than saying the thing that is actually true.
      */}
      {altitude !== null && altitude <= 0 ? (
        <p data-testid="sun-below-horizon" className="text-[11px] text-garden-muted">
          The sun is below the horizon at this hour, so nothing casts a shadow.
        </p>
      ) : null}
    </div>
  );
}

function ManualLocation({
  onSet,
}: {
  onSet: (location: { latitude: number; longitude: number }) => void;
}) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  const submit = () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    onSet({ latitude: lat, longitude: lng });
  };

  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        step="0.01"
        placeholder="lat"
        aria-label="Latitude"
        data-testid="manual-latitude"
        value={latitude}
        onChange={(event) => setLatitude(event.target.value)}
        className="w-20 rounded-md border border-garden-line bg-white px-2 py-1 text-[11px] text-garden-ink focus-visible:outline-none"
      />
      <input
        type="number"
        step="0.01"
        placeholder="lng"
        aria-label="Longitude"
        data-testid="manual-longitude"
        value={longitude}
        onChange={(event) => setLongitude(event.target.value)}
        className="w-20 rounded-md border border-garden-line bg-white px-2 py-1 text-[11px] text-garden-ink focus-visible:outline-none"
      />
      <button
        type="button"
        data-testid="set-location"
        onClick={submit}
        className="rounded-full border border-garden-line px-2.5 py-1 text-[11px] font-semibold text-garden-forest hover:bg-garden-sage"
      >
        Set
      </button>
    </span>
  );
}

/* ---------------------------------------------------------------- formatting */

function formatLatitude(value: number): string {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? 'N' : 'S'}`;
}

function formatLongitude(value: number): string {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? 'E' : 'W'}`;
}

function formatTimeOfDay(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Day number to something a person can read.
 *
 * Built from a fixed non-leap year so the label is stable: the stored value is a day *number*,
 * and formatting it through the current year would slide every label by one after a February in
 * a leap year.
 */
function formatDayOfYear(dayOfYear: number): string {
  const date = new Date(Date.UTC(2025, 0, 1));
  date.setUTCDate(dayOfYear);

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
