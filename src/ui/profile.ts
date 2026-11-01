/** Pure helpers turning an AnalysisResult into chart-ready arrays and fill gradients. */
import type { ProcessedPoint, Segment } from '../types';
import { verticalSpeedColor, type Theme } from './colors';

export type XMode = 'distance' | 'time';

export interface GradientStop {
  offset: number;
  color: string;
}

/** x value per point: km for distance, hours of moving time for time. */
export function xValues(points: readonly ProcessedPoint[], mode: XMode): number[] {
  return mode === 'distance'
    ? points.map((p) => p.distance / 1000)
    : points.map((p) => p.movingTime / 3600);
}

/** Index of the point whose x is closest to `x`. `xs` must be non-decreasing. */
export function nearestIndex(xs: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x)) return lo - 1;
  return lo;
}

/**
 * First point index of the drawn span of segment k. The interval between the previous
 * segment's last point and this segment's first point is drawn in this segment's colour,
 * so colour changes happen exactly at the previous segment's end (the summit / valley).
 */
export function segmentDrawStart(segments: readonly Segment[], k: number): number {
  return k === 0 ? segments[0].startIndex : Math.min(segments[k - 1].endIndex, segments[k].startIndex);
}

/**
 * Horizontal gradient stops (offsets 0..1 across the data x-extent) colouring the fill by the
 * rolling per-point vertical speed. Points are averaged into equal-width x bins (about one per
 * device pixel at the default) with a tiny [1,2,1] kernel against aliasing; the analysis'
 * rolling window already does the real smoothing, so steep pockets inside a climb stay visible.
 * Empty bins (e.g. a pause on a time axis) are skipped so neighbours blend over them.
 */
export function fillStops(
  points: readonly ProcessedPoint[],
  xs: readonly number[],
  theme: Theme,
  maxBins = 2000,
): GradientStop[] {
  const n = Math.min(xs.length, points.length);
  const neutral = verticalSpeedColor(0, theme);
  if (n < 2) return [{ offset: 0, color: neutral }, { offset: 1, color: neutral }];
  const x0 = xs[0];
  const span = xs[n - 1] - x0 || 1;
  const bins = Math.max(2, Math.min(maxBins, n));
  const sum = new Float64Array(bins);
  const count = new Uint32Array(bins);
  for (let i = 0; i < n; i++) {
    const v = points[i].verticalSpeed;
    if (!Number.isFinite(v)) continue;
    const b = Math.min(bins - 1, Math.max(0, Math.floor(((xs[i] - x0) / span) * bins)));
    sum[b] += v;
    count[b]++;
  }
  const stops: GradientStop[] = [];
  for (let b = 0; b < bins; b++) {
    if (count[b] === 0) continue;
    let s = 0;
    let w = 0;
    for (let j = -1; j <= 1; j++) {
      const k = b + j;
      if (k < 0 || k >= bins || count[k] === 0) continue;
      const wk = j === 0 ? 2 : 1;
      s += (sum[k] / count[k]) * wk;
      w += wk;
    }
    stops.push({ offset: (b + 0.5) / bins, color: verticalSpeedColor(s / w, theme) });
  }
  if (stops.length === 0) return [{ offset: 0, color: neutral }, { offset: 1, color: neutral }];
  stops.unshift({ offset: 0, color: stops[0].color });
  stops.push({ offset: 1, color: stops[stops.length - 1].color });
  return stops;
}

/** Symmetric-ish nice range for the vertical speed graph, always including 0. [min, max, interval] */
export function verticalSpeedRange(points: readonly ProcessedPoint[]): [number, number, number] {
  let lo = 0;
  let hi = 0;
  for (const p of points) {
    if (!Number.isFinite(p.verticalSpeed)) continue;
    if (p.verticalSpeed < lo) lo = p.verticalSpeed;
    if (p.verticalSpeed > hi) hi = p.verticalSpeed;
  }
  const span = Math.max(hi - lo, 200);
  const step = [250, 500, 1000, 2000].find((s) => span / s <= 4) ?? 2000;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, step];
}

/** Nice y-range with some headroom, snapped to a round tick interval (so ECharts doesn't add odd end ticks). */
export function altitudeRange(points: readonly ProcessedPoint[], targetTicks = 6): [number, number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.altitude < lo) lo = p.altitude;
    if (p.altitude > hi) hi = p.altitude;
  }
  if (!Number.isFinite(lo)) return [0, 100, 20];
  const pad = Math.max(10, (hi - lo) * 0.06);
  const span = hi - lo + 2 * pad;
  const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000].reduce((best, s) =>
    Math.abs(span / s - targetTicks) < Math.abs(span / best - targetTicks) ? s : best,
  );
  return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad * 0.5) / step) * step, step];
}
