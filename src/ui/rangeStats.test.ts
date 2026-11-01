import { describe, expect, it } from 'vitest';
import type { ProcessedPoint } from '../types';
import { rangeStats, rangeStatsForX } from './rangeStats';

/** Builds points from [distance m, altitude m, movingTime s, elapsedTime s?]. */
function pts(rows: [number, number, number, number?][]): ProcessedPoint[] {
  return rows.map(([distance, altitude, movingTime, elapsed]) => ({
    distance,
    altitude,
    movingTime,
    elapsedTime: elapsed ?? movingTime,
    verticalSpeed: 0,
    segmentIndex: 0,
  }));
}

const track = pts([
  [0, 100, 0],
  [100, 120, 60],
  [200, 110, 120],
  [300, 150, 180],
  [400, 150, 240],
]);

describe('rangeStats', () => {
  it('computes distance, time, D+/D-, avg vertical speed and grade', () => {
    const s = rangeStats(track, 0, 4)!;
    expect(s.distance).toBe(400);
    expect(s.movingTime).toBe(240);
    expect(s.gain).toBe(60);
    expect(s.loss).toBe(10);
    expect(s.netElevation).toBe(50);
    expect(s.avgVerticalSpeed).toBeCloseTo((50 / 240) * 3600);
    expect(s.avgGrade).toBeCloseTo(12.5);
  });

  it('handles a reversed selection identically', () => {
    expect(rangeStats(track, 3, 1)).toEqual(rangeStats(track, 1, 3));
  });

  it('a single point gives zeros, not NaN', () => {
    const s = rangeStats(track, 2, 2)!;
    expect(s.distance).toBe(0);
    expect(s.movingTime).toBe(0);
    expect(s.gain).toBe(0);
    expect(s.loss).toBe(0);
    expect(s.avgVerticalSpeed).toBe(0);
    expect(s.avgGrade).toBe(0);
  });

  it('clamps out-of-range and fractional indices', () => {
    const s = rangeStats(track, -5, 99)!;
    expect(s.startIndex).toBe(0);
    expect(s.endIndex).toBe(4);
    expect(rangeStats(track, 0.6, 2.4)!.startIndex).toBe(1);
  });

  it('returns null for empty input or NaN indices', () => {
    expect(rangeStats([], 0, 1)).toBeNull();
    expect(rangeStats(track, NaN, 1)).toBeNull();
  });

  it('uses moving time across a pause (elapsed jumps, moving time does not)', () => {
    const paused = pts([
      [0, 100, 0, 0],
      [100, 130, 60, 60],
      [100, 130, 60, 660], // 10 min stop
      [200, 160, 120, 720],
    ]);
    const s = rangeStats(paused, 0, 3)!;
    expect(s.movingTime).toBe(120);
    expect(s.avgVerticalSpeed).toBeCloseTo(1800);
  });

  it('a stationary stretch has no grade and no division by zero', () => {
    const still = pts([
      [50, 100, 10],
      [50, 101, 10],
    ]);
    const s = rangeStats(still, 0, 1)!;
    expect(s.avgGrade).toBe(0);
    expect(s.avgVerticalSpeed).toBe(0);
    expect(s.gain).toBe(1);
  });
});

describe('rangeStatsForX', () => {
  it('snaps x values to nearest points, in either order', () => {
    const xs = track.map((p) => p.distance / 1000);
    const s = rangeStatsForX(track, xs, 0.29, 0.11)!;
    expect(s.startIndex).toBe(1);
    expect(s.endIndex).toBe(3);
  });
});
