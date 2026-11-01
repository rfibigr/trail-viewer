/** Statistics for a user-selected stretch of the activity. Pure; no UI dependencies. */
import type { ProcessedPoint } from '../types';
import { nearestIndex } from './profile';

export interface RangeStats {
  startIndex: number;
  endIndex: number;
  startDistance: number;
  endDistance: number;
  /** metres */
  distance: number;
  /** seconds of moving time (pauses excluded) */
  movingTime: number;
  /** metres, both >= 0, from the smoothed altitude */
  gain: number;
  loss: number;
  /** end altitude - start altitude, metres */
  netElevation: number;
  /** net elevation / moving time, m/h (0 when no moving time) */
  avgVerticalSpeed: number;
  /** net elevation / horizontal distance, percent (0 when no distance) */
  avgGrade: number;
}

/**
 * Stats between two point indices (inclusive, any order, clamped to the array).
 * Returns null for an empty point list.
 */
export function rangeStats(points: readonly ProcessedPoint[], a: number, b: number): RangeStats | null {
  const n = points.length;
  if (n === 0 || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const clamp = (i: number) => Math.min(n - 1, Math.max(0, Math.round(i)));
  const i0 = Math.min(clamp(a), clamp(b));
  const i1 = Math.max(clamp(a), clamp(b));
  let gain = 0;
  let loss = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    const d = points[i].altitude - points[i - 1].altitude;
    if (d > 0) gain += d;
    else loss -= d;
  }
  const p0 = points[i0];
  const p1 = points[i1];
  const distance = Math.max(0, p1.distance - p0.distance);
  const movingTime = Math.max(0, p1.movingTime - p0.movingTime);
  const net = p1.altitude - p0.altitude;
  return {
    startIndex: i0,
    endIndex: i1,
    startDistance: p0.distance,
    endDistance: p1.distance,
    distance,
    movingTime,
    gain,
    loss,
    netElevation: net,
    avgVerticalSpeed: movingTime > 0 ? (net / movingTime) * 3600 : 0,
    avgGrade: distance > 0 ? (net / distance) * 100 : 0,
  };
}

/** Stats for an x-axis range (km or hours, matching `xs`), snapped to the nearest points. */
export function rangeStatsForX(
  points: readonly ProcessedPoint[],
  xs: readonly number[],
  xa: number,
  xb: number,
): RangeStats | null {
  if (xs.length === 0) return null;
  return rangeStats(points, nearestIndex(xs, xa), nearestIndex(xs, xb));
}
