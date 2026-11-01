import { lowerBound } from './search';

/**
 * Minimum half-width (s) of the smoothing window at the ends of the track. Near the ends the window is
 * shrunk symmetrically (so linear trends are not biased) but never below this, so the first/last samples
 * are still averaged a little and the output stays a single-valued function of time.
 */
const MIN_EDGE_HALF_WINDOW_SEC = 5;

/** Integral of the piecewise-linear function (x, y) from x[0] up to q. Zero-length steps contribute nothing. */
function makeIntegral(x: Float64Array, y: Float64Array): (q: number) => number {
  const n = x.length;
  const prefix = new Float64Array(n);
  for (let i = 1; i < n; i++) prefix[i] = prefix[i - 1] + ((x[i] - x[i - 1]) * (y[i] + y[i - 1])) / 2;
  return (q) => {
    if (n === 0 || q <= x[0]) return 0;
    if (q >= x[n - 1]) return prefix[n - 1];
    const k = lowerBound(x, q); // x[k-1] < q <= x[k], k >= 1
    const x0 = x[k - 1];
    const y0 = y[k - 1];
    const yq = y0 + ((y[k] - y0) * (q - x0)) / (x[k] - x0);
    return prefix[k - 1] + ((q - x0) * (y0 + yq)) / 2;
  };
}

/** Value of the piecewise-linear function (x, y) at q, clamped to the ends. */
export function interpolateAt(x: Float64Array, y: Float64Array, q: number): number {
  const n = x.length;
  const k = lowerBound(x, q);
  if (k >= n) return y[n - 1];
  if (k === 0 || x[k] === q) return y[k];
  const x0 = x[k - 1];
  return y[k - 1] + ((y[k] - y[k - 1]) * (q - x0)) / (x[k] - x0);
}

/**
 * Time-based moving average: each output is the mean of the piecewise-linear signal y(x) over
 * [x_i - W/2, x_i + W/2] (an integral, so irregular sampling and bursts of samples at the same moving
 * time — e.g. a detected stop — are weighted by time, not by sample count). `x` must be non-decreasing.
 */
export function smoothByTime(x: Float64Array, y: Float64Array, windowSec: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(y);
  if (n < 2 || !(windowSec > 0)) return out;
  const integral = makeIntegral(x, y);
  const first = x[0];
  const last = x[n - 1];
  const half = windowSec / 2;
  const minHalf = Math.min(half, MIN_EDGE_HALF_WINDOW_SEC);
  for (let i = 0; i < n; i++) {
    const m = x[i];
    const h = Math.min(half, Math.max(Math.min(m - first, last - m), minHalf));
    const a = Math.max(first, m - h);
    const b = Math.min(last, m + h);
    if (b > a) out[i] = (integral(b) - integral(a)) / (b - a);
  }
  return out;
}

/**
 * Centred rolling vertical speed in m/h: (y(x+W/2) - y(x-W/2)) / W, window clipped to the track
 * (one-sided at the ends). 0 where the window has no duration.
 */
export function rollingVerticalSpeed(x: Float64Array, y: Float64Array, windowSec: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n < 2) return out;
  const first = x[0];
  const last = x[n - 1];
  const half = Math.max(0, windowSec) / 2;
  for (let i = 0; i < n; i++) {
    let a = Math.max(first, x[i] - half);
    let b = Math.min(last, x[i] + half);
    if (!(b > a)) {
      // Zero window (windowSec = 0): fall back to the neighbouring steps.
      a = x[Math.max(0, i - 1)];
      b = x[Math.min(n - 1, i + 1)];
    }
    if (b > a) out[i] = ((interpolateAt(x, y, b) - interpolateAt(x, y, a)) / (b - a)) * 3600;
  }
  return out;
}
