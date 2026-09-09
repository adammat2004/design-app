import { describe, expect, it } from 'vitest';
import { haversineDistance, localFrame, metresPerDegree } from './local-frame';

const DUBLIN = { latitude: 53.3498, longitude: -6.2603 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };

describe('metresPerDegree', () => {
  it('matches the WGS84 figures at 53°N, not a mean sphere', () => {
    const at53 = metresPerDegree(53);
    // Meridional 111,286 m and prime-vertical·cos 67,137 m per degree; a 6,371 km sphere would say
    // 111,195 and 66,919 — 0.33% short east–west, which is 65 cm across a 200 m garden.
    expect(at53.north).toBeCloseTo(111_286, -1);
    expect(at53.east).toBeCloseTo(67_137, -1);
  });

  it('matches the equator', () => {
    const at0 = metresPerDegree(0);
    expect(at0.north).toBeCloseTo(110_574, -1);
    expect(at0.east).toBeCloseTo(111_320, -1);
  });
});

describe('localFrame', () => {
  const frame = localFrame(DUBLIN);
  const scale = metresPerDegree(DUBLIN.latitude);

  it('puts the anchor at the origin', () => {
    expect(frame.toLocal(DUBLIN)).toEqual({ x: 0, y: 0 });
  });

  it('is y-down: 100 m south is +100 on y', () => {
    const south = { ...DUBLIN, latitude: DUBLIN.latitude - 100 / scale.north };
    const local = frame.toLocal(south);
    expect(local.x).toBeCloseTo(0, 3);
    expect(local.y).toBeCloseTo(100, 3);
  });

  it('is x-east: 100 m east is +100 on x', () => {
    const east = { ...DUBLIN, longitude: DUBLIN.longitude + 100 / scale.east };
    const local = frame.toLocal(east);
    expect(local.x).toBeCloseTo(100, 3);
    expect(local.y).toBeCloseTo(0, 3);
  });

  it('round-trips to a nanodegree', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 12.5, y: -19 },
      { x: -300, y: 250 },
    ]) {
      const back = frame.toLocal(frame.toLatLng(point));
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it('measures a 10 m east–west fence at 10 m, not the 16.7 m Web Mercator would give', () => {
    const frame53 = localFrame({ latitude: 53.3, longitude: -6 });
    const from = frame53.toLatLng({ x: 0, y: 0 });
    const to = frame53.toLatLng({ x: 10, y: 0 });

    // Mercator metres along a parallel are Δλ·R, inflated by 1/cos φ relative to the ground.
    const mercatorMetres = ((to.longitude - from.longitude) * Math.PI * 6_378_137) / 180;
    expect(mercatorMetres / 10).toBeCloseTo(1.673, 2);

    const local = frame53.toLocal(to);
    expect(Math.hypot(local.x, local.y)).toBeCloseTo(10, 6);
  });

  it('agrees with a great-circle reference to the ellipsoid over a 200 m diagonal', () => {
    const far = frame.toLatLng({ x: 141.42, y: 141.42 });
    const reference = haversineDistance(DUBLIN, far);
    // The sphere and the ellipsoid differ by up to 0.33% here; a Mercator slip is 67%, an axis
    // swap is a hemisphere. Half a percent separates right from every wrong.
    expect(Math.abs(reference - 200) / 200).toBeLessThan(0.005);
  });

  it('honours orientation: with north to the right, 100 m north lands at +x', () => {
    const turned = localFrame(LONDON, 90);
    const north = { ...LONDON, latitude: LONDON.latitude + 100 / metresPerDegree(LONDON.latitude).north };
    const local = turned.toLocal(north);
    expect(local.x).toBeCloseTo(100, 3);
    expect(local.y).toBeCloseTo(0, 3);

    const back = turned.toLatLng(local);
    expect(back.latitude).toBeCloseTo(north.latitude, 9);
    expect(back.longitude).toBeCloseTo(north.longitude, 9);
  });
});
