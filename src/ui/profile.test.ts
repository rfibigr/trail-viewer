import { describe, expect, it } from 'vitest';
import type { ProcessedPoint } from '../types';
import { verticalSpeedColor } from './colors';
import { fillStops, nearestIndex, verticalSpeedRange } from './profile';

const mk = (vs: number[]): ProcessedPoint[] =>
  vs.map((v, i) => ({ distance: i * 10, movingTime: i, elapsedTime: i, altitude: 0, verticalSpeed: v, segmentIndex: 0 }));

describe('nearestIndex', () => {
  it('finds the closest x', () => {
    const xs = [0, 1, 2, 4, 8];
    expect(nearestIndex(xs, -1)).toBe(0);
    expect(nearestIndex(xs, 2.9)).toBe(2);
    expect(nearestIndex(xs, 3.1)).toBe(3);
    expect(nearestIndex(xs, 100)).toBe(4);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('fillStops', () => {
  it('has ascending offsets spanning 0..1 and keeps per-point resolution', () => {
    const pts = mk(Array.from({ length: 500 }, (_, i) => (i < 250 ? 1000 : -1000)));
    const xs = pts.map((p) => p.distance);
    const stops = fillStops(pts, xs, 'light');
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
    for (let i = 1; i < stops.length; i++) expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    expect(stops.length).toBeGreaterThanOrEqual(500);
    // a short steep pocket survives the anti-aliasing kernel
    expect(stops[100].color).toBe(verticalSpeedColor(1000));
    expect(stops[400].color).toBe(verticalSpeedColor(-1000));
  });

  it('caps the number of stops for huge tracks', () => {
    const pts = mk(new Array(50000).fill(300));
    expect(fillStops(pts, pts.map((p) => p.distance), 'dark', 1000).length).toBeLessThanOrEqual(1002);
  });

  it('degrades gracefully', () => {
    expect(fillStops([], [], 'light')).toHaveLength(2);
    const nan = mk([NaN, NaN, NaN]);
    expect(fillStops(nan, [0, 1, 2], 'light')[0].color).toBe(verticalSpeedColor(0));
  });
});

describe('verticalSpeedRange', () => {
  it('includes zero and snaps to the step', () => {
    const [lo, hi, step] = verticalSpeedRange(mk([300, 1200, -1700]));
    expect(lo).toBeLessThanOrEqual(-1700);
    expect(hi).toBeGreaterThanOrEqual(1200);
    expect(Math.abs(lo % step)).toBe(0);
    expect(hi % step).toBe(0);
    expect(verticalSpeedRange(mk([100, 200]))[0]).toBe(0);
  });
});
