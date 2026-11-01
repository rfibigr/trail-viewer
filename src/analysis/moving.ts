import type { PauseInterval } from '../types';
import { lowerBound, upperBound } from './search';

/** Horizontal speed below which the athlete may be stationary (m/s). */
export const STATIONARY_SPEED_MPS = 0.3;
/** Half-width of the window used to estimate horizontal speed (s). */
export const SPEED_HALF_WINDOW_SEC = 5;
/** Vertical rate below which the athlete may be stationary (m/h). Steep power-hiking is well above this. */
export const STATIONARY_VERTICAL_MPH = 300;
/** Half-width of the window for the least-squares vertical rate (s); wide so ±3 m baro noise stays ~±50 m/h. */
export const VERTICAL_HALF_WINDOW_SEC = 30;
/** A slow stretch must last at least this long (moving-clock seconds) to be removed. */
export const MIN_STATIONARY_SEC = 20;

/** Merge pauses into sorted, non-overlapping intervals; invalid ones are dropped. */
function normalizePauses(pauses: readonly PauseInterval[]): PauseInterval[] {
  const ps = pauses
    .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
    .map((p) => ({ start: p.start, end: p.end }))
    .sort((a, b) => a.start - b.start);
  const out: PauseInterval[] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push(p);
  }
  return out;
}

/**
 * Pause boundaries may be off by a little from the sample timestamps (e.g. the pause `end` lands slightly
 * after the first sample written on resume). Since devices write no records while the timer is stopped,
 * a pause containing at most this many samples is treated as one gap and charged entirely to the
 * single interval it overlaps most.
 */
const MAX_JITTER_SAMPLES_IN_PAUSE = 2;

/**
 * Per-interval moving duration after removing timer pauses: out[i] is the moving part of
 * [t[i-1], t[i]] (out[0] = 0). Never negative.
 *  - A pause holding <= MAX_JITTER_SAMPLES_IN_PAUSE samples strictly inside it removes its overlap
 *    with the interval it overlaps most (clipped to that interval), so boundary jitter neither leaks
 *    into neighbouring intervals nor leaves part of the gap counted.
 *  - A pause that genuinely contains samples (a device that keeps recording) removes its plain overlap
 *    with every interval.
 */
export function pauseAdjustedDurations(t: Float64Array, pauses: readonly PauseInterval[]): Float64Array {
  const n = t.length;
  const removed = new Float64Array(n);
  const overlap = (i: number, p: PauseInterval) => Math.max(0, Math.min(t[i], p.end) - Math.max(t[i - 1], p.start));
  if (n >= 2) {
    for (const p of normalizePauses(pauses)) {
      const inside = lowerBound(t, p.end) - upperBound(t, p.start); // samples with start < t < end
      // Intervals that can overlap: from the one containing p.start to the one containing p.end.
      const first = Math.max(1, upperBound(t, p.start));
      const last = Math.min(n - 1, lowerBound(t, p.end));
      if (inside <= MAX_JITTER_SAMPLES_IN_PAUSE) {
        let best = -1;
        let bestOv = 0;
        for (let i = first; i <= last; i++) {
          const ov = overlap(i, p);
          if (ov > bestOv) {
            bestOv = ov;
            best = i;
          }
        }
        if (best > 0) removed[best] += bestOv;
      } else {
        for (let i = first; i <= last; i++) removed[i] += overlap(i, p);
      }
    }
  }
  const dt = new Float64Array(n);
  for (let i = 1; i < n; i++) dt[i] = Math.max(0, t[i] - t[i - 1] - removed[i]);
  return dt;
}

/**
 * Flags intervals (between point i-1 and i, flag stored at i) during which the athlete is stationary:
 * horizontal speed < STATIONARY_SPEED_MPS (over ±SPEED_HALF_WINDOW_SEC around the interval) AND
 * |vertical rate| < STATIONARY_VERTICAL_MPH (least-squares slope over ±VERTICAL_HALF_WINDOW_SEC), for a
 * consecutive run lasting >= MIN_STATIONARY_SEC of (pause-adjusted) time. The vertical condition keeps
 * slow, steep power-hiking (low horizontal speed but real ascent) counted as moving.
 */
export function detectStationary(
  t: Float64Array,
  distance: Float64Array,
  altitude: Float64Array,
  dt: Float64Array,
): Uint8Array {
  const n = t.length;
  const slow = new Uint8Array(n);
  for (let i = 1; i < n; i++) {
    if (dt[i] <= 0) continue; // fully paused: already excluded
    const mid = (t[i - 1] + t[i]) / 2;

    // Horizontal speed over a window that always contains the interval itself.
    const a = Math.min(i - 1, lowerBound(t, mid - SPEED_HALF_WINDOW_SEC));
    const b = Math.max(i, upperBound(t, mid + SPEED_HALF_WINDOW_SEC) - 1);
    const hSpeed = (distance[b] - distance[a]) / (t[b] - t[a]);
    if (!(hSpeed < STATIONARY_SPEED_MPS)) continue;

    // Least-squares vertical rate.
    const va = Math.min(i - 1, lowerBound(t, mid - VERTICAL_HALF_WINDOW_SEC));
    const vb = Math.max(i, upperBound(t, mid + VERTICAL_HALF_WINDOW_SEC) - 1);
    let st = 0;
    let sa = 0;
    const cnt = vb - va + 1;
    for (let k = va; k <= vb; k++) {
      st += t[k] - mid;
      sa += altitude[k];
    }
    const mt = st / cnt;
    const ma = sa / cnt;
    let num = 0;
    let den = 0;
    for (let k = va; k <= vb; k++) {
      const x = t[k] - mid - mt;
      num += x * (altitude[k] - ma);
      den += x * x;
    }
    const vRate = den > 0 ? Math.abs((num / den) * 3600) : 0;
    if (vRate < STATIONARY_VERTICAL_MPH) slow[i] = 1;
  }

  // Keep only runs that last long enough.
  const stationary = new Uint8Array(n);
  let i = 1;
  while (i < n) {
    if (!slow[i]) {
      i++;
      continue;
    }
    let j = i;
    let dur = 0;
    while (j < n && slow[j]) dur += dt[j++];
    if (dur >= MIN_STATIONARY_SEC) stationary.fill(1, i, j);
    i = j;
  }
  return stationary;
}

/**
 * Cumulative moving time per point (starts at 0, non-decreasing): elapsed time minus timer pauses
 * minus auto-detected stationary stretches.
 */
export function computeMovingTime(
  t: Float64Array,
  distance: Float64Array,
  altitude: Float64Array,
  pauses: readonly PauseInterval[],
): Float64Array {
  const n = t.length;
  const dt = pauseAdjustedDurations(t, pauses);
  const stationary = detectStationary(t, distance, altitude, dt);
  const mt = new Float64Array(n);
  for (let i = 1; i < n; i++) mt[i] = mt[i - 1] + (stationary[i] ? 0 : dt[i]);
  return mt;
}
